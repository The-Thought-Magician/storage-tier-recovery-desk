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

interface RecoveryAction {
  id: string
  finding_id: string | null
  account_id: string | null
  asset_id: string | null
  cycle_id: string | null
  action_type: string
  title: string
  monthly_savings: number | null
  annual_savings: number | null
  effort_score: number | null
  risk_score: number | null
  priority_score: number | null
  owner: string | null
  status: string
  notes: string | null
  created_at?: string
  updated_at?: string
}

interface Cycle {
  id: string
  name: string
  status?: string
}

interface Summary {
  total_monthly: number
  total_annual: number
  by_status: { status: string; count: number; monthly?: number }[]
  by_type: { action_type: string; count: number; monthly?: number }[]
}

const STATUSES = ['proposed', 'approved', 'in-progress', 'done', 'dismissed']
const STATUS_TONE: Record<string, 'slate' | 'blue' | 'amber' | 'green' | 'rose'> = {
  proposed: 'slate',
  approved: 'blue',
  'in-progress': 'amber',
  done: 'green',
  dismissed: 'rose',
}
const RISK_LEVELS = ['low', 'medium', 'high']

function money(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function riskBand(score: number | null | undefined): 'low' | 'medium' | 'high' {
  const v = Number(score || 0)
  if (v <= 33) return 'low'
  if (v <= 66) return 'medium'
  return 'high'
}

export default function WorksheetPage() {
  const [actions, setActions] = useState<RecoveryAction[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [riskFilter, setRiskFilter] = useState('all')

  const [selected, setSelected] = useState<string[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  const [editAction, setEditAction] = useState<RecoveryAction | null>(null)
  const [editForm, setEditForm] = useState({ status: '', owner: '', notes: '', cycle_id: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ws, sum, cyc] = await Promise.all([api.getWorksheet(), api.getWorksheetSummary(), api.getCycles()])
      setActions(Array.isArray(ws) ? ws : [])
      setSummary(sum || null)
      setCycles(Array.isArray(cyc) ? cyc : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load worksheet')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const actionTypes = useMemo(() => Array.from(new Set(actions.map((a) => a.action_type))).sort(), [actions])
  const cycleName = (id: string | null) => cycles.find((c) => c.id === id)?.name || (id ? 'Unknown' : '—')

  const filtered = useMemo(() => {
    return actions
      .filter((a) => {
        if (search && !`${a.title} ${a.owner || ''}`.toLowerCase().includes(search.toLowerCase())) return false
        if (statusFilter !== 'all' && a.status !== statusFilter) return false
        if (typeFilter !== 'all' && a.action_type !== typeFilter) return false
        if (riskFilter !== 'all' && riskBand(a.risk_score) !== riskFilter) return false
        return true
      })
      .sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0))
  }, [actions, search, statusFilter, typeFilter, riskFilter])

  const filteredMonthly = filtered.reduce((s, a) => s + Number(a.monthly_savings || 0), 0)

  function openEdit(a: RecoveryAction) {
    setEditAction(a)
    setEditForm({ status: a.status, owner: a.owner || '', notes: a.notes || '', cycle_id: a.cycle_id || '' })
    setEditError(null)
  }

  async function saveEdit() {
    if (!editAction) return
    setSavingEdit(true)
    setEditError(null)
    try {
      const updated: RecoveryAction = await api.updateAction(editAction.id, {
        status: editForm.status,
        owner: editForm.owner.trim() || null,
        notes: editForm.notes.trim() || null,
        cycle_id: editForm.cycle_id || null,
      })
      setActions((prev) => prev.map((a) => (a.id === editAction.id ? { ...a, ...updated } : a)))
      setEditAction(null)
      // refresh summary since status/savings rollups may change
      try {
        const sum = await api.getWorksheetSummary()
        setSummary(sum || null)
      } catch {
        /* non-fatal */
      }
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setSavingEdit(false)
    }
  }

  async function quickStatus(a: RecoveryAction, status: string) {
    setBusyId(a.id)
    try {
      const updated: RecoveryAction = await api.updateAction(a.id, { status })
      setActions((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...updated } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(a: RecoveryAction) {
    if (!confirm(`Delete action "${a.title}"?`)) return
    setBusyId(a.id)
    try {
      await api.deleteAction(a.id)
      setActions((prev) => prev.filter((x) => x.id !== a.id))
      setSelected((s) => s.filter((id) => id !== a.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  function toggleSelect(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }
  function toggleAll() {
    setSelected((s) => (s.length === filtered.length ? [] : filtered.map((a) => a.id)))
  }

  async function bulkStatus(status: string) {
    if (selected.length === 0) return
    setBulkBusy(true)
    setError(null)
    try {
      await Promise.all(selected.map((id) => api.updateAction(id, { status })))
      await load()
      setSelected([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk update failed')
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkAssignCycle(cycleId: string) {
    if (selected.length === 0 || !cycleId) return
    setBulkBusy(true)
    setError(null)
    try {
      await Promise.all(selected.map((id) => api.updateAction(id, { cycle_id: cycleId })))
      await load()
      setSelected([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk assign failed')
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkDelete() {
    if (selected.length === 0) return
    if (!confirm(`Delete ${selected.length} selected action(s)?`)) return
    setBulkBusy(true)
    setError(null)
    try {
      await Promise.all(selected.map((id) => api.deleteAction(id)))
      await load()
      setSelected([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk delete failed')
    } finally {
      setBulkBusy(false)
    }
  }

  const allSelected = filtered.length > 0 && selected.length === filtered.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Recovery Worksheet</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Ranked recovery actions across your estate. Assign owners, set status, and slot actions into recovery cycles.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {loading ? (
        <div className="py-24">
          <Spinner label="Loading worksheet…" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total Recoverable / mo" value={money(summary?.total_monthly)} tone="cyan" />
            <Stat label="Annualized" value={money(summary?.total_annual)} tone="green" />
            <Stat label="Open Actions" value={actions.filter((a) => !['done', 'dismissed'].includes(a.status)).length} hint={`${actions.length} total`} />
            <Stat label="Filtered Recoverable / mo" value={money(filteredMonthly)} hint={`${filtered.length} shown`} />
          </div>

          {summary && (summary.by_status?.length || summary.by_type?.length) ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader><h2 className="text-sm font-semibold text-zinc-200">By Status</h2></CardHeader>
                <CardBody className="space-y-2">
                  {(summary.by_status || []).map((s) => {
                    const max = Math.max(1, ...(summary.by_status || []).map((x) => x.count))
                    return (
                      <div key={s.status}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="capitalize text-zinc-300">{s.status.replace('_', ' ')}</span>
                          <span className="tabular-nums text-zinc-400">{s.count}{s.monthly != null ? ` · ${money(s.monthly)}/mo` : ''}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                          <div className="h-full rounded-full bg-lime-500" style={{ width: `${(s.count / max) * 100}%` }} />
                        </div>
                      </div>
                    )
                  })}
                  {(!summary.by_status || summary.by_status.length === 0) && <p className="text-sm text-zinc-500">No data.</p>}
                </CardBody>
              </Card>
              <Card>
                <CardHeader><h2 className="text-sm font-semibold text-zinc-200">By Action Type</h2></CardHeader>
                <CardBody className="space-y-2">
                  {(summary.by_type || []).map((t) => {
                    const max = Math.max(1, ...(summary.by_type || []).map((x) => x.count))
                    return (
                      <div key={t.action_type}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="capitalize text-zinc-300">{t.action_type.replace('_', ' ')}</span>
                          <span className="tabular-nums text-zinc-400">{t.count}{t.monthly != null ? ` · ${money(t.monthly)}/mo` : ''}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                          <div className="h-full rounded-full bg-emerald-400" style={{ width: `${(t.count / max) * 100}%` }} />
                        </div>
                      </div>
                    )
                  })}
                  {(!summary.by_type || summary.by_type.length === 0) && <p className="text-sm text-zinc-500">No data.</p>}
                </CardBody>
              </Card>
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="mr-auto text-sm font-semibold text-zinc-200">Actions</h2>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search title / owner…"
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
                />
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none">
                  <option value="all">All status</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none">
                  <option value="all">All types</option>
                  {actionTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none">
                  <option value="all">All risk</option>
                  {RISK_LEVELS.map((r) => <option key={r} value={r}>{r} risk</option>)}
                </select>
              </div>
            </CardHeader>

            {selected.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-950/60 px-5 py-3 text-sm">
                <span className="text-zinc-300">{selected.length} selected</span>
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { bulkStatus(e.target.value); e.target.value = '' } }}
                  disabled={bulkBusy}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 focus:border-lime-500 focus:outline-none"
                >
                  <option value="">Set status…</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { bulkAssignCycle(e.target.value); e.target.value = '' } }}
                  disabled={bulkBusy || cycles.length === 0}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 focus:border-lime-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="">Assign to cycle…</option>
                  {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <Button variant="ghost" className="px-2 py-1 text-rose-400 hover:text-rose-300" disabled={bulkBusy} onClick={bulkDelete}>Delete selected</Button>
                <Button variant="ghost" className="px-2 py-1" onClick={() => setSelected([])}>Clear</Button>
                {bulkBusy && <Spinner />}
              </div>
            )}

            <CardBody className="p-0">
              {filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title={actions.length === 0 ? 'No recovery actions yet' : 'No actions match your filters'}
                    description={actions.length === 0 ? 'Promote findings from the detectors (mis-tier, snapshots, orphans) into the worksheet to start tracking recovery.' : 'Try clearing search or filters.'}
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-8">
                        <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-lime-500" />
                      </TH>
                      <TH>Action</TH>
                      <TH>Type</TH>
                      <TH className="text-right">Priority</TH>
                      <TH className="text-right">Savings / mo</TH>
                      <TH>Risk</TH>
                      <TH>Owner</TH>
                      <TH>Cycle</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((a) => {
                      const band = riskBand(a.risk_score)
                      return (
                        <TR key={a.id} className={selected.includes(a.id) ? 'bg-zinc-800/40' : ''}>
                          <TD>
                            <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggleSelect(a.id)} className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-lime-500" />
                          </TD>
                          <TD className="max-w-xs font-medium text-zinc-100">{a.title}</TD>
                          <TD><Badge tone="slate">{a.action_type}</Badge></TD>
                          <TD className="text-right tabular-nums text-lime-300">{a.priority_score != null ? Number(a.priority_score).toFixed(0) : '—'}</TD>
                          <TD className="text-right tabular-nums text-emerald-300">{money(a.monthly_savings)}</TD>
                          <TD><Badge tone={band === 'low' ? 'green' : band === 'medium' ? 'amber' : 'rose'}>{band}</Badge></TD>
                          <TD className="text-zinc-400">{a.owner || <span className="text-zinc-600">unassigned</span>}</TD>
                          <TD className="text-zinc-400">{cycleName(a.cycle_id)}</TD>
                          <TD>
                            <select
                              value={a.status}
                              disabled={busyId === a.id}
                              onChange={(e) => quickStatus(a, e.target.value)}
                              className={`rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs capitalize focus:border-lime-500 focus:outline-none disabled:opacity-50 ${
                                {
                                  slate: 'text-zinc-300',
                                  blue: 'text-lime-300',
                                  amber: 'text-amber-300',
                                  green: 'text-emerald-300',
                                  rose: 'text-rose-300',
                                }[STATUS_TONE[a.status] || 'slate']
                              }`}
                            >
                              {STATUSES.map((s) => <option key={s} value={s} className="text-zinc-200">{s.replace('_', ' ')}</option>)}
                            </select>
                          </TD>
                          <TD className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" className="px-2 py-1" onClick={() => openEdit(a)}>Edit</Button>
                              <Button variant="ghost" className="px-2 py-1 text-rose-400 hover:text-rose-300" disabled={busyId === a.id} onClick={() => remove(a)}>Delete</Button>
                            </div>
                          </TD>
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
        open={!!editAction}
        onClose={() => !savingEdit && setEditAction(null)}
        title="Edit Action"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditAction(null)} disabled={savingEdit}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save Changes'}</Button>
          </>
        }
      >
        {editAction && (
          <div className="space-y-4">
            {editError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{editError}</div>
            )}
            <div>
              <div className="text-sm font-medium text-zinc-100">{editAction.title}</div>
              <div className="mt-1 flex gap-3 text-xs text-zinc-500">
                <span>{editAction.action_type}</span>
                <span className="text-emerald-300">{money(editAction.monthly_savings)}/mo</span>
                <span>priority {editAction.priority_score != null ? Number(editAction.priority_score).toFixed(0) : '—'}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm capitalize text-zinc-200 focus:border-lime-500 focus:outline-none"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Cycle</label>
                <select
                  value={editForm.cycle_id}
                  onChange={(e) => setEditForm({ ...editForm, cycle_id: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
                >
                  <option value="">Unassigned</option>
                  {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Owner</label>
              <input
                value={editForm.owner}
                onChange={(e) => setEditForm({ ...editForm, owner: e.target.value })}
                placeholder="e.g. platform-team"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Notes</label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={3}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
