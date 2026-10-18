"""Solana Safety Ledger: tamper-evident proof of every safety record (stop-work, all-clear, acks, overrides, reports).

How it works:
  1. record()  - each safety event is saved in a local SQLite file with its SHA-256 fingerprint ("leaf").
                 Instant, no network, so it never slows down an alert.
  2. anchor()  - every hour (every few minutes for the demo) all new records are combined into ONE Merkle root,
                 and that root is written to Solana devnet in a single Memo transaction. One cheap transaction
                 covers every site, however many records there are.
  3. verify()  - recomputes the record's fingerprint from what is stored now, walks its Merkle proof up to a root,
                 and compares that root with the one read back from the Solana transaction. If anyone edited
                 the record after it was anchored (even one character), the roots no longer match.
  Only hashes go on-chain. No names, locations or photos ever leave our database.

Usage (from the repo root, conda env active; pip install solders requests):
    python backend/ledger/cypress_ledger/ledger.py setup       # create a devnet wallet + free test SOL
    python backend/ledger/cypress_ledger/ledger.py demo        # record -> anchor on Solana -> verify -> tamper -> verify
    python backend/ledger/cypress_ledger/ledger.py anchor      # anchor all pending records now
    python backend/ledger/cypress_ledger/ledger.py verify rec_1a2b3c4d
    python backend/ledger/cypress_ledger/ledger.py status

From Python:
    from cypress_ledger.ledger import Ledger
    ledger = Ledger()
    rec_id = ledger.record("stop_work", "site_6043", {"alert_id": "alt_7f3a", "reason": "lightning", ...})
    # put rec_id into ledger_record_id of the alert / ack / override / report
    ledger.anchor()               # scheduler: hourly (demo: every 2-5 minutes)
    ledger.verify(rec_id)         # GET /api/ledger/verify/{record_id} -> matches LedgerVerify in contracts/types.ts
"""
import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

HERE = Path(__file__).resolve()
LEDGER_DIR = HERE.parents[1]                      # backend/ledger
BACKEND = LEDGER_DIR.parent
for env_file in (BACKEND / "api" / ".env", BACKEND.parent / ".env", BACKEND / ".env"):
    if env_file.exists():
        try:
            from dotenv import load_dotenv
            load_dotenv(env_file)
        except ImportError:
            pass
        break

DB_FILE = Path(os.environ.get("LEDGER_DB", LEDGER_DIR / "data" / "ledger.db"))
KEYPAIR_FILE = Path(os.environ.get("SOLANA_KEYPAIR_PATH", LEDGER_DIR / ".keys" / "devnet-keypair.json"))
RPC_URL = os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")
NETWORK = "devnet"
MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
MEMO_PREFIX = "cypresswatch:v1"
RECORD_TYPES = ("stop_work", "all_clear", "acknowledgment", "override", "crew_report")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------- hashing and Merkle tree (no network) ----------

def canonical(record: dict) -> bytes:
    """Same record -> same bytes, always (sorted keys, no spaces)."""
    return json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def leaf_hash(record: dict) -> str:
    return hashlib.sha256(b"\x00" + canonical(record)).hexdigest()  # 0x00 prefix: leaves can't pose as nodes


def _node(left: str, right: str) -> str:
    return hashlib.sha256(b"\x01" + bytes.fromhex(left) + bytes.fromhex(right)).hexdigest()


def merkle_root(leaves: list[str]) -> str:
    level = list(leaves)
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])  # odd count: pair the last node with itself
        level = [_node(level[i], level[i + 1]) for i in range(0, len(level), 2)]
    return level[0]


def merkle_proof(leaves: list[str], index: int) -> list[tuple[str, str]]:
    """Sibling hashes from the leaf up to the root: [(sibling_hex, "L" or "R"), ...]."""
    proof, level = [], list(leaves)
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        sibling = index ^ 1
        proof.append((level[sibling], "L" if sibling < index else "R"))
        level = [_node(level[i], level[i + 1]) for i in range(0, len(level), 2)]
        index //= 2
    return proof


def root_from_proof(leaf: str, proof: list[tuple[str, str]]) -> str:
    h = leaf
    for sibling, side in proof:
        h = _node(sibling, h) if side == "L" else _node(h, sibling)
    return h


# ---------- Solana devnet (Memo program) ----------

class ChainError(RuntimeError):
    pass


