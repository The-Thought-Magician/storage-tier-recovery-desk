'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Scenario {
  id?: string
  key?: string
  name?: string
  label?: string
  monthly?: number
  annual?: number
  monthly_savings?: number
  annual_savings?: number
  count?: number
  action_count?: number
  risk?: string
  description?: string
}

interface ForecastResponse {
  scenarios?: Scenario[]
}

interface Action {
  id: string
  title?: string
  action_type?: string
  status?: string
  risk_score?: number
  effort_score?: number
  priority_score?: number
  monthly_savings?: number
  annual_savings?: number
  owner?: string
}

interface ProjectionResult {
  monthly?: number
  annual?: number
  count?: number
}

const fmtUSD = (n?: number) =>
  n == null || Number.isNaN(n)
    ? '$0'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const fmtUSD2 = (n?: number) =>
  n == null || Number.isNaN(n)
    ? '$0.00'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

function riskTone(risk?: string | number): 'green' | 'amber' | 'rose' | 'slate' {
  if (risk == null) return 'slate'
  const r = typeof risk === 'number' ? risk : risk.toLowerCase()
  if (typeof r === 'number') {
    if (r <= 0.34) return 'green'
    if (r <= 0.67) return 'amber'
    return 'rose'
  }
  if (r.includes('low')) return 'green'
  if (r.includes('med')) return 'amber'
  if (r.includes('high')) return 'rose'
  return 'slate'
}

function scenarioMonthly(s: Scenario): number {
  return s.monthly ?? s.monthly_savings ?? 0
}
function scenarioAnnual(s: Scenario): number {
  return s.annual ?? s.annual_savings ?? scenarioMonthly(s) * 12
}
function scenarioCount(s: Scenario): number {
  return s.count ?? s.action_count ?? 0
}
function scenarioName(s: Scenario): string {
  return s.name ?? s.label ?? s.key ?? s.id ?? 'Scenario'
}

