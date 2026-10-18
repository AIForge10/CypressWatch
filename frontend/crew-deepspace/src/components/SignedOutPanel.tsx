import { LogIn, Users, WifiOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BigButton, Card, Screen } from './ui-bits'
import { startGoogleSignIn } from '../lib/access'
import { useT } from '../lib/i18n'

/** Shown instead of the crew screens until someone signs in. */
export function SignedOutPanel({ checking, online }: { checking: boolean; online: boolean }) {
  const { t } = useT()
  if (checking) {
    return (
      <Screen title={t('out.checkingTitle')}>
        <p role="status" className="text-lg">{t('out.checking')}</p>
      </Screen>
    )
  }
  return (
    <Screen title={t('out.title')}>
      <Card>
        <p className="text-lg leading-relaxed">{t('out.why')}</p>
        {!online && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-caution px-2 py-1.5 text-base font-bold">
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> {t('out.noSignal')}
          </p>
        )}
        <div className="mt-4">
          <BigButton data-testid="sign-in-with-google" disabled={!online} onClick={startGoogleSignIn}>
            <LogIn className="h-6 w-6" aria-hidden /> {t('out.google')}
          </BigButton>
        </div>
      </Card>
    </Screen>
  )
}

/** Signed in, but no site yet (or still finding out). */
export function SiteWaitPanel({ mode, online, isAdmin }: { mode: 'checking' | 'none'; online: boolean; isAdmin: boolean }) {
  const { t } = useT()
  if (mode === 'checking') {
    return (
      <Screen title={t('wait.findingTitle')}>
        <p role="status" className="text-lg">{t('wait.finding')}</p>
        {!online && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-caution px-2 py-1.5 text-base font-bold">
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> {t('wait.findingOffline')}
          </p>
        )}
      </Screen>
    )
  }
  return (
    <Screen title={t('wait.noneTitle')}>
      <Card>
        <p data-testid="no-site" className="text-lg leading-relaxed">
          {isAdmin ? t('wait.noneAdmin') : t('wait.noneCrew')}
        </p>
        {isAdmin && (
          <div className="mt-4">
            <Link to="/team" className="inline-flex min-h-14 items-center gap-2 rounded-lg bg-primary px-5 text-lg font-bold text-primary-foreground">
              <Users className="h-6 w-6" aria-hidden /> {t('wait.openTeam')}
            </Link>
          </div>
        )}
      </Card>
    </Screen>
  )
}
