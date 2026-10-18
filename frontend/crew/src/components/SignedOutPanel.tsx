import { LogIn, Users, WifiOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BigButton, Card, Screen } from './ui-bits'
import { startGoogleSignIn } from '../lib/access'

/** Shown instead of the crew screens until someone signs in. */
export function SignedOutPanel({ checking, online }: { checking: boolean; online: boolean }) {
  if (checking) {
    return (
      <Screen title="CypressWatch">
        <p role="status" className="text-lg">Checking your sign-in...</p>
      </Screen>
    )
  }
  return (
    <Screen title="Sign in to open your site">
      <Card>
        <p className="text-lg leading-relaxed">Your supervisor needs to know who is on site. Sign in once with Google. After that, the app opens without signal.</p>
        {!online && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-caution px-2 py-1.5 text-base font-bold">
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> No signal. Connect to the internet once to sign in.
          </p>
        )}
        <div className="mt-4">
          <BigButton data-testid="sign-in-with-google" disabled={!online} onClick={startGoogleSignIn}>
            <LogIn className="h-6 w-6" aria-hidden /> Sign in with Google
          </BigButton>
        </div>
      </Card>
    </Screen>
  )
}

/** Signed in, but no site yet (or still finding out). */
export function SiteWaitPanel({ mode, online, isAdmin }: { mode: 'checking' | 'none'; online: boolean; isAdmin: boolean }) {
  if (mode === 'checking') {
    return (
      <Screen title="Finding your site">
        <p role="status" className="text-lg">Checking which site you work at...</p>
        {!online && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-caution px-2 py-1.5 text-base font-bold">
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> No signal. Connect once so the app can find your site.
          </p>
        )}
      </Screen>
    )
  }
  return (
    <Screen title="No site assigned yet">
      <Card>
        <p data-testid="no-site" className="text-lg leading-relaxed">
          {isAdmin ? 'You are an admin. Assign yourself and your crew to sites on the Team tab.' : 'Ask your supervisor to assign you to a site. This page updates by itself once they do.'}
        </p>
        {isAdmin && (
          <div className="mt-4">
            <Link to="/team" className="inline-flex min-h-14 items-center gap-2 rounded-lg bg-primary px-5 text-lg font-bold text-primary-foreground">
              <Users className="h-6 w-6" aria-hidden /> Open Team
            </Link>
          </div>
        )}
      </Card>
    </Screen>
  )
}
