import { useState } from 'react'
import { AuthOverlay } from 'deepspace'
import { LogIn, WifiOff } from 'lucide-react'
import { BigButton, Card, Screen } from './ui-bits'

/** Shown instead of the crew screens until someone signs in. */
export function SignedOutPanel({ checking, online }: { checking: boolean; online: boolean }) {
  const [open, setOpen] = useState(false)
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
          <p className="mt-3 flex items-start gap-2 rounded-md bg-warning px-2 py-1.5 text-base font-bold">
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> No signal. Connect to the internet once to sign in.
          </p>
        )}
        <div className="mt-4">
          <BigButton data-testid="sign-in-with-google" disabled={!online} onClick={() => setOpen(true)}>
            <LogIn className="h-6 w-6" aria-hidden /> Sign in with Google
          </BigButton>
        </div>
      </Card>
      {open && (
        <AuthOverlay
          providers={['google']}
          title="Sign in to CypressWatch"
          description="Your supervisor sees who is on site."
          onClose={() => setOpen(false)}
        />
      )}
    </Screen>
  )
}
