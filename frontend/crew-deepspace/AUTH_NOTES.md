# Sign-in for the crew app: what was built and what is assumed

## Assumption (not confirmed with DeepSpace yet)
DeepSpace sign-in and Auth0 are treated as NOT compatible. So crews sign in with
**DeepSpace (Google account)**. Auth0 is not used in the crew app. If DeepSpace later
confirms Auth0 works, this is the only part that needs to change: `src/lib/access.tsx`
and the token getter in `src/lib/crewData.tsx`.

## What a crew member sees
- First time, with signal: "Sign in to open your site" -> Google sign-in -> app opens.
- Next times: app opens straight away, even with no signal.
- No signal, signed in before: app opens with a yellow note
  "Sign-in not re-checked yet. It checks again when signal returns."
- Never signed in and no signal: a sign-in panel that says you need signal once.
- Weak signal where the sign-in check hangs: the screen is never blank. After about 6 seconds
  the app opens (if signed in before) or shows "Checking your sign-in...".
- Sign out button (top right) removes that person's saved data from the phone.

## How it works (plain words)
- `src/lib/access.tsx` decides one of four states: checking / signed-in / unverified / signed-out.
- "unverified" means: the phone remembers this person signed in before (a small note in
  localStorage, `cw:auth-hint`) but cannot reach DeepSpace right now.
- **This is a convenience, not security.** Anyone can edit localStorage. It only decides what
  the screen shows. Real protection is the server checking the token (see below).
- Each person's saved data uses their own keys (`cw:crew-cache:<userId>`, etc), and queued
  offline reports are tagged with `owner_user_id`. A second person on a shared phone never
  sees or uploads the first person's items.

## Things the team must decide / build
1. **Backend must verify the DeepSpace token** on every request. The app sends
   `Authorization: Bearer <DeepSpace JWT>` (from `getAuthToken()`). The contract assumed Auth0 tokens.
2. **Roles don't match.** DeepSpace has viewer / member / admin. The plan has
   crew / supervisor / project_owner. Needs a mapping table on the backend.
3. **Which site is this person on?** Not built. Everyone sees the sample site. Needs a
   user -> site assignment from the backend.
4. **Login methods:** only Google. The app has its own sign-in button that goes straight to
   `/api/auth/social-redirect?provider=google` (`startGoogleSignIn` in `src/lib/access.tsx`), because
   the DeepSpace sign-in box also shows an email/password form that cannot create accounts.
   Adding GitHub means adding a second button that uses `provider=github`.
   If crews won't all have Google accounts, the team needs another sign-in method.
5. **Sign out with no signal:** the phone forgets the person locally, but the server session
   stays valid until it expires. Signing in again needs signal.

## What was tested, and what was NOT
Tested in a simulated browser with a fake sign-in endpoint: signed in, signed out, sign-in
check hanging, offline reload when signed in before, sign out clearing data, and the earlier
offline/queue tests still passing.
**Not tested:** the real Google sign-in against DeepSpace (the test environment can't reach it).
Please try it on a phone after deploying and tell me what happens.
