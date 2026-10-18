# Solana Safety Ledger

- `merkle/`: Python hashing + hourly per-site Merkle roots + proofs.
- `program/`: Anchor program `anchor_root(site_id, period, root, count)` on devnet.
  Generate it with `cd ledger && anchor init program` when you start.
  Fallback if Anchor stalls: the SPL Memo program.

Only hashes, counts, and timestamps go on-chain. No names, photos, or locations.

Devnet setup:
```bash
solana config set --url devnet
solana-keygen new -o ~/.config/solana/id.json   # never commit keypairs
solana airdrop 2
```
