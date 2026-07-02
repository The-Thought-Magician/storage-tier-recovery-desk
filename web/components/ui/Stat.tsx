import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'cyan' | 'green' | 'amber' | 'rose'
  className?: string
}

const valueTones: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-zinc-100',
  cyan: 'text-lime-300',
  green: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
}

export function Stat({ label, value, hint, tone = 'default', className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${valueTones[tone]}`}>{value}</div>
      {hint != null && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  )
}

export default Stat
