'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Orphan {
  id?: string
  asset_id?: string | null
  account_id?: string | null
  name?: string | null
  orphan_type?: string | null
  finding_type?: string | null
  provider?: string | null
  region?: string | null
  current_tier?: string | null
  size_bytes?: number | null
  monthly_cost?: number | null
  monthly_savings?: number | null
  annual_savings?: number | null
  detached_since?: string | null
  days_detached?: number | null
  target_tier?: string | null
  effort_score?: number | null
  risk_score?: number | null
  priority_score?: number | null
  detail?: string | null
}

interface OrphansResponse {
  orphans?: Orphan[]
  total_monthly?: number | null
}

interface SummaryRow {
  orphan_type?: string | null
  type?: string | null
  count?: number | null
  monthly?: number | null
  monthly_savings?: number | null
}

interface OrphansSummary {
  by_type?: SummaryRow[]
  total_monthly?: number | null
}

function money(n?: number | null) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function money2(n?: number | null) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}
function bytes(n?: number | null) {
  let v = Number(n || 0)
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}
function typeOf(o: Orphan): string {
  return (o.orphan_type || o.finding_type || 'orphan').toString()
}
function typeLabel(t: string): string {
  return t.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
const TYPE_TONES = ['cyan', 'amber', 'rose', 'violet', 'blue', 'green'] as const
function toneForType(t: string): (typeof TYPE_TONES)[number] {
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0
  return TYPE_TONES[h % TYPE_TONES.length]
}

export default function OrphansPage() {
  const [orphans, setOrphans] = useState<Orphan[]>([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<OrphansSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const [promoting, setPromoting] = useState<Orphan | null>(null)
  const [owner, setOwner] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [promotedIds, setPromotedIds] = useState<Record<string, true>>({})
  const [selected, setSelected] = useState<Record<string, true>>({})
  const [banner, setBanner] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [o, s] = await Promise.all([api.getOrphans(), api.getOrphansSummary()])
      const oResp = o as OrphansResponse
      setOrphans(Array.isArray(oResp?.orphans) ? oResp.orphans : [])
      setTotal(Number(oResp?.total_monthly || 0))
      setSummary((s as OrphansSummary) || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load orphan findings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const summaryRows = useMemo<SummaryRow[]>(() => {
    if (summary?.by_type && summary.by_type.length) return summary.by_type
    const map = new Map<string, { count: number; monthly: number }>()
    for (const o of orphans) {
      const t = typeOf(o)
      const cur = map.get(t) || { count: 0, monthly: 0 }
      cur.count++
      cur.monthly += Number(o.monthly_savings ?? o.monthly_cost ?? 0)
      map.set(t, cur)
    }
    return Array.from(map.entries()).map(([orphan_type, v]) => ({ orphan_type, count: v.count, monthly: v.monthly }))
  }, [summary, orphans])

  const types = useMemo(() => {
    const set = new Set<string>()
    for (const o of orphans) set.add(typeOf(o))
    return Array.from(set).sort()
  }, [orphans])

  const filtered = useMemo(() => {
    let rows = orphans.slice()
    if (typeFilter !== 'all') rows = rows.filter((o) => typeOf(o) === typeFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (o) =>
          (o.name || '').toLowerCase().includes(q) ||
          (o.detail || '').toLowerCase().includes(q) ||
          (o.provider || '').toLowerCase().includes(q) ||
          (o.region || '').toLowerCase().includes(q),
      )
    }
    return rows.sort((a, b) => Number(b.monthly_savings ?? b.monthly_cost ?? 0) - Number(a.monthly_savings ?? a.monthly_cost ?? 0))
  }, [orphans, typeFilter, search])

  const filteredMonthly = useMemo(
    () => filtered.reduce((a, o) => a + Number(o.monthly_savings ?? o.monthly_cost ?? 0), 0),
    [filtered],
  )

  const orphanKey = (o: Orphan) => o.id || o.asset_id || ''

  const selectedOrphans = useMemo(
    () => filtered.filter((o) => selected[orphanKey(o)] && !promotedIds[orphanKey(o)]),
    [filtered, selected, promotedIds],
  )
  const selectedSavings = useMemo(
    () => selectedOrphans.reduce((a, o) => a + Number(o.monthly_savings ?? o.monthly_cost ?? 0), 0),
    [selectedOrphans],
  )

  function toggleSelect(o: Orphan) {
    const k = orphanKey(o)
    setSelected((s) => {
      const next = { ...s }
      if (next[k]) delete next[k]
      else next[k] = true
      return next
    })
  }

  function openPromote(o: Orphan) {
    setPromoting(o)
    setOwner('')
    setNotes('')
    setFormError(null)
  }

  function actionPayload(o: Orphan, ow?: string, n?: string) {
    return {
      asset_id: o.asset_id ?? undefined,
      account_id: o.account_id ?? undefined,
      action_type: 'delete_orphan',
      title: o.name ? `Remove ${o.name}` : `Remove ${typeLabel(typeOf(o))}`,
      target_tier: o.target_tier ?? undefined,
      monthly_savings: o.monthly_savings ?? o.monthly_cost ?? 0,
      annual_savings: o.annual_savings ?? Number(o.monthly_savings ?? o.monthly_cost ?? 0) * 12,
      effort_score: o.effort_score ?? 0,
      risk_score: o.risk_score ?? 0,
      priority_score: o.priority_score ?? 0,
      owner: ow?.trim() || undefined,
      notes: (n?.trim() || o.detail) ?? undefined,
      status: 'proposed',
    }
  }

  async function submitPromote() {
    if (!promoting) return
    setSubmitting(true)
    setFormError(null)
    try {
      await api.createAction(actionPayload(promoting, owner, notes))
      setPromotedIds((p) => ({ ...p, [orphanKey(promoting)]: true }))
      setBanner(`Queued removal action for "${promoting.name || 'orphan'}".`)
      setPromoting(null)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to promote orphan')
    } finally {
      setSubmitting(false)
    }
  }

  async function promoteSelected() {
    if (selectedOrphans.length === 0) return
    setSubmitting(true)
    let ok = 0
    const failed: string[] = []
    for (const o of selectedOrphans) {
      try {
        await api.createAction(actionPayload(o))
        setPromotedIds((p) => ({ ...p, [orphanKey(o)]: true }))
        ok++
      } catch {
        failed.push(o.name || orphanKey(o))
      }
    }
    setSelected({})
    setSubmitting(false)
    setBanner(
      failed.length
        ? `Promoted ${ok} of ${selectedOrphans.length}. Failed: ${failed.join(', ')}.`
        : `Promoted ${ok} orphan${ok === 1 ? '' : 's'} to the worksheet.`,
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Orphans &amp; Abandoned Resources</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Detached volumes, abandoned buckets, incomplete multipart uploads, and orphaned snapshots that keep
            accruing cost with no owner. Promote any to queue a removal action.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Wasted spend / mo" value={money(summary?.total_monthly ?? total)} hint="Across all orphans" tone="rose" />
        <Stat label="Wasted spend / yr" value={money((Number(summary?.total_monthly ?? total)) * 12)} hint="Annualized" tone="amber" />
        <Stat label="Orphans" value={orphans.length.toLocaleString()} hint={`${types.length} types`} tone="cyan" />
      </div>

      {summaryRows.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">By type</h2>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              {(() => {
                const maxMonthly = Math.max(
                  1,
                  ...summaryRows.map((r) => Number(r.monthly ?? r.monthly_savings ?? 0)),
                )
                return summaryRows
                  .slice()
                  .sort((a, b) => Number(b.monthly ?? b.monthly_savings ?? 0) - Number(a.monthly ?? a.monthly_savings ?? 0))
                  .map((r) => {
                    const t = (r.orphan_type || r.type || 'orphan').toString()
                    const m = Number(r.monthly ?? r.monthly_savings ?? 0)
                    const pct = Math.max(2, Math.round((m / maxMonthly) * 100))
                    return (
                      <div key={t} className="flex items-center gap-3">
                        <button
                          onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
                          className="w-44 shrink-0 text-left"
                        >
                          <Badge tone={toneForType(t)} className={typeFilter === t ? 'ring-1 ring-lime-400' : ''}>
                            {typeLabel(t)}
                          </Badge>
                        </button>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-lime-500 to-lime-400"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="w-28 shrink-0 text-right text-sm tabular-nums text-zinc-300">{money2(m)}/mo</div>
                        <div className="w-16 shrink-0 text-right text-xs tabular-nums text-zinc-500">
                          {Number(r.count || 0)} ct
                        </div>
                      </div>
                    )
                  })
              })()}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search orphans..."
              className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            >
              <option value="all">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            {selectedOrphans.length > 0 && (
              <>
                <span className="text-sm text-zinc-400">
                  {selectedOrphans.length} selected ·{' '}
                  <span className="font-medium text-lime-300">{money(selectedSavings)}</span>/mo
                </span>
                <Button onClick={promoteSelected} disabled={submitting} className="px-3 py-1.5 text-xs">
                  {submitting ? 'Promoting...' : 'Promote selected'}
                </Button>
              </>
            )}
            <span className="text-sm text-zinc-500">
              <span className="font-medium text-zinc-300">{filtered.length}</span> shown ·{' '}
              <span className="font-medium text-lime-300">{money(filteredMonthly)}</span>/mo
            </span>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-16">
              <Spinner label="Scanning for orphans..." />
            </div>
          ) : error ? (
            <div className="px-5 py-10">
              <EmptyState
                title="Could not load orphans"
                description={error}
                icon="⚠"
                action={
                  <Button variant="secondary" onClick={load}>
                    Try again
                  </Button>
                }
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title={orphans.length === 0 ? 'No orphaned resources found' : 'No orphans match your filters'}
                description={
                  orphans.length === 0
                    ? 'Nothing abandoned in the current estate. Run an analysis to refresh detection.'
                    : 'Try clearing the search or type filter.'
                }
                icon="✓"
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-10"></TH>
                  <TH>Resource</TH>
                  <TH>Type</TH>
                  <TH>Provider</TH>
                  <TH>Region</TH>
                  <TH className="text-right">Idle</TH>
                  <TH className="text-right">Size</TH>
                  <TH className="text-right">Cost / mo</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((o) => {
                  const k = orphanKey(o)
                  const done = !!promotedIds[k]
                  const idle =
                    o.days_detached != null
                      ? `${Number(o.days_detached).toFixed(0)}d`
                      : o.detached_since
                        ? `${Math.max(0, Math.round((Date.now() - new Date(o.detached_since).getTime()) / 86400000))}d`
                        : '—'
                  return (
                    <TR key={k}>
                      <TD>
                        <input
                          type="checkbox"
                          checked={!!selected[k]}
                          disabled={done}
                          onChange={() => toggleSelect(o)}
                          className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 accent-lime-500"
                        />
                      </TD>
                      <TD>
                        <div className="font-medium text-zinc-100">{o.name || o.asset_id || k}</div>
                        {o.detail && <div className="mt-0.5 max-w-md text-xs text-zinc-500">{o.detail}</div>}
                      </TD>
                      <TD>
                        <Badge tone={toneForType(typeOf(o))}>{typeLabel(typeOf(o))}</Badge>
                      </TD>
                      <TD className="text-zinc-400">{o.provider || '—'}</TD>
                      <TD className="text-zinc-400">{o.region || '—'}</TD>
                      <TD className="text-right tabular-nums text-zinc-400">{idle}</TD>
                      <TD className="text-right tabular-nums text-zinc-400">{bytes(o.size_bytes)}</TD>
                      <TD className="text-right tabular-nums font-medium text-rose-300">
                        {money2(o.monthly_savings ?? o.monthly_cost)}
                      </TD>
                      <TD className="text-right">
                        {done ? (
                          <Badge tone="green">Promoted ✓</Badge>
                        ) : (
                          <Button onClick={() => openPromote(o)} className="px-3 py-1.5 text-xs">
                            Promote
                          </Button>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={!!promoting}
        onClose={() => (submitting ? null : setPromoting(null))}
        title="Promote to recovery worksheet"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPromoting(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitPromote} disabled={submitting}>
              {submitting ? 'Promoting...' : 'Create action'}
            </Button>
          </>
        }
      >
        {promoting && (
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
              <div className="font-medium text-zinc-100">{promoting.name || 'Orphaned resource'}</div>
              {promoting.detail && <div className="mt-1 text-xs text-zinc-500">{promoting.detail}</div>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge tone={toneForType(typeOf(promoting))}>{typeLabel(typeOf(promoting))}</Badge>
                {promoting.current_tier && <Badge tone="slate">{promoting.current_tier}</Badge>}
                <Badge tone="rose">{money2(promoting.monthly_savings ?? promoting.monthly_cost)}/mo wasted</Badge>
                {promoting.size_bytes != null && <Badge tone="blue">{bytes(promoting.size_bytes)}</Badge>}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Owner</label>
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Assign an owner (optional)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={promoting.detail || 'Context for the removal action (optional)'}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
            {formError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {formError}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
