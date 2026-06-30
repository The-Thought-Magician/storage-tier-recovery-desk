'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface AccessPattern {
  id: string
  asset_id: string
  asset_name?: string | null
  account_id?: string | null
  current_tier?: string | null
  monthly_cost?: number | null
  reads_30d: number | null
  reads_90d: number | null
  requests_30d: number | null
  retrieval_gb_30d: number | null
  last_access_at: string | null
  days_since_access: number | null
  temperature: string
  access_score: number | null
}

interface Heatmap {
  matrix: { temperature: string; tier: string; count: number; monthly_cost?: number }[]
  tiers: string[]
  temperatures: string[]
}

const TEMPERATURES = ['hot', 'warm', 'cold', 'frozen', 'never']

const tempTone: Record<string, 'rose' | 'amber' | 'blue' | 'cyan' | 'slate'> = {
  hot: 'rose',
  warm: 'amber',
  cold: 'blue',
  frozen: 'cyan',
  never: 'slate',
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)
}

function fmtDate(s: string | null): string {
  if (!s) return 'never'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// Heatmap cell color ramp by relative intensity (slate → cyan).
function cellStyle(value: number, max: number): React.CSSProperties {
  if (max <= 0 || value <= 0) return { background: 'rgb(15 23 42)' }
  const t = Math.min(1, value / max)
  // cyan-500 = (6,182,212). Blend opacity by intensity.
  const alpha = 0.08 + t * 0.55
  return { background: `rgba(6, 182, 212, ${alpha.toFixed(3)})` }
}

export default function AccessPage() {
  const [patterns, setPatterns] = useState<AccessPattern[]>([])
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tempFilter, setTempFilter] = useState('')
  const [search, setSearch] = useState('')
  const [enriching, setEnriching] = useState(false)
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [pat, hm] = await Promise.all([api.getAccessPatterns(), api.getAccessHeatmap()])
      setPatterns(Array.isArray(pat) ? pat : [])
      setHeatmap(hm && Array.isArray(hm.matrix) ? hm : { matrix: [], tiers: [], temperatures: [] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load access patterns')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function runEnrich() {
    setEnriching(true)
    setEnrichMsg(null)
    try {
      const res = await api.enrichAccess()
      const updated = typeof res?.updated === 'number' ? res.updated : 0
      setEnrichMsg(`Recomputed temperature and access score for ${updated} asset(s).`)
      await load()
      setTimeout(() => setEnrichMsg(null), 4000)
    } catch (e) {
      setEnrichMsg(e instanceof Error ? e.message : 'Enrichment failed')
    } finally {
      setEnriching(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return patterns.filter((p) => {
      if (tempFilter && p.temperature !== tempFilter) return false
      if (q && !(p.asset_name ?? '').toLowerCase().includes(q) && !p.asset_id.toLowerCase().includes(q)) return false
      return true
    })
  }, [patterns, tempFilter, search])

  const tempCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of patterns) m[p.temperature] = (m[p.temperature] ?? 0) + 1
    return m
  }, [patterns])

  // Build matrix lookup + maxima for heatmap rendering.
  const grid = useMemo(() => {
    if (!heatmap) return null
    const tiers = heatmap.tiers?.length ? heatmap.tiers : Array.from(new Set(heatmap.matrix.map((m) => m.tier)))
    const temps = heatmap.temperatures?.length
      ? heatmap.temperatures
      : Array.from(new Set(heatmap.matrix.map((m) => m.temperature)))
    const byKey: Record<string, { count: number; cost: number }> = {}
    let max = 0
    for (const cell of heatmap.matrix) {
      const key = `${cell.temperature}|${cell.tier}`
      byKey[key] = { count: cell.count || 0, cost: cell.monthly_cost || 0 }
      if ((cell.count || 0) > max) max = cell.count || 0
    }
    return { tiers, temps, byKey, max }
  }, [heatmap])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Access Patterns</h1>
          <p className="mt-1 text-sm text-slate-500">
            Read/request activity per asset, classified into temperature bands. Enrich to recompute scores from the latest data.
          </p>
        </div>
        <Button onClick={runEnrich} disabled={enriching}>
          {enriching ? 'Enriching…' : 'Enrich access data'}
        </Button>
      </div>

      {enrichMsg && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm text-cyan-200">{enrichMsg}</div>
      )}

      {loading ? (
        <div className="py-24">
          <Spinner label="Loading access patterns…" />
        </div>
      ) : error ? (
        <Card>
          <CardBody>
            <EmptyState
              title="Could not load access patterns"
              description={error}
              action={
                <Button variant="secondary" onClick={load}>
                  Retry
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Tracked assets" value={patterns.length.toLocaleString()} tone="cyan" />
            {TEMPERATURES.map((t) => (
              <Stat
                key={t}
                label={t}
                value={(tempCounts[t] ?? 0).toLocaleString()}
                tone={t === 'hot' ? 'rose' : t === 'warm' ? 'amber' : t === 'cold' ? 'default' : t === 'frozen' ? 'cyan' : 'default'}
              />
            ))}
          </div>

          {/* Heatmap */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Temperature × tier heatmap</h2>
              <p className="mt-0.5 text-xs text-slate-500">Asset counts by access temperature (rows) and current storage tier (columns).</p>
            </CardHeader>
            <CardBody>
              {!grid || grid.tiers.length === 0 || grid.temps.length === 0 ? (
                <EmptyState
                  title="No heatmap data"
                  description="Seed or ingest an estate and run enrichment to populate the heatmap."
                  action={
                    <Link href="/dashboard/ingest">
                      <Button variant="secondary">Go to Ingest</Button>
                    </Link>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="border-separate border-spacing-1">
                    <thead>
                      <tr>
                        <th className="px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">temp \ tier</th>
                        {grid.tiers.map((tier) => (
                          <th key={tier} className="px-2 py-1 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400">
                            {tier}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grid.temps.map((temp) => (
                        <tr key={temp}>
                          <td className="px-2 py-1 text-right">
                            <Badge tone={tempTone[temp] ?? 'slate'}>{temp}</Badge>
                          </td>
                          {grid.tiers.map((tier) => {
                            const cell = grid.byKey[`${temp}|${tier}`] ?? { count: 0, cost: 0 }
                            return (
                              <td
                                key={tier}
                                style={cellStyle(cell.count, grid.max)}
                                className="min-w-[68px] rounded-md border border-slate-800 px-2 py-3 text-center align-middle"
                                title={`${temp} / ${tier}: ${cell.count} assets, ${fmtUsd(cell.cost)}/mo`}
                              >
                                <div className="text-sm font-semibold tabular-nums text-slate-100">{cell.count}</div>
                                {cell.cost > 0 && <div className="text-[10px] text-slate-400">{fmtUsd(cell.cost)}</div>}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs text-slate-500">
                    Cold/frozen assets sitting in hot tiers (upper-left bias) are prime re-tiering candidates.
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Pattern table */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-200">Access pattern detail</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search asset…"
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                  />
                  <select
                    value={tempFilter}
                    onChange={(e) => setTempFilter(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="">All temperatures</option>
                    {TEMPERATURES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {filtered.length === 0 ? (
                <div className="px-5 py-8">
                  <EmptyState
                    title="No access patterns"
                    description={
                      patterns.length === 0
                        ? 'No assets have enriched access data yet. Click "Enrich access data" above.'
                        : 'No rows match the current filters.'
                    }
                    action={
                      patterns.length === 0 ? (
                        <Button onClick={runEnrich} disabled={enriching}>
                          {enriching ? 'Enriching…' : 'Enrich now'}
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSearch('')
                            setTempFilter('')
                          }}
                        >
                          Clear filters
                        </Button>
                      )
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Asset</TH>
                      <TH>Temp</TH>
                      <TH className="text-right">Score</TH>
                      <TH className="text-right">Reads 30d</TH>
                      <TH className="text-right">Reads 90d</TH>
                      <TH className="text-right">Requests 30d</TH>
                      <TH className="text-right">Retrieval 30d</TH>
                      <TH className="text-right">Days idle</TH>
                      <TH>Last access</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((p) => (
                      <TR key={p.id}>
                        <TD>
                          <Link href={`/dashboard/inventory/${p.asset_id}`} className="font-medium text-cyan-300 hover:text-cyan-200">
                            {p.asset_name || p.asset_id}
                          </Link>
                          {p.current_tier && <div className="text-xs text-slate-600">tier: {p.current_tier}</div>}
                        </TD>
                        <TD>
                          <Badge tone={tempTone[p.temperature] ?? 'slate'}>{p.temperature}</Badge>
                        </TD>
                        <TD className="text-right tabular-nums">{(p.access_score ?? 0).toFixed(2)}</TD>
                        <TD className="text-right tabular-nums">{(p.reads_30d ?? 0).toLocaleString()}</TD>
                        <TD className="text-right tabular-nums">{(p.reads_90d ?? 0).toLocaleString()}</TD>
                        <TD className="text-right tabular-nums">{(p.requests_30d ?? 0).toLocaleString()}</TD>
                        <TD className="text-right tabular-nums">{(p.retrieval_gb_30d ?? 0).toFixed(1)} GB</TD>
                        <TD className="text-right tabular-nums">{p.days_since_access ?? '—'}</TD>
                        <TD className="text-slate-400">{fmtDate(p.last_access_at)}</TD>
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