export default function ForecastPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [actions, setActions] = useState<Action[]>([])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<'priority' | 'savings' | 'risk'>('priority')
  const [search, setSearch] = useState('')

  const [projecting, setProjecting] = useState(false)
  const [projection, setProjection] = useState<ProjectionResult | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [fc, ws] = await Promise.all([api.getForecast(), api.getWorksheet()])
      const fcScenarios: Scenario[] = (fc?.scenarios ?? fc ?? []) as Scenario[]
      setScenarios(Array.isArray(fcScenarios) ? fcScenarios : [])
      const wsActions: Action[] = (Array.isArray(ws) ? ws : ws?.actions ?? []) as Action[]
      setActions(Array.isArray(wsActions) ? wsActions : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load forecast')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filteredActions = useMemo(() => {
    let rows = [...actions]
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (a) =>
          (a.title ?? '').toLowerCase().includes(q) ||
          (a.action_type ?? '').toLowerCase().includes(q) ||
          (a.owner ?? '').toLowerCase().includes(q),
      )
    }
    rows.sort((a, b) => {
      if (sortBy === 'savings') return (b.monthly_savings ?? 0) - (a.monthly_savings ?? 0)
      if (sortBy === 'risk') return (a.risk_score ?? 0) - (b.risk_score ?? 0)
      return (b.priority_score ?? 0) - (a.priority_score ?? 0)
    })
    return rows
  }, [actions, search, sortBy])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setProjection(null)
  }

  const selectAllFiltered = () => {
    setSelected(new Set(filteredActions.map((a) => a.id)))
    setProjection(null)
  }
  const clearSelection = () => {
    setSelected(new Set())
    setProjection(null)
  }

  const selectByRisk = (max: number) => {
    setSelected(new Set(actions.filter((a) => (a.risk_score ?? 1) <= max).map((a) => a.id)))
    setProjection(null)
  }

  const selectTopN = (n: number) => {
    const top = [...actions]
      .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
      .slice(0, n)
    setSelected(new Set(top.map((a) => a.id)))
    setProjection(null)
  }

  const localSelectedTotal = useMemo(() => {
    const chosen = actions.filter((a) => selected.has(a.id))
    const monthly = chosen.reduce((s, a) => s + (a.monthly_savings ?? 0), 0)
    return { monthly, annual: monthly * 12, count: chosen.length }
  }, [actions, selected])

  const runProjection = async () => {
    if (selected.size === 0) return
    setProjecting(true)
    setProjectError(null)
    setProjection(null)
    try {
      const res = await api.projectScenario({ action_ids: Array.from(selected) })
      setProjection({
        monthly: res?.monthly ?? res?.monthly_savings,
        annual: res?.annual ?? res?.annual_savings,
        count: res?.count ?? selected.size,
      })
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : 'Projection failed')
    } finally {
      setProjecting(false)
    }
  }

  const maxScenarioMonthly = useMemo(
    () => Math.max(1, ...scenarios.map(scenarioMonthly)),
    [scenarios],
  )

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading forecast..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Savings Forecast</h1>
          <p className="mt-1 text-sm text-slate-500">
            Compare recovery scenarios and build a custom projection from worksheet actions.
          </p>
        </div>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-rose-500/30">
          <CardBody className="flex items-center justify-between">
            <span className="text-sm text-rose-300">{error}</span>
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Scenario forecasts */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Modeled Scenarios</h2>
          <p className="mt-0.5 text-xs text-slate-500">Pre-built recovery scenarios across your estate.</p>
        </CardHeader>
        <CardBody>
          {scenarios.length === 0 ? (
            <EmptyState
              title="No scenarios yet"
              description="Run an analysis to generate findings and recovery actions, then forecasts will appear here."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {scenarios.map((s, i) => {
                const monthly = scenarioMonthly(s)
                const pct = Math.round((monthly / maxScenarioMonthly) * 100)
                return (
                  <div
                    key={s.id ?? s.key ?? i}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-200">{scenarioName(s)}</span>
                      {s.risk && <Badge tone={riskTone(s.risk)}>{s.risk}</Badge>}
                    </div>
                    {s.description && (
                      <p className="mt-1 text-xs text-slate-500">{s.description}</p>
                    )}
                    <div className="mt-3 text-2xl font-semibold tabular-nums text-cyan-300">
                      {fmtUSD(monthly)}
                      <span className="ml-1 text-xs font-normal text-slate-500">/mo</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {fmtUSD(scenarioAnnual(s))} / yr · {scenarioCount(s)} actions
                    </div>
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Scenario builder */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Scenario Builder</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Select actions to include in a custom projection.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search actions..."
                  className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="priority">Sort: Priority</option>
                  <option value="savings">Sort: Savings</option>
                  <option value="risk">Sort: Risk (low first)</option>
                </select>
              </div>
            </CardHeader>
            <CardBody>
              <div className="mb-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={selectAllFiltered}>
                  Select all
                </Button>
                <Button variant="secondary" onClick={() => selectByRisk(0.34)}>
                  Low-risk only
                </Button>
                <Button variant="secondary" onClick={() => selectTopN(20)}>
                  Top 20
                </Button>
                <Button variant="ghost" onClick={clearSelection}>
                  Clear
                </Button>
              </div>

              {filteredActions.length === 0 ? (
                <EmptyState
                  title={actions.length === 0 ? 'No recovery actions' : 'No matches'}
                  description={
                    actions.length === 0
                      ? 'Promote findings to the worksheet to build scenarios.'
                      : 'Adjust your search to see actions.'
                  }
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-10"></TH>
                      <TH>Action</TH>
                      <TH>Type</TH>
                      <TH className="text-right">Monthly</TH>
                      <TH className="text-right">Priority</TH>
                      <TH>Risk</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filteredActions.map((a) => {
                      const checked = selected.has(a.id)
                      return (
                        <TR
                          key={a.id}
                          onClick={() => toggle(a.id)}
                          className={`cursor-pointer ${checked ? 'bg-cyan-500/5' : ''}`}
                        >
                          <TD>
                            <input
                              type="checkbox"
                              checked={checked}
                              readOnly
                              className="h-4 w-4 accent-cyan-500"
                            />
                          </TD>
                          <TD className="font-medium text-slate-200">{a.title ?? a.id}</TD>
                          <TD>
                            <Badge tone="slate">{a.action_type ?? '—'}</Badge>
                          </TD>
                          <TD className="text-right tabular-nums text-emerald-300">
                            {fmtUSD2(a.monthly_savings)}
                          </TD>
                          <TD className="text-right tabular-nums text-slate-400">
                            {a.priority_score != null ? a.priority_score.toFixed(2) : '—'}
                          </TD>
                          <TD>
                            <Badge tone={riskTone(a.risk_score)}>
                              {a.risk_score != null ? a.risk_score.toFixed(2) : '—'}
                            </Badge>
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Projection panel */}
        <div className="space-y-4">
          <Card className="sticky top-20">
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Projection</h2>
              <p className="mt-0.5 text-xs text-slate-500">{selected.size} actions selected</p>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Selected /mo" value={fmtUSD(localSelectedTotal.monthly)} tone="cyan" />
                <Stat label="Selected /yr" value={fmtUSD(localSelectedTotal.annual)} tone="green" />
              </div>

              <Button
                className="w-full"
                onClick={runProjection}
                disabled={selected.size === 0 || projecting}
              >
                {projecting ? 'Projecting...' : 'Project Scenario'}
              </Button>

              {projectError && <p className="text-sm text-rose-300">{projectError}</p>}

              {projection && (
                <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-cyan-400">
                    Server projection
                  </div>
                  <div className="mt-2 text-3xl font-semibold tabular-nums text-cyan-200">
                    {fmtUSD(projection.monthly)}
                    <span className="ml-1 text-sm font-normal text-slate-400">/mo</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-400">
                    {fmtUSD(projection.annual)} annualized · {projection.count} actions
                  </div>
                </div>
              )}

              {!projection && selected.size === 0 && (
                <p className="text-xs text-slate-500">
                  Pick actions from the builder, or use a quick preset, then project to confirm
                  recoverable spend.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
