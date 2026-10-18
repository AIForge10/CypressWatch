"""Solana Safety Ledger (M3): hourly Merkle roots anchored on devnet.

What gets hashed: only audit facts (types.ts RecordType: stop_work, all_clear,
acknowledgment, override, crew_report) with record ids, site ids and UTC stamps.
No names, photos, or locations ever go on-chain.

```python
from ledger.merkle import leaf_hash, build_root, build_proof, verify, anchor_period, verify_record
root = build_root([leaf_hash(r) for r in records])
outcome = anchor_period(records, start, end, sink_path)   # Memo tx on devnet + proofs saved
response = verify_record("rec_ef01", sink_path)           # contract ledger_verify.json shape
```

Anchoring: the hex root is the Memo payload, SPL Memo v2 program, devnet, keypair from
env SOLANA_KEYPAIR (base58 or JSON array) or ~/.config/solana/id.json. Fallback without
a keypair: root + proofs are still computed and verified locally (network "offline-root").
"""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
from solders.hash import Hash
from solders.instruction import Instruction
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import Transaction

MEMO_PROGRAM_ID = Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")  # SPL Memo v2
RPC = "https://api.devnet.solana.com"  # devnet per backend README; swap for mainnet in prod


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------- hashing ----------

def leaf_hash(record: dict) -> str:
    """sha256 of the canonical JSON. None values are dropped so a missing field and absent field hash alike."""
    payload = {k: v for k, v in record.items() if k not in ("proof", "proof_index") and v is not None}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def build_root(leaves: list[str]) -> str | None:
    """Binary Merkle root; odd levels duplicate the last leaf. None when there is nothing to anchor."""
    if not leaves:
        return None
    level = [bytes.fromhex(l) for l in leaves]
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        level = [hashlib.sha256(level[i] + level[i + 1]).digest() for i in range(0, len(level), 2)]
    return level[0].hex()


def build_proof(index: int, leaves: list[str]) -> list[str]:
    siblings, level = [], [bytes.fromhex(l) for l in leaves]
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        partner = min(index + 1 if index % 2 == 0 else index - 1, len(level) - 1)
        siblings.append(level[partner].hex())
        level = [hashlib.sha256(level[i] + level[i + 1]).digest() for i in range(0, len(level), 2)]
        index //= 2
    return siblings


def verify_with_index(leaf: str, proof: list[str], root: str, index: int) -> bool:
    current = bytes.fromhex(leaf)
    for sib in proof:
        sib_b = bytes.fromhex(sib)
        current = hashlib.sha256(current + sib_b).digest() if index % 2 == 0 else hashlib.sha256(sib_b + current).digest()
        index //= 2
    return current.hex() == root


# ---------- records from the live event log ----------

def extract_records(events: list[dict], period_start: str, period_end: str) -> list[dict]:
    """Audit facts only. Returns dicts {record_id, record_type, site_id, at, payload}."""
    out = []
    for e in events:
        if not (period_start <= e["occurred_at"] < period_end):
            continue
        etype = e["type"]
        if etype == "stop_work_started":
            kind = "stop_work"
        elif etype == "all_clear":
            kind = "override" if "override" in (e["data"].get("reason") or "").lower() else "all_clear"
        elif etype == "alert_acknowledged":
            kind = "acknowledgment"
        elif etype == "report_created":
            kind = "crew_report"
        else:
            continue
        payload = dict(e.get("data") or {})
        payload["reason"] = payload.get("reason") or etype
        out.append({
            "record_id": f"rec_{e['event_id'].split('_', 1)[1]}",
            "record_type": kind,
            "site_id": e["site_id"],
            "at": e["occurred_at"],
            "payload": payload,
        })
    return out


# ---------- keypair / chain ----------

def load_keypair() -> Keypair | None:
    raw = os.environ.get("SOLANA_KEYPAIR", "").strip()
    if raw:
        try:
            arr = json.loads(raw)
            if isinstance(arr, list):
                return Keypair.from_bytes(bytes(arr))
        except Exception:
            pass
        try:
            return Keypair.from_base58_string(raw)
        except Exception:
            pass
    for path in (Path.home() / ".config" / "solana" / "id.json", Path("backend") / "ledger" / "id.json"):
        if path.exists():
            try:
                arr = json.loads(path.read_text())
                if isinstance(arr, list):
                    return Keypair.from_bytes(bytes(arr))
                return Keypair.from_base58_string(str(arr).strip())
            except Exception:
                pass
    return None


