/**
 * Static front door (no auth call, no realtime connection). Crews who install
 * the app land on /home directly via the manifest start_url.
 */
import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="max-w-md text-4xl font-bold">CypressWatch Crew</h1>
        <p className="max-w-md text-lg">
          Stop-work countdown, site risk, and hazard reports for power plant crews. Install it on your phone and it keeps working without signal.
        </p>
        <Link to="/home" className="flex min-h-14 items-center rounded-xl bg-primary px-8 text-lg font-bold text-primary-foreground">
          Open the crew app
        </Link>
      </div>
    </>
  )
}
