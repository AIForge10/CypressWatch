# Live sync between phones (demo mode)

Built on DeepSpace records. Works only when `VITE_USE_MOCKS=true`. In real mode the backend (M4) owns
stop-work, confirmations and reports, so this layer is switched off.

## What syncs
| What | How it shows up |
|---|---|
| **Simulated strike** | "Simulate a lightning strike" on one phone starts the 30-minute countdown on every signed-in phone. "Reset demo" clears it for everyone. |
| **"I have stopped work"** | The red card shows "N confirmed stopped: names". |
| **Hazard reports** | Appear on teammates' Map tab (text, place and hazard). **Photos stay on the phone that took them**, and the AI suggestion only shows on the sender's phone. |

## Reset demo
"Reset demo" clears the simulated strike, the confirmations and the shared reports for everyone, and each phone also
clears its own saved confirmations and reports. Nothing is deleted from DeepSpace (members cannot delete other people's
records, on purpose). Instead the reset time is saved in `demo_strike` as a second row keyed `<site>#reset`, and every phone
ignores confirmations and reports older than it. Confirmations store `<alert>@<reset time>` so the same alert can be confirmed again after a reset.

## The sample countdown is shared too
The sample site starts with a stop-work countdown. All phones now start that sample clock from the same shared moment:
the first phone to connect saves it, and "Reset demo" sets a new one. So every phone shows the same time, with or without a simulated strike.
A phone's own clock still matters: if it is off by seconds, its timer is off by seconds.

## How it works
- Three collections (`src/schemas/crew-sync-schema.ts`): `demo_strike`, `crew_acks`, `crew_reports`.
- `src/components/SyncBridgeReal.tsx` is the only file that touches DeepSpace records. `src/lib/crewData.tsx` uses it.
- DeepSpace drops ordinary writes made with no connection, so the phone keeps its own queue (as before) and
  sends through DeepSpace when the live link is up. Until then, confirmations and reports show as "Waiting to upload".
- The last shared strike is saved on the phone, so an offline phone keeps showing the countdown it knew about.
- The server stamps `user_id` on every confirmation and report from the login, so nobody can confirm as someone else.

## Limits and decisions for the team
1. **Any signed-in person can start a simulated strike for everyone.** Fine for a labeled demo. Before real use,
   make `demo_strike` admin-only in `crew-sync-schema.ts` (change the `member` line) or remove it. Real stop-work
   must come from the server, never from a phone.
2. **No site filtering on the server yet.** Everyone sees the one sample site. `site_id` filtering is for convenience only.
3. **Clocks:** the countdown uses the pressing phone's clock. Phones with clocks that differ by seconds show slightly different times.
4. **A phone that joins later** sees the latest shared strike, so an old one shows as "Countdown finished". Use Reset demo.
5. **Photos are not shared** (records are not for large files). A real photo path needs the backend or DeepSpace file storage.
6. **If the live link never connects** (for example DeepSpace is down), confirmations and reports stay "Waiting to upload".

## Tested / not tested
Tested with two simulated phones against a stand-in for DeepSpace records: strike reaches the other phone, confirmations
and reports cross over, an offline confirmation sends when signal returns, an offline phone catches up on a missed strike,
reset clears for both, and the stand-in is not in the real build.
**Not tested:** the real DeepSpace connection. Please test on two phones after deploying.
