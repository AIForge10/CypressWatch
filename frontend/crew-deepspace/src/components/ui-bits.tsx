import type { ReactNode } from 'react'
import { AlertTriangle, CircleAlert, CircleCheck, ShieldAlert, type LucideIcon } from 'lucide-react'
import type { HazardKey, RiskLevel } from '../contracts/types'
import { HAZARDS, LEVELS } from '../lib/hazards'
import { cn } from '../lib/utils'

export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-5">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-xl border-2 border-border bg-card p-4', className)}>{children}</section>
}

const LEVEL_ICON: Record<RiskLevel, LucideIcon> = { low: CircleCheck, moderate: CircleAlert, high: AlertTriangle, extreme: ShieldAlert }

/** Level as icon + word. Never color alone. */
export function LevelBadge({ level }: { level: RiskLevel }) {
  const Icon = LEVEL_ICON[level]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg border-2 px-2.5 py-1 text-sm font-bold', LEVELS[level].cls)}>
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
        'flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-lg font-bold text-primary-foreground disabled:opacity-60',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Message({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border-2 border-border bg-card p-4 text-base leading-relaxed">{children}</p>
}
