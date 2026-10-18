# CypressWatch Crew app: start here (no experience needed)

This is the phone app for crews. Right now it runs on **demo data** (made-up
sample sites from `src/contracts/mocks/`), so it works with no backend.
It is clearly labeled "Demo data" on every screen.

## What you can try in the app

- **Site tab:** red STOP WORK countdown (30 minutes), hazard score, hazards, conditions.
  Press "I have stopped work" to confirm. Press "Simulate a lightning strike" at the bottom
  to restart the countdown at 30:00. "Reset demo" starts everything over.
- **Briefing tab:** tomorrow's briefing with the best work window.
- **Map tab:** your site and hazard reports. No street map on purpose, so it works offline.
- **Report tab:** take a photo, pick a hazard, send. With no signal it saves on the phone
  and uploads on its own when signal returns.
- **Offline test:** open the app, turn on airplane mode, reload. The countdown keeps running.

## One-time setup on your computer

You need a terminal (Mac: open "Terminal". Windows: open "PowerShell").

1. Install Node.js 22 or newer from https://nodejs.org (choose "LTS"). Close and reopen the terminal.
2. Check it worked:  `node --version`  (should say v22 or higher)
3. Update npm (this app needs npm 11.6+):  `npm install -g npm@latest`
4. Unzip `cypresswatch-crew.zip`, then in the terminal go into the folder:  `cd path/to/cypresswatch-crew`
   (tip: type `cd ` then drag the folder into the terminal window)
5. Install the app's parts (takes a minute):  `npm install`

## Put it online (gets you a link to open on your phone)

1. Log in to DeepSpace:  `npx deepspace auth login`
   A browser tab opens. Sign in or create a free DeepSpace account there. Wait for the terminal to say you are logged in.
2. Confirm which account it is:  `npx deepspace auth whoami --json`
3. Deploy:  `npx deepspace deploy`
   The first deploy creates the app and prints its web address (expected: `https://cypresswatch-crew.app.space`).
   If it says a deploy slot or quota is used up, that is an account limit: free a slot or upgrade in DeepSpace.
4. Open that address on your phone. To install it: iPhone Safari > Share > Add to Home Screen.
   Android Chrome > menu > Install app.

## Just look at it on your computer first

`npx deepspace dev start` runs it locally and prints a localhost address. (It also needs the login step above.)

## Switching from demo data to the real backend (later, with M4)

1. Open the file `.env` in this folder.
2. Change `VITE_USE_MOCKS=true` to `VITE_USE_MOCKS=false` and add the backend address:
   `VITE_API_URL=https://your-backend-address`
3. Deploy again (`npx deepspace deploy`). No screen code changes.
Note: the backend currently expects Auth0 login tokens (see DEEPSPACE_AUTH0_CHECK notes). Settle that with the team first;
until then the real mode will answer "unauthorized".

## Where things are (so you can find your way around)

| Folder / file | What it is |
| --- | --- |
| `src/pages/(app)/` | The four screens: `home.tsx` (Site), `briefing.tsx`, `map.tsx`, `report.tsx` |
| `src/components/CrewShell.tsx` | Top bar, "last updated" strip, bottom tabs |
| `src/lib/crewData.tsx` | Loads data, saves a copy on the phone, replays queued actions |
| `src/lib/queue.ts` | The offline queue (stored in the phone's IndexedDB) |
| `src/lib/demoTime.ts` | Demo mode: moves sample times to "now" so the countdown is live |
| `src/contracts/` | The team's shared API agreement (copied from `contracts/`) |
| `public/sw.js`, `public/manifest.webmanifest` | Make it installable and work offline |

## How to test "works without signal" properly

1. Open the app address on your phone **with signal**. Wait until the strip at the top says
   **"Online. Saved for offline use"** (a few seconds). Do not turn signal off before you see that.
2. Now turn on airplane mode and close and reopen the app. It should open normally, show
   "No signal: showing saved data", and the countdown keeps running.
3. Still offline, tap each tab (Briefing, Map, Report). They all open.

If it still opens blank offline after a new deploy: delete the app from your home screen, open the
address in the browser with signal again, wait for "Saved for offline use", then re-add it.

## If something goes wrong

- "command not found: node / npx": redo step 1 and reopen the terminal.
- "npm 11.6+ required" or a strange install crash: redo step 3.
- Countdown shows "No stop-work": press "Reset demo" (or "Simulate a lightning strike").
- App looks old after a deploy: close and reopen it once (the offline copy refreshes on the second open).


---

## Update: sign-in

The app now asks crews to sign in with Google (through DeepSpace). Read `AUTH_NOTES.md` for what
it does and what is still open. To test after redeploying:
1. Open the site on your phone, tap **Sign in**, choose Google.
2. Confirm your name shows top right and the countdown appears.
3. Turn on airplane mode and reload: the app should still open, with a yellow "Sign-in not re-checked yet" note.
4. Turn airplane mode off, wait a few seconds: the note should go away.
5. Tap the sign-out button (top right): you should see the sign-in panel again.


---

## Update: live sync (two-phone test)

You need two phones, or a phone and a laptop, signed in with two different Google accounts.
1. Open the site on both. In **Demo controls** on the Site tab, both should say "Live link to other phones: connected".
2. On phone A tap **Simulate a lightning strike**. Phone B's countdown should jump to about 30:00 within a few seconds.
3. On phone B tap **I have stopped work**. Phone A should show "1 confirmed stopped: (B's name)".
4. On phone A send a hazard report. Phone B's **Map** tab should show it.
5. Put phone B in airplane mode, tap **I have stopped work** on a new strike, then turn signal back on. Phone A should see it.
6. Tap **Reset demo** on either phone. Both countdowns should leave the simulated strike.
Read `SYNC_NOTES.md` for what is and is not shared.
