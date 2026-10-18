# Site assignment

Each crew member sees only their own site.

## Demo mode (what runs now)
- An **admin** (the app owner's Google account) gets a **Team** tab. It lists everyone who has signed in, with a Site dropdown per person.
- Pick a site and it saves right away. The person's phone switches to that site within a second or two.
- "No site" removes the assignment. That person sees "No site assigned yet" until you pick one.
- Signed in but not assigned? The app says so, and updates by itself when an admin assigns a site.
- The phone remembers the assignment, so the app still opens at the right site with no signal.
- Live sync (strike, confirmations, reports) is per site: two people on different sites do not see each other's strikes.
- The sample world has one set of hazard numbers. Every site shows the same sample numbers under its own name (the site list is the team's sample list).

## Where it lives
- Collection `site_assignments` (`src/schemas/site-assignments-schema.ts`): one row per person, only admins can write.
- `src/lib/assignment.tsx`: reads the person's row and role. `src/pages/(app)/team.tsx`: the admin screen.
- `src/pages/(app)/_layout.tsx`: shows the "no site" screen, and passes the site to the data layer.

## Limits
- Crew can read the assignment list (names and sites only). DeepSpace cannot yet restrict a read to "rows about me" for rows someone else created.
- The shared records (`crew_acks`, `crew_reports`, `demo_strike`) are filtered by site in the app, not on the server. A determined signed-in user could read other sites' rows.
- Real mode: the site comes from `GET /api/me` (`site_ids`). The server must enforce it. The Team screen is demo only.
- Deploy once after applying this update (new collection).

## Reset demo only affects your own site
- Saved copies on the phone (site data, confirmations, reports, clock, strike) are kept per person AND per site.
- Reset demo clears only your site's shared strike, confirmations and reports, and only your own saved copy and waiting uploads on this phone.
- "Did I confirm?" also reads the shared confirmation list, so clearing a phone's storage cannot bring the button back.
