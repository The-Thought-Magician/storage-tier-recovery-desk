'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface CycleProgress {
  realized_monthly?: number | string | null
  modeled_monthly?: number | string | null
  actions_total?: number | null
  actions_done?: number | null
  pct?: number | string | null
}

interface RecoveryCycle {
  id: string
  name: string
  target_monthly_savings: number | string | null
  start_date: string | null
  end_date: string | null
  status: string
  created_at: string
  progress?: CycleProgress | null
}

interface RecoveryAction {
  id: string
  title: string
  action_type: string
  monthly_savings: number | string | null
  status: string
  owner: string | null
}

interface RealizedSaving {
  id: string
  action_id: string
  modeled_monthly: number | string | null
  realized_monthly: number | string | null
  variance: number | string | null
}

interface CycleDetail {
  cycle: RecoveryCycle
  actions: RecoveryAction[]
  realized: RealizedSaving[]
}

const STATUSES = ['planned', 'active', 'closed'] as const
type CycleStatus = (typeof STATUSES)[number]

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}
function money(v: unknown): string {
  return num(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtDate(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function statusTone(s: string): 'green' | 'cyan' | 'slate' | 'amber' {
  if (s === 'active') return 'cyan'
  if (s === 'closed') return 'green'
  if (s === 'planned') return 'amber'
  return 'slate'
}

function progressPct(c: RecoveryCycle): number {
  const p = c.progress
  if (!p) return 0
  if (p.pct != null) return Math.max(0, Math.min(100, num(p.pct)))
  const target = num(c.target_monthly_savings)
  const realized = num(p.realized_monthly)
  if (target > 0) return Math.max(0, Math.min(100, (realized / target) * 100))
  const total = num(p.actions_total)
  const done = num(p.actions_done)
  return total > 0 ? (done / total) * 100 : 0
}

export default function CyclesPage() {
  const [cycles, setCycles] = useState<RecoveryCycle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<'all' | CycleStatus>('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RecoveryCycle | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    target_monthly_savings: '',
    start_date: '',
    end_date: '',
    status: 'planned' as CycleStatus,
  })

  const [detail, setDetail] = useState<CycleDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const c = await api.getCycles()
      setCycles(Array.isArray(c) ? c : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cycles')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cycles.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (q && !c.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [cycles, statusFilter, search])

  const totals = useMemo(() => {
    let target = 0
    let realized = 0
    let active = 0
    for (const c of cycles) {
      target += num(c.target_monthly_savings)
      realized += num(c.progress?.realized_monthly)
      if (c.status === 'active') active += 1
    }
    return { target, realized, active }
  }, [cycles])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', target_monthly_savings: '', start_date: '', end_date: '', status: 'planned' })
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(c: RecoveryCycle) {
    setEditing(c)
    setForm({
      name: c.name,
      target_monthly_savings: c.target_monthly_savings != null ? String(num(c.target_monthly_savings)) : '',
      start_date: c.start_date ? c.start_date.slice(0, 10) : '',
      end_date: c.end_date ? c.end_date.slice(0, 10) : '',
      status: (STATUSES as readonly string[]).includes(c.status) ? (c.status as CycleStatus) : 'planned',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submit() {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        status: form.status,
      }
      if (form.target_monthly_savings !== '') body.target_monthly_savings = num(form.target_monthly_savings)
      if (form.start_date) body.start_date = form.start_date
      if (form.end_date) body.end_date = form.end_date
      if (editing) await api.updateCycle(editing.id, body)
      else await api.createCycle(body)
      setModalOpen(false)
      await load()
      if (detailId && editing && editing.id === detailId) await openDetail(detailId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save cycle')
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(c: RecoveryCycle) {
    if (!confirm(`Delete cycle "${c.name}"? This cannot be undone.`)) return
    try {
      await api.deleteCycle(c.id)
      if (detailId === c.id) { setDetail(null); setDetailId(null) }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete cycle')
    }
  }

  async function closeOut(c: RecoveryCycle) {
    try {
      await api.updateCycle(c.id, { status: 'closed' })
      await load()
      if (detailId === c.id) await openDetail(c.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close cycle')
    }
  }

  async function openDetail(id: string) {
    setDetailId(id)
    setDetailLoading(true)
    setDetailError(null)
    try {
      const d = await api.getCycle(id)
      setDetail(d ?? null)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load cycle detail')
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Recovery Cycles</h1>
          <p className="mt-1 text-sm text-zinc-500">Plan, run, and close out savings sprints against targets.</p>
        </div>
        <Button onClick={openCreate} disabled={loading}>New cycle</Button>
      </header>

      {error && (
        <Card className="border-rose-500/30">
          <CardBody className="flex items-center justify-between">
            <span className="text-sm text-rose-300">{error}</span>
            <Button variant="secondary" onClick={() => void load()}>Retry</Button>
          </CardBody>
        </Card>
      )}

      {loading ? (
        <div className="py-24"><Spinner label="Loading cycles…" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Active cycles" value={totals.active} tone="cyan" hint={`${cycles.length} total`} />
            <Stat label="Combined target" value={money(totals.target)} hint="Monthly across all cycles" />
            <Stat label="Realized so far" value={money(totals.realized)} tone="green" hint="Monthly booked" />
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-200">Cycle board</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search cycles…"
                  className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
                />
                <div className="flex overflow-hidden rounded-lg border border-zinc-700">
                  {(['all', ...STATUSES] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-lime-500 text-zinc-950' : 'bg-zinc-950 text-zinc-400 hover:bg-zinc-800'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardBody>
              {filtered.length === 0 ? (
                <EmptyState
                  title={cycles.length === 0 ? 'No recovery cycles yet' : 'No cycles match your filters'}
                  description={cycles.length === 0 ? 'Create a cycle to organize recovery actions into a time-boxed savings sprint.' : 'Try a different status or search term.'}
                  action={cycles.length === 0 ? <Button onClick={openCreate}>New cycle</Button> : undefined}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((c) => {
                    const pct = progressPct(c)
                    const realized = num(c.progress?.realized_monthly)
                    return (
                      <div
                        key={c.id}
                        className={`rounded-xl border bg-zinc-900/60 p-4 transition-colors hover:border-lime-500/40 ${detailId === c.id ? 'border-lime-500/50' : 'border-zinc-800'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button onClick={() => void openDetail(c.id)} className="text-left">
                            <h3 className="text-sm font-semibold text-zinc-100 hover:text-lime-300">{c.name}</h3>
                          </button>
                          <Badge tone={statusTone(c.status)} className="capitalize">{c.status}</Badge>
                        </div>
                        <div className="mt-2 text-xs text-zinc-500">
                          {fmtDate(c.start_date)} → {fmtDate(c.end_date)}
                        </div>
                        <div className="mt-3 space-y-1">
                          <div className="flex items-center justify-between text-xs text-zinc-400">
                            <span>{money(realized)} of {money(c.target_monthly_savings)}</span>
                            <span className="tabular-nums text-lime-300">{pct.toFixed(0)}%</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                            <div className="h-full rounded-full bg-gradient-to-r from-lime-500 to-emerald-500" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                          <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => void openDetail(c.id)}>Open</Button>
                          <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => openEdit(c)}>Edit</Button>
                          {c.status !== 'closed' && (
                            <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => void closeOut(c)}>Close out</Button>
                          )}
                          <Button variant="ghost" className="ml-auto px-2.5 py-1 text-xs text-rose-400 hover:text-rose-300" onClick={() => void remove(c)}>Delete</Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          {detailId && (
            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">
                  Cycle detail{detail ? ` — ${detail.cycle.name}` : ''}
                </h2>
                <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => { setDetail(null); setDetailId(null) }}>Close</Button>
              </CardHeader>
              <CardBody>
                {detailLoading ? (
                  <div className="py-8"><Spinner label="Loading detail…" /></div>
                ) : detailError ? (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-rose-300">{detailError}</span>
                    <Button variant="secondary" onClick={() => detailId && void openDetail(detailId)}>Retry</Button>
                  </div>
                ) : detail ? (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                      <Stat label="Status" value={<span className="capitalize">{detail.cycle.status}</span>} tone="cyan" />
                      <Stat label="Target / mo" value={money(detail.cycle.target_monthly_savings)} />
                      <Stat label="Actions" value={detail.actions.length} hint={`${detail.actions.filter((a) => a.status === 'done' || a.status === 'completed' || a.status === 'realized').length} done`} />
                      <Stat
                        label="Realized / mo"
                        value={money(detail.realized.reduce((s, r) => s + num(r.realized_monthly), 0))}
                        tone="green"
                      />
                    </div>

                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Actions in cycle</h3>
                      {detail.actions.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">No actions assigned to this cycle.</p>
                      ) : (
                        <Table>
                          <THead>
                            <TR>
                              <TH>Action</TH>
                              <TH>Type</TH>
                              <TH>Owner</TH>
                              <TH className="text-right">Monthly</TH>
                              <TH>Status</TH>
                            </TR>
                          </THead>
                          <TBody>
                            {detail.actions.map((a) => (
                              <TR key={a.id}>
                                <TD className="text-zinc-200">{a.title}</TD>
                                <TD className="capitalize text-zinc-400">{a.action_type?.replace(/_/g, ' ')}</TD>
                                <TD className="text-zinc-400">{a.owner || '—'}</TD>
                                <TD className="text-right tabular-nums text-lime-300">{money(a.monthly_savings)}</TD>
                                <TD><Badge tone={a.status === 'done' || a.status === 'completed' || a.status === 'realized' ? 'green' : 'slate'} className="capitalize">{a.status?.replace(/_/g, ' ')}</Badge></TD>
                              </TR>
                            ))}
                          </TBody>
                        </Table>
                      )}
                    </div>

                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Realized savings</h3>
                      {detail.realized.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">No realized savings recorded for this cycle yet.</p>
                      ) : (
                        <Table>
                          <THead>
                            <TR>
                              <TH className="text-right">Modeled</TH>
                              <TH className="text-right">Realized</TH>
                              <TH className="text-right">Variance</TH>
                            </TR>
                          </THead>
                          <TBody>
                            {detail.realized.map((r) => {
                              const v = num(r.variance)
                              return (
                                <TR key={r.id}>
                                  <TD className="text-right tabular-nums text-lime-300">{money(r.modeled_monthly)}</TD>
                                  <TD className="text-right tabular-nums text-emerald-300">{money(r.realized_monthly)}</TD>
                                  <TD className="text-right tabular-nums"><Badge tone={v >= 0 ? 'green' : 'rose'}>{v >= 0 ? '+' : ''}{money(v)}</Badge></TD>
                                </TR>
                              )
                            })}
                          </TBody>
                        </Table>
                      )}
                    </div>

                    {detail.cycle.status !== 'closed' && (
                      <div className="flex justify-end border-t border-zinc-800 pt-4">
                        <Button onClick={() => void closeOut(detail.cycle)}>Close out cycle</Button>
                      </div>
                    )}
                  </div>
                ) : null}
              </CardBody>
            </Card>
          )}
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => { if (!submitting) setModalOpen(false) }}
        title={editing ? 'Edit cycle' : 'New cycle'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={submitting}>{submitting ? 'Saving…' : editing ? 'Save changes' : 'Create'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</p>}
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Q3 cold-tier sweep"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Target monthly savings</span>
            <input
              type="number"
              step="0.01"
              value={form.target_monthly_savings}
              onChange={(e) => setForm((f) => ({ ...f, target_monthly_savings: e.target.value }))}
              placeholder="0.00"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Start date</span>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">End date</span>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CycleStatus }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 capitalize focus:border-lime-500 focus:outline-none"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
      </Modal>
    </div>
  )
}
