'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface BreakdownRow {
  key?: string | null
  label?: string | null
  name?: string | null
  spend?: number | null
  recoverable?: number | null
  count?: number | null
}

interface Breakdown {
  by_provider?: BreakdownRow[]
  by_tier?: BreakdownRow[]
  by_account?: BreakdownRow[]
  by_region?: BreakdownRow[]
  by_action_type?: BreakdownRow[]
  by_risk?: BreakdownRow[]
}

function money(n?: number | null) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function rowLabel(r: BreakdownRow) {
  return r.label || r.name || r.key || '—'
}

const SCOPES = [
  { value: 'workspace', label: 'Workspace' },
  { value: 'account', label: 'Account' },
  { value: 'cycle', label: 'Cycle' },
]

const EXPORT_KINDS = [
  { value: 'worksheet', label: 'Recovery worksheet' },
  { value: 'findings', label: 'Findings' },
  { value: 'inventory', label: 'Inventory' },
]

const BREAKDOWN_DIMS: { key: keyof Breakdown; title: string }[] = [
  { key: 'by_provider', title: 'By provider' },
  { key: 'by_tier', title: 'By tier' },
  { key: 'by_account', title: 'By account' },
  { key: 'by_region', title: 'By region' },
  { key: 'by_action_type', title: 'By action type' },
  { key: 'by_risk', title: 'By risk' },
]

