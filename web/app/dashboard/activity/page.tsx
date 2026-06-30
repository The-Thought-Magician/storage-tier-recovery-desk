'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface ActivityEntry {
  id: string
  entity_type?: string | null
  entity_id?: string | null
  action?: string | null
  detail?: Record<string, unknown> | null
  created_at?: string | null
}

function fmtDateTime(s?: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function relTime(s?: string | null) {
  if (!s) return ''
  const d = new Date(s).getTime()
  if (isNaN(d)) return ''
  const diff = Date.now() - d
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  const mo = Math.floor(days / 30)
  return `${mo}mo ago`
}

function actionTone(action?: string | null): 'green' | 'rose' | 'amber' | 'cyan' | 'blue' | 'slate' {
  const a = (action || '').toLowerCase()
  if (a.includes('create') || a.includes('add') || a.includes('seed')) return 'green'
  if (a.includes('delete') || a.includes('remove')) return 'rose'
  if (a.includes('update') || a.includes('edit') || a.includes('promote')) return 'amber'
  if (a.includes('run') || a.includes('analy') || a.includes('simulate') || a.includes('enrich')) return 'cyan'
  if (a.includes('resolve') || a.includes('ack')) return 'blue'
  return 'slate'
}

function entityDot(type?: string | null): string {
  const t = (type || '').toLowerCase()
  if (t.includes('account')) return 'bg-blue-400'
  if (t.includes('asset') || t.includes('inventory')) return 'bg-violet-400'
  if (t.includes('finding') || t.includes('analysis')) return 'bg-cyan-400'
  if (t.includes('action') || t.includes('worksheet')) return 'bg-emerald-400'
  if (t.includes('cycle')) return 'bg-amber-400'
  if (t.includes('alert')) return 'bg-rose-400'
  if (t.includes('policy') || t.includes('retention')) return 'bg-teal-400'
  return 'bg-slate-500'
}

const LIMITS = [25, 50, 100, 200]

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [entityType, setEntityType] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(100)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, unknown> = { limit }
      if (entityType !== 'all') params.entity_type = entityType
      const data = await api.getActivity(params)
      setEntries(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, limit])

  const entityTypes = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.entity_type) set.add(e.entity_type)
    return Array.from(set).sort()
  }, [entries])

  const actions = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.action) set.add(e.action)
    return Array.from(set).sort()
  }, [entries])

  const filtered = useMemo(() => {
    let rows = entries.slice()
    if (actionFilter !== 'all') rows = rows.filter((e) => (e.action || '') === actionFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (e) =>
          (e.action || '').toLowerCase().includes(q) ||
          (e.entity_type || '').toLowerCase().includes(q) ||
          (e.entity_id || '').toLowerCase().includes(q) ||
          JSON.stringify(e.detail || {}).toLowerCase().includes(q),
      )
    }
    rows.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    return rows
  }, [entries, actionFilter, search])

  const grouped = useMemo(() => {
    const map = new Map<string, ActivityEntry[]>()
    for (const e of filtered) {
      const d = e.created_at ? new Date(e.created_at) : null
      const key = d && !isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown date'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return Array.from(map.entries())
  }, [filtered])

  const todayCount = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return entries.filter((e) => e.created_at && new Date(e.created_at).getTime() >= start.getTime()).length
  }, [entries])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Activity Log</h1>
          <p className="mt-1 text-sm text-slate-500">
            A chronological audit feed of every change across accounts, assets, findings, actions, and cycles.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Events loaded" value={entries.length.toLocaleString()} hint={`Most recent ${limit}`} tone="cyan" />
        <Stat label="Today" value={todayCount.toLocaleString()} hint="Since midnight" />
        <Stat label="Entity types" value={entityTypes.length.toLocaleString()} hint="Distinct in feed" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-200">Audit feed</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events..."
              className="w-52 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            />
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="all">All entities</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="all">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              {LIMITS.map((n) => (
                <option key={n} value={n}>
                  Last {n}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {loading ? (
            <div className="py-16">
              <Spinner label="Loading activity..." />
            </div>
          ) : error ? (
            <EmptyState
              title="Could not load activity"
              description={error}
              icon="⚠"
              action={
                <Button variant="secondary" onClick={load}>
                  Try again
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={entries.length === 0 ? 'No activity yet' : 'No events match your filters'}
              description={
                entries.length === 0
                  ? 'Actions you take across the platform will be recorded here.'
                  : 'Try clearing the search or filters.'
              }
              icon="🗒"
            />
          ) : (
            <div className="space-y-6">
              {grouped.map(([day, items]) => (
                <div key={day}>
                  <div className="mb-3 flex items-center gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{day}</h3>
                    <div className="h-px flex-1 bg-slate-800" />
                    <span className="text-xs text-slate-600">{items.length}</span>
                  </div>
                  <ol className="space-y-3">
                    {items.map((e) => (
                      <li key={e.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${entityDot(e.entity_type)}`} />
                          <span className="mt-1 w-px flex-1 bg-slate-800" />
                        </div>
                        <div className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={actionTone(e.action)}>{e.action || 'event'}</Badge>
                              {e.entity_type && <span className="text-sm font-medium text-slate-200">{e.entity_type}</span>}
                              {e.entity_id && (
                                <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">{e.entity_id}</code>
                              )}
                            </div>
                            <span className="text-xs text-slate-500" title={fmtDateTime(e.created_at)}>
                              {relTime(e.created_at)}
                            </span>
                          </div>
                          {e.detail && Object.keys(e.detail).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {Object.entries(e.detail).slice(0, 8).map(([k, v]) => (
                                <span
                                  key={k}
                                  className="rounded bg-slate-800/60 px-2 py-0.5 text-xs text-slate-400"
                                >
                                  <span className="text-slate-500">{k}:</span>{' '}
                                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="mt-1 text-[11px] text-slate-600">{fmtDateTime(e.created_at)}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
