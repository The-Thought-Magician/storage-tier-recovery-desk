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

interface RealizedSaving {
  id: string
  action_id: string
  cycle_id: string | null
  modeled_monthly: number | string | null
  realized_monthly: number | string | null
  variance: number | string | null
  realized_at: string | null
  created_at: string
}

interface RealizedSummary {
  realized_monthly: number | string | null
  modeled_monthly: number | string | null
  variance: number | string | null
  annualized: number | string | null
}

interface RecoveryAction {
  id: string
  title: string
  monthly_savings: number | string | null
  status: string
}

interface RecoveryCycle {
  id: string
  name: string
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

function money(v: unknown): string {
  return num(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function money2(v: unknown): string {
  return num(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function RealizedPage() {
  const [records, setRecords] = useState<RealizedSaving[]>([])
  const [summary, setSummary] = useState<RealizedSummary | null>(null)
  const [actions, setActions] = useState<RecoveryAction[]>([])
  const [cycles, setCycles] = useState<RecoveryCycle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [varianceFilter, setVarianceFilter] = useState<'all' | 'over' | 'under' | 'on'>('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    action_id: '',
    cycle_id: '',
    modeled_monthly: '',
    realized_monthly: '',
    realized_at: '',
  })

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [rec, sum, act, cyc] = await Promise.all([
        api.getRealized(),
        api.getRealizedSummary(),
        api.getWorksheet(),
        api.getCycles(),
      ])
      setRecords(Array.isArray(rec) ? rec : [])
      setSummary(sum ?? null)
      setActions(Array.isArray(act) ? act : [])
      setCycles(Array.isArray(cyc) ? cyc : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load realized savings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const actionTitle = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of actions) m.set(a.id, a.title)
    return m
  }, [actions])

  const cycleName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of cycles) m.set(c.id, c.name)
    return m
  }, [cycles])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return records.filter((r) => {
      if (q) {
        const title = (actionTitle.get(r.action_id) || '').toLowerCase()
        const cyc = (r.cycle_id ? cycleName.get(r.cycle_id) || '' : '').toLowerCase()
        if (!title.includes(q) && !cyc.includes(q) && !r.action_id.toLowerCase().includes(q)) return false
      }
      const v = num(r.variance)
      if (varianceFilter === 'over' && v <= 0) return false
      if (varianceFilter === 'under' && v >= 0) return false
      if (varianceFilter === 'on' && v !== 0) return false
      return true
    })
  }, [records, search, varianceFilter, actionTitle, cycleName])

  const realized = num(summary?.realized_monthly)
  const modeled = num(summary?.modeled_monthly)
  const variance = summary ? num(summary.variance) : realized - modeled
  const attainment = modeled > 0 ? (realized / modeled) * 100 : 0

  function resetForm() {
    setForm({ action_id: '', cycle_id: '', modeled_monthly: '', realized_monthly: '', realized_at: '' })
    setFormError(null)
  }

  function onPickAction(id: string) {
    const a = actions.find((x) => x.id === id)
    setForm((f) => ({
      ...f,
      action_id: id,
      modeled_monthly: a && f.modeled_monthly === '' ? String(num(a.monthly_savings)) : f.modeled_monthly,
    }))
  }

  async function submit() {
    if (!form.action_id) {
      setFormError('Select a recovery action')
      return
    }
    if (form.realized_monthly === '') {
      setFormError('Enter the realized monthly amount')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const modeled_monthly = form.modeled_monthly === '' ? undefined : num(form.modeled_monthly)
      const realized_monthly = num(form.realized_monthly)
      const body: Record<string, unknown> = {
        action_id: form.action_id,
        realized_monthly,
      }
      if (form.cycle_id) body.cycle_id = form.cycle_id
      if (modeled_monthly !== undefined) {
        body.modeled_monthly = modeled_monthly
        body.variance = realized_monthly - modeled_monthly
      }
      if (form.realized_at) body.realized_at = new Date(form.realized_at).toISOString()
      await api.recordRealized(body)
      setModalOpen(false)
      resetForm()
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to record realized savings')
    } finally {
      setSubmitting(false)
    }
  }

  const maxBar = Math.max(realized, modeled, 1)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Realized Savings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Track booked savings against modeled projections and measure attainment.
          </p>
        </div>
        <Button onClick={() => { resetForm(); setModalOpen(true) }} disabled={loading}>
          Record realized
        </Button>
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
        <div className="py-24"><Spinner label="Loading realized savings…" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Realized / month" value={money(realized)} tone="green" hint={`${money(num(summary?.annualized))} annualized`} />
            <Stat label="Modeled / month" value={money(modeled)} tone="cyan" hint="Sum of modeled estimates" />
            <Stat
              label="Variance / month"
              value={`${variance >= 0 ? '+' : ''}${money(variance)}`}
              tone={variance >= 0 ? 'green' : 'rose'}
              hint={variance >= 0 ? 'Ahead of model' : 'Behind model'}
            />
            <Stat label="Attainment" value={`${attainment.toFixed(0)}%`} tone={attainment >= 100 ? 'green' : attainment >= 75 ? 'amber' : 'rose'} hint="Realized vs modeled" />
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Modeled vs Realized</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Modeled monthly</span>
                  <span className="tabular-nums text-cyan-300">{money2(modeled)}</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-cyan-500/70" style={{ width: `${(modeled / maxBar) * 100}%` }} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Realized monthly</span>
                  <span className="tabular-nums text-emerald-300">{money2(realized)}</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${(realized / maxBar) * 100}%` }} />
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-slate-800 pt-3 text-xs text-slate-500">
                <span className="inline-block h-2 w-2 rounded-full bg-cyan-500/70" /> Modeled
                <span className="ml-3 inline-block h-2 w-2 rounded-full bg-emerald-500/70" /> Realized
                <span className="ml-auto">Records: {records.length}</span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-200">Realized records</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search action or cycle…"
                  className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                />
                <select
                  value={varianceFilter}
                  onChange={(e) => setVarianceFilter(e.target.value as typeof varianceFilter)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="all">All variance</option>
                  <option value="over">Over model</option>
                  <option value="under">Under model</option>
                  <option value="on">On model</option>
                </select>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title={records.length === 0 ? 'No realized savings yet' : 'No records match your filters'}
                    description={records.length === 0 ? 'Record realized savings as recovery actions complete to track attainment.' : 'Adjust search or variance filter.'}
                    action={records.length === 0 ? <Button onClick={() => { resetForm(); setModalOpen(true) }}>Record realized</Button> : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Action</TH>
                      <TH>Cycle</TH>
                      <TH className="text-right">Modeled</TH>
                      <TH className="text-right">Realized</TH>
                      <TH className="text-right">Variance</TH>
                      <TH>Realized at</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((r) => {
                      const v = num(r.variance)
                      return (
                        <TR key={r.id}>
                          <TD className="text-slate-200">{actionTitle.get(r.action_id) || r.action_id.slice(0, 8)}</TD>
                          <TD>{r.cycle_id ? (cycleName.get(r.cycle_id) || '—') : <span className="text-slate-600">Unassigned</span>}</TD>
                          <TD className="text-right tabular-nums text-cyan-300">{money2(r.modeled_monthly)}</TD>
                          <TD className="text-right tabular-nums text-emerald-300">{money2(r.realized_monthly)}</TD>
                          <TD className="text-right tabular-nums">
                            <Badge tone={v >= 0 ? 'green' : 'rose'}>{v >= 0 ? '+' : ''}{money2(v)}</Badge>
                          </TD>
                          <TD className="text-slate-400">{fmtDate(r.realized_at)}</TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => { if (!submitting) setModalOpen(false) }}
        title="Record realized savings"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</p>}
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Recovery action</span>
            <select
              value={form.action_id}
              onChange={(e) => onPickAction(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">Select an action…</option>
              {actions.map((a) => (
                <option key={a.id} value={a.id}>{a.title} ({money(a.monthly_savings)}/mo)</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Cycle (optional)</span>
            <select
              value={form.cycle_id}
              onChange={(e) => setForm((f) => ({ ...f, cycle_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">Unassigned</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Modeled monthly</span>
              <input
                type="number"
                step="0.01"
                value={form.modeled_monthly}
                onChange={(e) => setForm((f) => ({ ...f, modeled_monthly: e.target.value }))}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Realized monthly</span>
              <input
                type="number"
                step="0.01"
                value={form.realized_monthly}
                onChange={(e) => setForm((f) => ({ ...f, realized_monthly: e.target.value }))}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Realized at (optional)</span>
            <input
              type="date"
              value={form.realized_at}
              onChange={(e) => setForm((f) => ({ ...f, realized_at: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </label>
          {form.modeled_monthly !== '' && form.realized_monthly !== '' && (
            <p className="text-xs text-slate-500">
              Variance: <span className={num(form.realized_monthly) - num(form.modeled_monthly) >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                {num(form.realized_monthly) - num(form.modeled_monthly) >= 0 ? '+' : ''}{money2(num(form.realized_monthly) - num(form.modeled_monthly))}
              </span>
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