function BreakdownChart({ rows }: { rows: BreakdownRow[] }) {
  const max = useMemo(() => Math.max(1, ...rows.map((r) => Number(r.spend || 0))), [rows])
  if (rows.length === 0) {
    return <p className="px-5 py-6 text-sm text-zinc-600">No data.</p>
  }
  return (
    <div className="space-y-3 px-5 py-4">
      {rows.map((r, i) => {
        const spend = Number(r.spend || 0)
        const recoverable = Number(r.recoverable || 0)
        const spendPct = (spend / max) * 100
        const recPct = spend > 0 ? Math.min(100, (recoverable / spend) * 100) : 0
        return (
          <div key={rowLabel(r) + i}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-zinc-300">{rowLabel(r)}</span>
              <span className="tabular-nums text-zinc-500">
                {money(spend)} spend · <span className="text-lime-300">{money(recoverable)}</span> recoverable
              </span>
            </div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div className="absolute inset-y-0 left-0 rounded-full bg-zinc-600" style={{ width: `${spendPct}%` }} />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-lime-500"
                style={{ width: `${(spendPct * recPct) / 100}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function ReportsPage() {
  const [scope, setScope] = useState('workspace')
  const [scopeId, setScopeId] = useState('')
  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
  const [loading, setLoading] = useState(true)
  const [reportLoading, setReportLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [activeDim, setActiveDim] = useState<keyof Breakdown>('by_provider')

  const [exportKind, setExportKind] = useState('worksheet')
  const [exporting, setExporting] = useState<string | null>(null)

  async function loadReport() {
    setReportLoading(true)
    setError(null)
    try {
      const params: Record<string, unknown> = { scope }
      if (scope !== 'workspace' && scopeId.trim()) params.id = scopeId.trim()
      const r = await api.getReportSummary(params)
      setReport((r && (r.report ?? r)) || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report')
    } finally {
      setReportLoading(false)
    }
  }

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [b] = await Promise.all([api.getDashboardBreakdown()])
      setBreakdown(b || null)
      await loadReport()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function downloadFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function runExport(format: 'csv' | 'json') {
    setExporting(format)
    setError(null)
    try {
      const data = await api.getReportExport({ kind: exportKind, format })
      const ts = new Date().toISOString().slice(0, 10)
      if (format === 'csv') {
        const text = typeof data === 'string' ? data : toCsv(data)
        downloadFile(text, `${exportKind}-${ts}.csv`, 'text/csv')
      } else {
        const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
        downloadFile(text, `${exportKind}-${ts}.json`, 'application/json')
      }
      setBanner(`Exported ${exportKind} as ${format.toUpperCase()}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  const reportEntries = useMemo(() => {
    if (!report) return []
    return Object.entries(report).filter(([, v]) => v == null || typeof v !== 'object')
  }, [report])

  const reportSections = useMemo(() => {
    if (!report) return []
    return Object.entries(report).filter(([, v]) => Array.isArray(v)) as [string, unknown[]][]
  }, [report])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Reports</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Generate spend and recovery reports, export raw data as CSV or JSON, and review cost breakdowns across your
            estate.
          </p>
        </div>
        <Button variant="secondary" onClick={loadAll} disabled={loading}>
          Refresh
        </Button>
      </div>

      {banner && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="text-emerald-400 hover:text-emerald-200" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Report builder</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Choose a scope and generate a summary report.</p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Scope</label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
                >
                  {SCOPES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              {scope !== 'workspace' && (
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {scope === 'account' ? 'Account ID' : 'Cycle ID'}
                  </label>
                  <input
                    value={scopeId}
                    onChange={(e) => setScopeId(e.target.value)}
                    placeholder={`Enter ${scope} id`}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
                  />
                </div>
              )}
              <Button onClick={loadReport} disabled={reportLoading}>
                {reportLoading ? 'Generating...' : 'Generate'}
              </Button>
            </div>

            {reportLoading ? (
              <div className="py-10">
                <Spinner label="Generating report..." />
              </div>
            ) : !report ? (
              <EmptyState title="No report yet" description="Pick a scope and generate a report." icon="📄" />
            ) : (
              <div className="space-y-4">
                {reportEntries.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {reportEntries.map(([k, v]) => (
                      <div key={k} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-zinc-500">{k.replace(/_/g, ' ')}</div>
                        <div className="mt-1 truncate text-sm font-semibold text-zinc-100">{String(v ?? '—')}</div>
                      </div>
                    ))}
                  </div>
                )}
                {reportSections.map(([k, arr]) => (
                  <div key={k}>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      {k.replace(/_/g, ' ')} ({arr.length})
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2">
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-zinc-400">
                        {JSON.stringify(arr, null, 2)}
                      </pre>
                    </div>
                  </div>
                ))}
                {reportEntries.length === 0 && reportSections.length === 0 && (
                  <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                    {JSON.stringify(report, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Data exports</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Download raw datasets for offline analysis or sharing.</p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Dataset</label>
              <select
                value={exportKind}
                onChange={(e) => setExportKind(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              >
                {EXPORT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => runExport('csv')} disabled={!!exporting}>
                {exporting === 'csv' ? 'Exporting...' : 'Download CSV'}
              </Button>
              <Button variant="secondary" onClick={() => runExport('json')} disabled={!!exporting}>
                {exporting === 'json' ? 'Exporting...' : 'Download JSON'}
              </Button>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-zinc-500">
              <p className="font-medium text-zinc-400">What gets exported</p>
              <ul className="mt-2 space-y-1">
                <li>
                  <Badge tone="cyan">worksheet</Badge> ranked recovery actions with savings and status
                </li>
                <li>
                  <Badge tone="blue">findings</Badge> detector findings across all runs
                </li>
                <li>
                  <Badge tone="violet">inventory</Badge> full storage asset estate
                </li>
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Cost &amp; recoverable breakdown</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Spend (grey) and recoverable share (cyan) by dimension.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BREAKDOWN_DIMS.map((d) => (
              <button
                key={d.key}
                onClick={() => setActiveDim(d.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeDim === d.key
                    ? 'border-lime-500/40 bg-lime-500/10 text-lime-300'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {d.title}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-16">
              <Spinner label="Loading breakdown..." />
            </div>
          ) : !breakdown ? (
            <div className="px-5 py-10">
              <EmptyState
                title="No breakdown data"
                description="Seed or ingest an estate, then run an analysis to populate recoverable figures."
                icon="▦"
              />
            </div>
          ) : (
            (() => {
              const rows = (breakdown[activeDim] as BreakdownRow[] | undefined) || []
              if (rows.length === 0) {
                return (
                  <div className="px-5 py-10">
                    <EmptyState title="No data for this dimension" icon="▦" />
                  </div>
                )
              }
              const totalSpend = rows.reduce((a, r) => a + Number(r.spend || 0), 0)
              const totalRec = rows.reduce((a, r) => a + Number(r.recoverable || 0), 0)
              return (
                <div>
                  <div className="grid grid-cols-1 gap-4 px-5 pt-5 sm:grid-cols-3">
                    <Stat label="Total spend" value={money(totalSpend)} />
                    <Stat label="Recoverable" value={money(totalRec)} tone="cyan" />
                    <Stat
                      label="Recoverable %"
                      value={`${totalSpend > 0 ? ((totalRec / totalSpend) * 100).toFixed(1) : '0.0'}%`}
                      tone="green"
                    />
                  </div>
                  <BreakdownChart rows={rows} />
                  <Table>
                    <THead>
                      <TR>
                        <TH>{BREAKDOWN_DIMS.find((d) => d.key === activeDim)?.title.replace('By ', '')}</TH>
                        <TH className="text-right">Spend</TH>
                        <TH className="text-right">Recoverable</TH>
                        <TH className="text-right">%</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {rows.map((r, i) => {
                        const spend = Number(r.spend || 0)
                        const rec = Number(r.recoverable || 0)
                        return (
                          <TR key={rowLabel(r) + i}>
                            <TD className="font-medium text-zinc-200">{rowLabel(r)}</TD>
                            <TD className="text-right tabular-nums text-zinc-300">{money(spend)}</TD>
                            <TD className="text-right tabular-nums text-lime-300">{money(rec)}</TD>
                            <TD className="text-right tabular-nums text-zinc-400">
                              {spend > 0 ? ((rec / spend) * 100).toFixed(0) : '0'}%
                            </TD>
                          </TR>
                        )
                      })}
                    </TBody>
                  </Table>
                </div>
              )
            })()
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function toCsv(data: unknown): string {
  const rows = Array.isArray(data) ? data : Array.isArray((data as { rows?: unknown[] })?.rows) ? (data as { rows: unknown[] }).rows : [data]
  if (rows.length === 0) return ''
  const objs = rows.filter((r) => r && typeof r === 'object') as Record<string, unknown>[]
  if (objs.length === 0) return String(data)
  const headers = Array.from(new Set(objs.flatMap((o) => Object.keys(o))))
  const esc = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const o of objs) lines.push(headers.map((h) => esc(o[h])).join(','))
  return lines.join('\n')
}
