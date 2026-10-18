# Notes for the team on contract v0.1 (from building the crew app)

1. Offline queue: added `kind: "acknowledge"` with payload `{ alert_id }` so stop-work confirmations also
   work with no signal. Not in v0.1; please add to `offline_queue_item.json` / `types.ts` if kept.
2. Demo mode shifts every sample timestamp to "now" on first run (the sample data is stamped Oct 17 2026 18:42Z,
   so its countdown would already be over). Real mode does no shifting.
3. `site_detail.json` is always site_012; `me_crew.json` is used for the crew user in demo mode.
4. Briefing language: only English sample exists. `available_languages` lists "es"; the crew app has no
   language switch yet because there is no Spanish sample to show.
5. `SiteSummary` has no total site count, so the app shows "Site rank N (1 = highest risk)".
6. Report photos: the app shrinks photos to max 1280px JPEG before queuing; the demo triage is a labeled sample.


## Auth assumption change
The contract assumes Auth0 bearer tokens. The crew app now sends a **DeepSpace JWT** instead (we assumed the two
are not compatible). The backend needs to accept and verify DeepSpace tokens, and map DeepSpace roles
(viewer/member/admin) to crew/supervisor/project_owner. See `AUTH_NOTES.md`.
