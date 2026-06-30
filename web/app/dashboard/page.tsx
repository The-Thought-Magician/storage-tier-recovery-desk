'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Stat } from '@/components/ui/Stat'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Kpis {
  total_spend?: number
  total_recoverable?: number
  realized_monthly?: number
  recovery_rate?: number
  findings_count?: number
  actions_count?: number
  accounts_count?: number
  assets_count?: number
}

interface Opportunity {
  id?: string
  title?: string
  finding_type?: string
  action_type?: string
  target_tier?: string
  monthly_savings?: number
  annual_savings?: number
  priority_score?: number
  risk_score?: number
  account_id?: string
  asset_id?: string
}

interface DashboardData {
  kpis?: Kpis
  top_opportunities?: Opportunity[]
}

interface TrendPoint {
  date?: string
  period?: string
  label?: string
  spend?: number
  recoverable?: number
  realized?: number
}

interface TrendData {
  points?: TrendPoint[]
}

const fmtMoney = (n: number | undefined | null, digits = 0) => {
  const v = Number(n ?? 0)
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

const fmtNum = (n: number | undefined | null) => Number(n ?? 0).toLocaleString('en-US')

const fmtPct = (n: number | undefined | null) => {
  const v = Number(n ?? 0)
  // Accept either fraction (0.42) or percent (42)
  const pct = v <= 1 ? v * 100 : v
  return `${pct.toFixed(1)}%`
}

function riskTone(score: number | undefined): 'green' | 'amber' | 'rose' | 'slate' {
  const v = Number(score ?? 0)
  if (v <= 0) return 'slate'
  if (v < 34) return 'green'
  if (v < 67) return 'amber'
  return 'rose'
}

export default function DashboardOverviewPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [trend, setTrend] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [d, t] = await Promise.all([api.getDashboard(), api.getDashboardTrend()])
      setData(d || {})
      setTrend(t || { points: [] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading executive overview..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-500/30">
          <CardBody>
            <h2 className="text-base font-semibold text-rose-300">Could not load dashboard</h2>
            <p className="mt-1 text-sm text-slate-400">{error}</p>
            <Button className="mt-4" variant="secondary" onClick={load}>
              Retry
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  const kpis = data?.kpis || {}
  const opps = data?.top_opportunities || []
  const points = trend?.points || []

  const hasEstate = (kpis.assets_count ?? 0) > 0 || (kpis.total_spend ?? 0) > 0 || points.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Executive Overview</h1>
          <p className="mt-1 text-sm text-slate-500">
            Storage spend, recoverable savings, and recovery momentum across your cloud estate.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load}>
            Refresh
          </Button>
          <Link href="/dashboard/analysis">
            <Button>Run analysis</Button>
          </Link>
        </div>
      </div>

      {!hasEstate ? (
        <EmptyState
          title="No estate data yet"
          description="Ingest a cloud account or seed a sample estate to populate spend, findings, and recovery opportunities."
          icon={<span>▤</span>}
          action={
            <Link href="/dashboard/ingest">
              <Button>Go to Ingest</Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Monthly Spend" value={fmtMoney(kpis.total_spend)} hint="Current storage run-rate" />
            <Stat
              label="Recoverable / mo"
              value={fmtMoney(kpis.total_recoverable)}
              tone="cyan"
              hint={`${fmtMoney((kpis.total_recoverable ?? 0) * 12)} / yr`}
            />
            <Stat
              label="Realized / mo"
              value={fmtMoney(kpis.realized_monthly)}
              tone="green"
              hint="Savings booked"
            />
            <Stat
              label="Recovery Rate"
              value={fmtPct(kpis.recovery_rate)}
              tone="amber"
              hint="Realized vs. recoverable"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Open Findings" value={fmtNum(kpis.findings_count)} />
            <Stat label="Recovery Actions" value={fmtNum(kpis.actions_count)} />
            <Stat label="Cloud Accounts" value={fmtNum(kpis.accounts_count)} />
            <Stat label="Storage Assets" value={fmtNum(kpis.assets_count)} />
          </div>

          {/* Recovery rate bar */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Recovery progress</h2>
                <span className="text-xs text-slate-500">
                  {fmtMoney(kpis.realized_monthly)} realized of {fmtMoney(kpis.total_recoverable)} recoverable
                </span>
              </div>
            </CardHeader>
            <CardBody>
              <RecoveryBar realized={kpis.realized_monthly} recoverable={kpis.total_recoverable} />
            </CardBody>
          </Card>

          {/* Trend chart */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Spend &amp; recoverable trend</h2>
            </CardHeader>
            <CardBody>
              {points.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No trend data recorded yet.</p>
              ) : (
                <TrendChart points={points} />
              )}
            </CardBody>
          </Card>

          {/* Top opportunities */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Top recovery opportunities</h2>
                <Link href="/dashboard/worksheet" className="text-xs text-cyan-400 hover:text-cyan-300">
                  View worksheet →
                </Link>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {opps.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-500">
                  No opportunities yet. Run an analysis to surface mis-tier, snapshot, and orphan savings.
                </p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Opportunity</TH>
                      <TH>Type</TH>
                      <TH className="text-right">Monthly</TH>
                      <TH className="text-right">Annual</TH>
                      <TH className="text-center">Risk</TH>
                      <TH className="text-right">Priority</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {opps.map((o, i) => (
                      <TR key={o.id ?? i}>
                        <TD className="max-w-xs">
                          <span className="font-medium text-slate-200">{o.title || 'Untitled opportunity'}</span>
                          {o.target_tier && (
                            <span className="ml-2 text-xs text-slate-500">→ {o.target_tier}</span>
                          )}
                        </TD>
                        <TD>
                          <Badge tone="cyan">{o.finding_type || o.action_type || 'finding'}</Badge>
                        </TD>
                        <TD className="text-right font-medium text-emerald-300">{fmtMoney(o.monthly_savings, 2)}</TD>
                        <TD className="text-right text-slate-300">{fmtMoney(o.annual_savings)}</TD>
                        <TD className="text-center">
                          <Badge tone={riskTone(o.risk_score)}>{Math.round(Number(o.risk_score ?? 0))}</Badge>
                        </TD>
                        <TD className="text-right tabular-nums text-slate-300">
                          {Math.round(Number(o.priority_score ?? 0))}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

function RecoveryBar({ realized, recoverable }: { realized?: number; recoverable?: number }) {
  const rec = Number(recoverable ?? 0)
  const real = Number(realized ?? 0)
  const pct = rec > 0 ? Math.min(100, (real / rec) * 100) : 0
  return (
    <div>
      <div className="h-4 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span className="text-emerald-300">{pct.toFixed(1)}% realized</span>
        <span>{fmtMoney(rec)} target</span>
      </div>
    </div>
  )
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  const width = 720
  const height = 220
  const padL = 48
  const padR = 16
  const padT = 16
  const padB = 28

  const series: { key: keyof TrendPoint; color: string; label: string }[] = [
    { key: 'spend', color: '#64748b', label: 'Spend' },
    { key: 'recoverable', color: '#22d3ee', label: 'Recoverable' },
    { key: 'realized', color: '#34d399', label: 'Realized' },
  ]

  const allVals = points.flatMap((p) => series.map((s) => Number(p[s.key] ?? 0)))
  const max = Math.max(1, ...allVals)
  const n = points.length

  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (width - padL - padR))
  const y = (v: number) => padT + (1 - v / max) * (height - padT - padB)

  const labelOf = (p: TrendPoint) => p.label || p.period || p.date || ''

  const buildPath = (key: keyof TrendPoint) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(Number(p[key] ?? 0)).toFixed(1)}`).join(' ')

  const gridLines = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[640px] w-full" role="img" aria-label="Trend chart">
        {gridLines.map((g) => {
          const gy = padT + g * (height - padT - padB)
          const val = max * (1 - g)
          return (
            <g key={g}>
              <line x1={padL} y1={gy} x2={width - padR} y2={gy} stroke="#1e293b" strokeWidth={1} />
              <text x={padL - 6} y={gy + 3} textAnchor="end" fontSize={9} fill="#475569">
                {fmtMoney(val)}
              </text>
            </g>
          )
        })}
        {series.map((s) => (
          <path key={s.key} d={buildPath(s.key)} fill="none" stroke={s.color} strokeWidth={2} />
        ))}
        {series.map((s) =>
          points.map((p, i) => (
            <circle key={`${s.key}-${i}`} cx={x(i)} cy={y(Number(p[s.key] ?? 0))} r={2.5} fill={s.color} />
          )),
        )}
        {points.map((p, i) => {
          // show at most ~8 labels
          const step = Math.ceil(n / 8)
          if (i % step !== 0 && i !== n - 1) return null
          return (
            <text key={`lbl-${i}`} x={x(i)} y={height - 8} textAnchor="middle" fontSize={9} fill="#64748b">
              {labelOf(p)}
            </text>
          )
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}