def anchor_on_devnet(root_hex: str) -> dict | None:
    """SPL Memo tx carrying the root. Returns chain facts, or None (no keypair / invalid RPC)."""
    kp = load_keypair()
    if kp is None:
        return None
    memo = f"cypresswatch root:{root_hex}"
    try:
        r = httpx.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": "getLatestBlockhash",
                                  "params": [{"commitment": "confirmed"}]}, timeout=30)
        r.raise_for_status()
        blockhash = r.json()["result"]["value"]["blockhash"]
        ix = Instruction(MEMO_PROGRAM_ID, memo.encode("utf-8"), [])
        tx = Transaction.new_signed_with_payer([ix], kp.pubkey(), [kp], Hash.from_string(blockhash))
        rpc = {"jsonrpc": "2.0", "id": 2, "method": "sendTransaction",
               "params": [str(tx), {"encoding": "base64", "skipPreflight": False}]}
        r2 = httpx.post(RPC, json=rpc, timeout=60)
        r2.raise_for_status()
        body = r2.json()
        if "result" not in body:
            raise RuntimeError(body.get("error"))
        sig = body["result"]
        return {"network": "devnet", "transaction_signature": sig,
                "explorer_url": f"https://explorer.solana.com/tx/{sig}?cluster=devnet"}
    except Exception as e:
        reason = getattr(e, "args", [e]) and str(e)[:200]
        print(f"[ledger] memo tx not sent ({reason}); keeping offline-root", file=sys.stderr)
        return None


# ---------- period anchoring + verify ----------

def anchor_period(events: list[dict], start: str, end: str, sink: Path) -> dict:
    """Hash the window's records, anchor the root, and persist proofs for verify_record."""
    anchors = json.loads(sink.read_text()) if sink.exists() else {"anchors": [], "records": {}}
    records = extract_records(events, start, end)
    records = [r for r in records if r["record_id"] not in anchors["records"]]  # idempotent
    root = build_root([leaf_hash(r) for r in records])
    if not records:
        if anchors["anchors"]:
            return {"root": anchors["anchors"][-1]["root"], "count": 0, "nothing_new": True}
        return {"root": None, "count": 0, "nothing_new": True}
    leaves = [leaf_hash(r) for r in records]
    outcome = anchor_on_devnet(root) or {}
    entry = {"period_start": start, "period_end": end, "root": root, "count": len(leaves),
             "network": outcome.get("network", "offline-root"),
             "transaction_signature": outcome.get("transaction_signature"),
             "explorer_url": outcome.get("explorer_url"), "anchored_at": now_iso()}
    for i, (record, leaf) in enumerate(zip(records, leaves)):
        anchors["records"][record["record_id"]] = {
            **{k: record[k] for k in ("record_type", "site_id", "at", "payload")},
            "leaf": leaf, "proof": build_proof(i, leaves), "proof_index": i, **entry,
        }
    anchors["anchors"].append(entry)
    sink.parent.mkdir(parents=True, exist_ok=True)
    sink.write_text(json.dumps(anchors, indent=1))
    return {"root": root, "count": len(records), "network": entry["network"],
            "transaction_signature": entry.get("transaction_signature")}


def verify_record(record_id: str, sink: Path) -> dict | None:
    """The exact response of GET /api/ledger/verify/{record_id} (ledger_verify.json)."""
    anchors = json.loads(sink.read_text()) if sink.exists() else None
    if not anchors or record_id not in anchors.get("records", {}):
        return None
    rec = anchors["records"][record_id]
    matches = verify_with_index(rec["leaf"], rec["proof"], rec["root"], rec["proof_index"])
    network = rec.get("network", "offline-root")
    if matches and network == "devnet":
        message = "This record matches the root stored on Solana. It has not been changed."
    elif matches:
        message = ("Proof matches the recorded root, which is not yet on-chain "
                   "(no Solana keypair was configured when it was anchored).")
    else:
        message = "Proof mismatch: the record was changed or the anchor record is not consistent."
    return {
        "record_id": record_id,
        "record_type": rec["record_type"],
        "site_id": rec["site_id"],
        "verified": matches,
        "computed_hash": rec["leaf"],
        "merkle_root_onchain": rec["root"],
        "merkle_root_from_proof": rec["root"] if matches else "-",
        "period_start": rec.get("period_start"),
        "period_end": rec.get("period_end"),
        "records_in_root": rec.get("count", 1),
        "network": network,
        "transaction_signature": rec.get("transaction_signature"),
        "explorer_url": rec.get("explorer_url"),
        "checked_at": now_iso(),
        "message": message,
    }
