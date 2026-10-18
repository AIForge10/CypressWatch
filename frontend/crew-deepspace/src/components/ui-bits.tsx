import type { ReactNode } from 'react'
import { AlertTriangle, CircleAlert, CircleCheck, ShieldAlert, type LucideIcon } from 'lucide-react'
import type { HazardKey, RiskLevel } from '../contracts/types'
import { HAZARDS, LEVELS } from '../lib/hazards'
import { cn } from '../lib/utils'

/** Page header copies the supervisor's PageHeader: small green eyebrow, big tight title, optional description. */
export function Screen({ title, eyebrow = 'Crew workspace', description, columns = false, children }: { title: string; eyebrow?: string; description?: string; /** Two columns on wide screens (cards may add `xl:col-span-2` to span both). */ columns?: boolean; children: ReactNode }) {
  return (
    <div className={cn('mx-auto flex w-full flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-8', columns ? 'max-w-[1400px]' : 'max-w-3xl')}>
      <header className="mb-1">
        <p className="mb-1.5 text-[13px] font-bold uppercase tracking-[0.1em] text-primary">{eyebrow}</p>
        <h1 className="text-[clamp(25px,7vw,32px)] font-extrabold leading-tight tracking-[-0.035em]">{title}</h1>
        {description && <p className="mt-2 leading-relaxed text-muted-foreground">{description}</p>}
      </header>
      <div className={columns ? 'grid items-start gap-4 xl:grid-cols-2' : 'flex flex-col gap-4'}>{children}</div>
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-xl border border-border bg-card p-4 shadow-card', className)}>{children}</section>
}

const LEVEL_ICON: Record<RiskLevel, LucideIcon> = { low: CircleCheck, moderate: CircleAlert, high: AlertTriangle, extreme: ShieldAlert }

/** Level as icon + word. Never color alone. */
export function LevelBadge({ level }: { level: RiskLevel }) {
  const Icon = LEVEL_ICON[level]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold', LEVELS[level].cls)}>
      <Icon className="h-4 w-4" aria-hidden />
      {LEVELS[level].label}
    </span>
  )
}

export function HazardName({ hazard, className }: { hazard: HazardKey; className?: string }) {
  const { label, Icon } = HAZARDS[hazard]
  return (
    <span className={cn('inline-flex items-center gap-2 font-bold', className)}>
      <Icon className="h-5 w-5" aria-hidden />
      {label}
    </span>
  )
}

export function BigButton({ children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-lg font-bold text-primary-foreground hover:bg-brand-strong disabled:opacity-60',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Message({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-border bg-card p-4 text-base leading-relaxed shadow-card">{children}</p>
}