class SolanaMemoChain:
    """Writes a short memo to Solana devnet and reads it back. Uses solders for signing, plain JSON-RPC for the rest."""

    def __init__(self, rpc_url: str = RPC_URL, keypair_file: Path = KEYPAIR_FILE):
        self.rpc_url, self.keypair_file = rpc_url, keypair_file

    def _rpc(self, method: str, params: list):
        try:
            r = requests.post(self.rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                              timeout=30)
            body = r.json()
        except Exception as e:  # noqa: BLE001
            raise ChainError(f"Solana RPC unreachable: {type(e).__name__}: {e}") from e
        if "error" in body:
            raise ChainError(f"Solana RPC error in {method}: {body['error']}")
        return body["result"]

    def keypair(self, create: bool = False):
        from solders.keypair import Keypair
        if self.keypair_file.exists():
            return Keypair.from_bytes(bytes(json.loads(self.keypair_file.read_text())))
        if not create:
            raise ChainError(f"No wallet at {self.keypair_file}. Run: python backend/ledger/cypress_ledger/ledger.py setup")
        kp = Keypair()
        self.keypair_file.parent.mkdir(parents=True, exist_ok=True)
        self.keypair_file.write_text(json.dumps(list(bytes(kp))))
        os.chmod(self.keypair_file, 0o600)
        return kp

    def address(self) -> str:
        return str(self.keypair().pubkey())

    def balance_sol(self) -> float:
        return self._rpc("getBalance", [self.address(), {"commitment": "confirmed"}])["value"] / 1e9

    def airdrop(self, sol: float = 1.0) -> str:
        sig = self._rpc("requestAirdrop", [self.address(), int(sol * 1e9)])
        self._confirm(sig)
        return sig

    def _confirm(self, signature: str, timeout_s: int = 45) -> None:
        for _ in range(timeout_s):
            status = self._rpc("getSignatureStatuses", [[signature], {"searchTransactionHistory": True}])["value"][0]
            if status and status.get("err"):
                raise ChainError(f"Transaction failed: {status['err']}")
            if status and status.get("confirmationStatus") in ("confirmed", "finalized"):
                return
            time.sleep(1)
        raise ChainError(f"Transaction not confirmed after {timeout_s}s: {signature}")

    def write_memo(self, memo: str) -> str:
        from solders.hash import Hash
        from solders.instruction import AccountMeta, Instruction
        from solders.message import Message
        from solders.pubkey import Pubkey
        from solders.transaction import Transaction
        kp = self.keypair()
        blockhash = Hash.from_string(self._rpc("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]["blockhash"])
        ix = Instruction(Pubkey.from_string(MEMO_PROGRAM), memo.encode(), [AccountMeta(kp.pubkey(), True, True)])
        tx = Transaction([kp], Message.new_with_blockhash([ix], kp.pubkey(), blockhash), blockhash)
        sig = self._rpc("sendTransaction", [base64.b64encode(bytes(tx)).decode(),
                                            {"encoding": "base64", "preflightCommitment": "confirmed"}])
        self._confirm(sig)
        return sig

    def read_memo(self, signature: str) -> str:
        tx = self._rpc("getTransaction", [signature, {"encoding": "json", "commitment": "confirmed",
                                                      "maxSupportedTransactionVersion": 0}])
        if not tx:
            raise ChainError(f"Transaction not found on {NETWORK}: {signature}")
        for line in tx["meta"].get("logMessages") or []:
            if MEMO_PREFIX in line:
                return line[line.index(MEMO_PREFIX):].rstrip('"')
        raise ChainError("No CypressWatch memo in that transaction")


def explorer_url(signature: str) -> str:
    return f"https://explorer.solana.com/tx/{signature}?cluster={NETWORK}"


# ---------- the ledger ----------

class Ledger:
    def __init__(self, db_file: Path = DB_FILE, chain=None):
        self.db_file = Path(db_file)
        self.chain = chain or SolanaMemoChain()
        self.db_file.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS records (
                    record_id TEXT PRIMARY KEY, record_type TEXT NOT NULL, site_id TEXT NOT NULL,
                    created_at TEXT NOT NULL, payload TEXT NOT NULL, leaf TEXT NOT NULL,
                    batch_id TEXT, position INTEGER);
                CREATE TABLE IF NOT EXISTS batches (
                    batch_id TEXT PRIMARY KEY, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
                    merkle_root TEXT NOT NULL, records_in_root INTEGER NOT NULL,
                    transaction_signature TEXT, anchored_at TEXT, error TEXT);
            """)

    def _db(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_file)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def _content(row) -> dict:
        """The exact content that is hashed. Changing any of it changes the fingerprint."""
        return {"record_id": row["record_id"], "record_type": row["record_type"], "site_id": row["site_id"],
                "created_at": row["created_at"], "payload": json.loads(row["payload"])}

    def record(self, record_type: str, site_id: str, payload: dict, created_at: str | None = None) -> str:
        """Save a safety record and its fingerprint. Returns the ledger_record_id (e.g. "rec_1a2b3c4d")."""
        if record_type not in RECORD_TYPES:
            raise ValueError(f"record_type must be one of {RECORD_TYPES}")
        row = {"record_id": f"rec_{secrets.token_hex(4)}", "record_type": record_type, "site_id": site_id,
               "created_at": created_at or now_iso(), "payload": json.dumps(payload, sort_keys=True, ensure_ascii=False)}
        leaf = leaf_hash(self._content(row))
        with self._db() as db:
            db.execute("INSERT INTO records (record_id, record_type, site_id, created_at, payload, leaf) "
                       "VALUES (?, ?, ?, ?, ?, ?)", (*row.values(), leaf))
        return row["record_id"]

    def anchor(self) -> dict | None:
        """Combine all records not yet anchored into one Merkle root and write it to Solana. Returns the batch."""
        with self._db() as db:
            pending = db.execute("SELECT record_id, leaf, created_at FROM records WHERE batch_id IS NULL "
                                 "ORDER BY created_at, record_id").fetchall()
            unsent = db.execute("SELECT * FROM batches WHERE transaction_signature IS NULL").fetchall()
        for b in unsent:  # a batch whose transaction failed earlier: retry it first
            self._send(dict(b))
        if not pending:
            return None
        leaves = [p["leaf"] for p in pending]
        batch = {"batch_id": f"bat_{secrets.token_hex(4)}", "period_start": pending[0]["created_at"],
                 "period_end": now_iso(), "merkle_root": merkle_root(leaves), "records_in_root": len(leaves)}
        with self._db() as db:
            db.execute("INSERT INTO batches (batch_id, period_start, period_end, merkle_root, records_in_root) "
                       "VALUES (:batch_id, :period_start, :period_end, :merkle_root, :records_in_root)", batch)
            db.executemany("UPDATE records SET batch_id = ?, position = ? WHERE record_id = ?",
                           [(batch["batch_id"], i, p["record_id"]) for i, p in enumerate(pending)])
        return self._send(batch)

    def _send(self, batch: dict) -> dict:
        memo = f"{MEMO_PREFIX}:{batch['batch_id']}:{batch['merkle_root']}"
        try:
            sig = self.chain.write_memo(memo)
            update = {"transaction_signature": sig, "anchored_at": now_iso(), "error": None}
        except ChainError as e:  # records stay safe locally; the next anchor() retries this batch
            update = {"transaction_signature": None, "anchored_at": None, "error": str(e)[:300]}
        with self._db() as db:
            db.execute("UPDATE batches SET transaction_signature = :transaction_signature, anchored_at = :anchored_at, "
                       "error = :error WHERE batch_id = :batch_id", update | {"batch_id": batch["batch_id"]})
        return batch | update

    def verify(self, record_id: str) -> dict:
        """Matches LedgerVerify in contracts/types.ts."""
        with self._db() as db:
            rec = db.execute("SELECT * FROM records WHERE record_id = ?", (record_id,)).fetchone()
            if rec is None:
                raise KeyError(f"Unknown record {record_id}")
            batch = db.execute("SELECT * FROM batches WHERE batch_id = ?", (rec["batch_id"],)).fetchone()
            leaves = [r["leaf"] for r in db.execute(
                "SELECT leaf FROM records WHERE batch_id = ? ORDER BY position", (rec["batch_id"],))] if batch else []

        computed = leaf_hash(self._content(rec))  # from what is stored NOW
        out = {"record_id": record_id, "record_type": rec["record_type"], "site_id": rec["site_id"], "verified": False,
               "computed_hash": computed, "merkle_root_onchain": "", "merkle_root_from_proof": "",
               "period_start": batch["period_start"] if batch else rec["created_at"],
               "period_end": batch["period_end"] if batch else "", "records_in_root": batch["records_in_root"] if batch else 0,
               "network": NETWORK, "transaction_signature": "", "explorer_url": "", "checked_at": now_iso(), "message": ""}
        if not batch or not batch["transaction_signature"]:
            out["message"] = "This record is saved but not anchored on Solana yet. It will be included in the next batch."
            return out

        proof = merkle_proof(leaves, rec["position"])
        out["merkle_root_from_proof"] = root_from_proof(computed, proof)
        out["transaction_signature"] = batch["transaction_signature"]
        out["explorer_url"] = explorer_url(batch["transaction_signature"])
        try:
            memo = self.chain.read_memo(batch["transaction_signature"])
            found = re.search(r"([0-9a-f]{64})", memo.split(":")[-1])
            out["merkle_root_onchain"] = found.group(1) if found else ""
        except ChainError as e:
            out["message"] = f"Could not read Solana right now ({e}). Try again in a moment."
            return out

        out["verified"] = out["merkle_root_from_proof"] == out["merkle_root_onchain"]
        out["message"] = ("This record matches the root stored on Solana. It has not been changed." if out["verified"]
                          else "This record does not match the root stored on Solana. It was changed after it was anchored.")
        return out

    def tamper(self, record_id: str, key: str = "tampered", value="yes") -> None:
        """DEMO ONLY: edit a stored record directly in the database, as an attacker would."""
        with self._db() as db:
            payload = json.loads(db.execute("SELECT payload FROM records WHERE record_id = ?", (record_id,)).fetchone()[0])
            payload[key] = value
            db.execute("UPDATE records SET payload = ? WHERE record_id = ?", (json.dumps(payload, sort_keys=True), record_id))

    def status(self) -> dict:
        with self._db() as db:
            return {"records": db.execute("SELECT COUNT(*) FROM records").fetchone()[0],
                    "pending": db.execute("SELECT COUNT(*) FROM records WHERE batch_id IS NULL").fetchone()[0],
                    "batches": [dict(b) for b in db.execute("SELECT * FROM batches ORDER BY period_end DESC LIMIT 5")]}


# ---------- command line ----------

def _print_verify(v: dict) -> None:
    mark = "VERIFIED" if v["verified"] else "NOT VERIFIED"
    print(f"  {v['record_id']} ({v['record_type']}, {v['site_id']}): {mark}")
    print(f"    {v['message']}")
    if v["merkle_root_onchain"]:
        print(f"    root on Solana : {v['merkle_root_onchain']}")
        print(f"    root from proof: {v['merkle_root_from_proof']}")
        print(f"    {v['records_in_root']} records in this root · {v['explorer_url']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("setup", help="create a devnet wallet and get free test SOL")
    sub.add_parser("demo", help="record sample events, anchor on Solana, verify, tamper, verify again")
    sub.add_parser("anchor", help="anchor all pending records now")
    sub.add_parser("status")
    v = sub.add_parser("verify")
    v.add_argument("record_id")
    args = ap.parse_args()

    chain = SolanaMemoChain()
    if args.cmd == "setup":
        kp = chain.keypair(create=True)
        print(f"Wallet: {kp.pubkey()}  (saved to {KEYPAIR_FILE}, keep it out of git)")
        try:
            if chain.balance_sol() < 0.05:
                print("Requesting 1 free devnet SOL...")
                chain.airdrop(1.0)
            print(f"Balance: {chain.balance_sol():.4f} SOL on {NETWORK}. Each anchor costs about 0.000005 SOL.")
        except ChainError as e:
            print(f"Airdrop failed ({e}).\nGet free devnet SOL at https://faucet.solana.com for address {kp.pubkey()}")
        return

    ledger = Ledger(chain=chain)
    if args.cmd == "demo":
        print("1. Recording safety events (instant, local)")
        ids = [
            ledger.record("stop_work", "site_6043", {"alert_id": "alt_demo1", "reason": "lightning",
                                                     "nearest_strike_miles": 6.2, "stop_work_until": "2026-10-17T19:30:00Z"}),
            ledger.record("acknowledgment", "site_6043", {"alert_id": "alt_demo1", "user_id": "auth0|crew_014"}),
            ledger.record("crew_report", "site_6043", {"report_id": "rpt_demo1", "hazard": "wildlife", "severity": "high"}),
            ledger.record("all_clear", "site_6043", {"alert_id": "alt_demo1", "cleared_at": "2026-10-17T19:30:00Z"}),
        ]
        print(f"   {ids}")
        print("2. Anchoring one Merkle root for all of them on Solana devnet...")
        b = ledger.anchor()
        if not b or not b.get("transaction_signature"):
            print(f"   Anchor failed: {b and b.get('error')}\n   Run 'setup' first, or try again in a minute.")
            return
        print(f"   root {b['merkle_root'][:16]}... in tx {b['transaction_signature'][:20]}...")
        print(f"   {explorer_url(b['transaction_signature'])}")
        print("3. Verifying the stop-work record")
        _print_verify(ledger.verify(ids[0]))
        print("4. Tampering: someone edits the stop-work in the database (lightning 6.2 mi -> 12.0 mi)")
        ledger.tamper(ids[0], "nearest_strike_miles", 12.0)
        print("5. Verifying again")
        _print_verify(ledger.verify(ids[0]))
        print("6. The other records in the same root are still fine")
        _print_verify(ledger.verify(ids[1]))
    elif args.cmd == "anchor":
        b = ledger.anchor()
        print("Nothing pending." if b is None else
              f"Anchored {b['records_in_root']} records: {explorer_url(b['transaction_signature'])}"
              if b.get("transaction_signature") else f"Anchor failed, will retry: {b['error']}")
    elif args.cmd == "verify":
        _print_verify(ledger.verify(args.record_id))
    elif args.cmd == "status":
        print(json.dumps(ledger.status(), indent=2))


if __name__ == "__main__":
    sys.exit(main())