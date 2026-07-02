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

interface AnalysisRun {
  id: string
  account_id: string | null
  pricing_book_id: string | null
  status: string
  findings_count: number | null
  total_recoverable_monthly: number | string | null
  summary?: Record<string, unknown> | null
  created_at: string
}

interface Finding {
  id: string
  finding_type: string
  title: string
  detail: string | null
  recommended_action: string | null
  target_tier: string | null
  monthly_savings: number | string | null
  annual_savings: number | string | null
  effort_score: number | string | null
  risk_score: number | string | null
  priority_score: number | string | null
  confidence: number | string | null
  created_at: string
}

interface RunDetail {
  run: AnalysisRun
  findings: Finding[]
}

interface DiffEntry {
  id?: string
  title?: string
  finding_type?: string
  monthly_savings?: number | string | null
  before?: number | string | null
  after?: number | string | null
  [k: string]: unknown
}

interface AnalysisDiff {
  new: DiffEntry[]
  resolved: DiffEntry[]
  changed: DiffEntry[]
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}
function money(v: unknown): string {
  return num(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtDateTime(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function statusTone(s: string): 'green' | 'cyan' | 'amber' | 'rose' | 'slate' {
  if (s === 'completed' || s === 'complete' || s === 'done') return 'green'
  if (s === 'running' || s === 'in_progress') return 'cyan'
  if (s === 'queued' || s === 'pending') return 'amber'
  if (s === 'failed' || s === 'error') return 'rose'
  return 'slate'
}
function riskTone(v: number): 'green' | 'amber' | 'rose' {
  if (v <= 33) return 'green'
  if (v <= 66) return 'amber'
  return 'rose'
}

export default function AnalysisPage() {
  const [runs, setRuns] = useState<AnalysisRun[]>([])
  const [diff, setDiff] = useState<AnalysisDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [r, d] = await Promise.all([api.getAnalysisRuns(), api.getAnalysisDiff().catch(() => null)])
      const list: AnalysisRun[] = Array.isArray(r) ? r : []
      setRuns(list)
      setDiff(d && typeof d === 'object' ? { new: d.new ?? [], resolved: d.resolved ?? [], changed: d.changed ?? [] } : null)
      if (list.length > 0 && !selectedId) void openRun(list[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analysis runs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openRun(id: string) {
    setSelectedId(id)
    setDetailLoading(true)
    setDetailError(null)
    setTypeFilter('all')
    try {
      const d = await api.getAnalysisRun(id)
      setDetail(d ?? null)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load run detail')
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function runNow() {
    setRunning(true)
    setRunMsg(null)
    setError(null)
    try {
      const res = await api.runAnalysis()
      const count = res?.findings_count ?? 0
      const rec = res?.total_recoverable_monthly
      setRunMsg(`Analysis complete: ${count} findings, ${money(rec)}/mo recoverable.`)
      setSelectedId(null)
      await load()
      if (res?.run?.id) await openRun(res.run.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run analysis')
    } finally {
      setRunning(false)
    }
  }

  const findingTypes = useMemo(() => {
    const s = new Set<string>()
    for (const f of detail?.findings ?? []) if (f.finding_type) s.add(f.finding_type)
    return Array.from(s).sort()
  }, [detail])

  const visibleFindings = useMemo(() => {
    const list = detail?.findings ?? []
    const filtered = typeFilter === 'all' ? list : list.filter((f) => f.finding_type === typeFilter)
    return [...filtered].sort((a, b) => num(b.priority_score) - num(a.priority_score))
  }, [detail, typeFilter])

  const latestRecoverable = runs[0] ? num(runs[0].total_recoverable_monthly) : 0
  const diffNew = diff?.new.length ?? 0
  const diffResolved = diff?.resolved.length ?? 0
  const diffChanged = diff?.changed.length ?? 0

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Analysis Runs</h1>
          <p className="mt-1 text-sm text-zinc-500">Run all detectors, review findings, and diff against the prior run.</p>
        </div>
        <Button onClick={() => void runNow()} disabled={running || loading}>
          {running ? 'Running detectors…' : 'Run analysis now'}
        </Button>
      </header>

      {runMsg && (
        <Card className="border-emerald-500/30">
          <CardBody className="text-sm text-emerald-300">{runMsg}</CardBody>
        </Card>
      )}
      {error && (
        <Card className="border-rose-500/30">
          <CardBody className="flex items-center justify-between">
            <span className="text-sm text-rose-300">{error}</span>
            <Button variant="secondary" onClick={() => void load()}>Retry</Button>
          </CardBody>
        </Card>
      )}

      {loading ? (
        <div className="py-24"><Spinner label="Loading analysis runs…" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total runs" value={runs.length} tone="cyan" />
            <Stat label="Latest recoverable" value={money(latestRecoverable)} tone="green" hint="Most recent run, monthly" />
            <Stat label="New findings" value={diffNew} tone={diffNew > 0 ? 'amber' : 'default'} hint="vs prior run" />
            <Stat label="Resolved" value={diffResolved} tone="green" hint={`${diffChanged} changed`} />
          </div>

          {diff && (diffNew + diffResolved + diffChanged > 0) && (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-zinc-200">Re-analysis diff (latest two runs)</h2>
              </CardHeader>
              <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <DiffColumn title="New" tone="amber" entries={diff.new} />
                <DiffColumn title="Changed" tone="cyan" entries={diff.changed} showDelta />
                <DiffColumn title="Resolved" tone="green" entries={diff.resolved} />
              </CardBody>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
            <Card className="self-start">
              <CardHeader>
                <h2 className="text-sm font-semibold text-zinc-200">Run history</h2>
              </CardHeader>
              <CardBody className="p-0">
                {runs.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      title="No analysis runs yet"
                      description="Run the detectors to generate mis-tier, snapshot, orphan, and retention findings."
                      action={<Button onClick={() => void runNow()} disabled={running}>Run analysis now</Button>}
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-zinc-800/70">
                    {runs.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() => void openRun(r.id)}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/40 ${selectedId === r.id ? 'bg-zinc-800/60' : ''}`}
                        >
                          <div className="min-w-0">
                            <div className="text-sm text-zinc-200">{fmtDateTime(r.created_at)}</div>
                            <div className="text-xs text-zinc-500">{r.findings_count ?? 0} findings · {money(r.total_recoverable_monthly)}/mo</div>
                          </div>
                          <Badge tone={statusTone(r.status)} className="capitalize">{r.status}</Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-zinc-200">
                  Run findings{detail ? ` — ${fmtDateTime(detail.run.created_at)}` : ''}
                </h2>
                {findingTypes.length > 0 && (
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 capitalize focus:border-lime-500 focus:outline-none"
                  >
                    <option value="all">All types</option>
                    {findingTypes.map((t) => (
                      <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                )}
              </CardHeader>
              <CardBody className="p-0">
                {detailLoading ? (
                  <div className="py-12"><Spinner label="Loading findings…" /></div>
                ) : detailError ? (
                  <div className="flex items-center justify-between p-6">
                    <span className="text-sm text-rose-300">{detailError}</span>
                    <Button variant="secondary" onClick={() => selectedId && void openRun(selectedId)}>Retry</Button>
                  </div>
                ) : !detail ? (
                  <div className="p-6">
                    <EmptyState title="Select a run" description="Pick a run from the history to view its findings." />
                  </div>
                ) : visibleFindings.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      title={detail.findings.length === 0 ? 'No findings in this run' : 'No findings match this type'}
                      description={detail.findings.length === 0 ? 'This run produced no recoverable opportunities.' : 'Try a different finding type.'}
                    />
                  </div>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Finding</TH>
                        <TH>Type</TH>
                        <TH className="text-right">Monthly</TH>
                        <TH className="text-right">Priority</TH>
                        <TH className="text-right">Risk</TH>
                        <TH className="text-right">Confidence</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {visibleFindings.map((f) => (
                        <TR key={f.id}>
                          <TD className="text-zinc-200">
                            <div className="font-medium">{f.title}</div>
                            {f.recommended_action && (
                              <div className="mt-0.5 text-xs text-zinc-500">
                                {f.recommended_action.replace(/_/g, ' ')}{f.target_tier ? ` → ${f.target_tier}` : ''}
                              </div>
                            )}
                          </TD>
                          <TD className="capitalize text-zinc-400">{f.finding_type?.replace(/_/g, ' ')}</TD>
                          <TD className="text-right tabular-nums text-emerald-300">{money(f.monthly_savings)}</TD>
                          <TD className="text-right tabular-nums text-lime-300">{num(f.priority_score).toFixed(0)}</TD>
                          <TD className="text-right tabular-nums">
                            <Badge tone={riskTone(num(f.risk_score))}>{num(f.risk_score).toFixed(0)}</Badge>
                          </TD>
                          <TD className="text-right tabular-nums text-zinc-400">{(num(f.confidence) * (num(f.confidence) <= 1 ? 100 : 1)).toFixed(0)}%</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function DiffColumn({
  title,
  tone,
  entries,
  showDelta = false,
}: {
  title: string
  tone: 'amber' | 'cyan' | 'green'
  entries: DiffEntry[]
  showDelta?: boolean
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</span>
        <Badge tone={tone}>{entries.length}</Badge>
      </div>
      {entries.length === 0 ? (
        <p className="py-3 text-center text-xs text-zinc-600">None</p>
      ) : (
        <ul className="space-y-2">
          {entries.slice(0, 8).map((e, i) => (
            <li key={e.id ?? i} className="rounded-md border border-zinc-800/70 bg-zinc-900 px-3 py-2">
              <div className="truncate text-xs text-zinc-200">{e.title ?? e.finding_type ?? e.id ?? 'Finding'}</div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {showDelta && e.before != null && e.after != null
                  ? `${money(e.before)} → ${money(e.after)}/mo`
                  : `${money(e.monthly_savings)}/mo`}
              </div>
            </li>
          ))}
          {entries.length > 8 && <li className="px-1 text-xs text-zinc-600">+{entries.length - 8} more</li>}
        </ul>
      )}
    </div>
  )
}
