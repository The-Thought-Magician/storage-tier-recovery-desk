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

interface Alert {
  id: string
  rule_id?: string | null
  message?: string | null
  severity?: string | null
  value?: number | null
  status?: string | null
  created_at?: string | null
}

interface AlertRule {
  id: string
  name?: string | null
  metric?: string | null
  threshold?: number | null
  enabled?: boolean | null
  created_at?: string | null
}

const METRICS = [
  { value: 'recoverable_monthly', label: 'Recoverable / month ($)' },
  { value: 'untagged_spend', label: 'Untagged spend ($)' },
  { value: 'orphan_monthly', label: 'Orphan cost / month ($)' },
  { value: 'snapshot_monthly', label: 'Snapshot cost / month ($)' },
  { value: 'mistier_monthly', label: 'Mis-tier cost / month ($)' },
  { value: 'recovery_rate', label: 'Recovery rate (%)' },
]

function metricLabel(m?: string | null) {
  const found = METRICS.find((x) => x.value === m)
  return found ? found.label : m || '—'
}

function severityTone(s?: string | null): 'rose' | 'amber' | 'cyan' | 'slate' {
  const v = (s || '').toLowerCase()
  if (v === 'critical' || v === 'high') return 'rose'
  if (v === 'warning' || v === 'medium') return 'amber'
  if (v === 'info' || v === 'low') return 'cyan'
  return 'slate'
}

function statusTone(s?: string | null): 'green' | 'amber' | 'slate' | 'rose' {
  const v = (s || '').toLowerCase()
  if (v === 'resolved') return 'green'
  if (v === 'acknowledged') return 'amber'
  if (v === 'open' || v === 'firing' || v === 'active') return 'rose'
  return 'slate'
}

function fmtDate(s?: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtValue(n?: number | null) {
  if (n == null) return '—'
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

interface RuleForm {
  name: string
  metric: string
  threshold: string
  enabled: boolean
}

const EMPTY_RULE: RuleForm = { name: '', metric: METRICS[0].value, threshold: '', enabled: true }

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [busyAlert, setBusyAlert] = useState<Record<string, true>>({})

  const [ruleModalOpen, setRuleModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingRule, setDeletingRule] = useState<AlertRule | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [a, r] = await Promise.all([api.getAlerts(), api.getAlertRules()])
      setAlerts(Array.isArray(a) ? a : [])
      setRules(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const severities = useMemo(() => {
    const set = new Set<string>()
    for (const a of alerts) if (a.severity) set.add(a.severity)
    return Array.from(set).sort()
  }, [alerts])

  const statuses = useMemo(() => {
    const set = new Set<string>()
    for (const a of alerts) if (a.status) set.add(a.status)
    return Array.from(set).sort()
  }, [alerts])

  const filtered = useMemo(() => {
    let rows = alerts.slice()
    if (statusFilter !== 'all') rows = rows.filter((a) => (a.status || '') === statusFilter)
    if (severityFilter !== 'all') rows = rows.filter((a) => (a.severity || '') === severityFilter)
    const q = search.trim().toLowerCase()
    if (q) rows = rows.filter((a) => (a.message || '').toLowerCase().includes(q))
    rows.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    return rows
  }, [alerts, statusFilter, severityFilter, search])

  const openCount = useMemo(
    () => alerts.filter((a) => ['open', 'firing', 'active'].includes((a.status || '').toLowerCase())).length,
    [alerts],
  )
  const criticalCount = useMemo(
    () => alerts.filter((a) => ['critical', 'high'].includes((a.severity || '').toLowerCase())).length,
    [alerts],
  )
  const enabledRules = useMemo(() => rules.filter((r) => r.enabled).length, [rules])

  async function setAlertStatus(a: Alert, status: string) {
    setBusyAlert((p) => ({ ...p, [a.id]: true }))
    try {
      const updated = await api.updateAlertStatus(a.id, { status })
      setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...(updated || {}), status } : x)))
      setBanner(`Alert marked ${status}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update alert')
    } finally {
      setBusyAlert((p) => {
        const next = { ...p }
        delete next[a.id]
        return next
      })
    }
  }

  function openCreateRule() {
    setEditingRule(null)
    setForm(EMPTY_RULE)
    setFormError(null)
    setRuleModalOpen(true)
  }

  function openEditRule(r: AlertRule) {
    setEditingRule(r)
    setForm({
      name: r.name || '',
      metric: r.metric || METRICS[0].value,
      threshold: r.threshold == null ? '' : String(r.threshold),
      enabled: r.enabled ?? true,
    })
    setFormError(null)
    setRuleModalOpen(true)
  }

  async function submitRule() {
    if (!form.name.trim()) {
      setFormError('Name is required.')
      return
    }
    const thr = Number(form.threshold)
    if (form.threshold === '' || isNaN(thr)) {
      setFormError('Threshold must be a number.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    const body = {
      name: form.name.trim(),
      metric: form.metric,
      threshold: thr,
      enabled: form.enabled,
    }
    try {
      if (editingRule) {
        const updated = await api.updateAlertRule(editingRule.id, body)
        setRules((prev) => prev.map((x) => (x.id === editingRule.id ? { ...x, ...(updated || body) } : x)))
        setBanner(`Rule "${body.name}" updated.`)
      } else {
        const created = await api.createAlertRule(body)
        if (created && created.id) setRules((prev) => [created, ...prev])
        else await load()
        setBanner(`Rule "${body.name}" created.`)
      }
      setRuleModalOpen(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save rule')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleRule(r: AlertRule) {
    try {
      const next = !r.enabled
      const updated = await api.updateAlertRule(r.id, {
        name: r.name,
        metric: r.metric,
        threshold: r.threshold,
        enabled: next,
      })
      setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...(updated || {}), enabled: next } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle rule')
    }
  }

  async function confirmDeleteRule() {
    if (!deletingRule) return
    setDeleteBusy(true)
    try {
      await api.deleteAlertRule(deletingRule.id)
      setRules((prev) => prev.filter((x) => x.id !== deletingRule.id))
      setBanner(`Rule "${deletingRule.name || 'rule'}" deleted.`)
      setDeletingRule(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete rule')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Alerts</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Threshold rules watch your recoverable-spend signals and raise alerts when a metric crosses its limit.
            Acknowledge or resolve alerts and tune rules below.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button onClick={openCreateRule}>New rule</Button>
        </div>
      </div>

      {banner && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="text-emerald-400 hover:text-emerald-200" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open alerts" value={openCount.toLocaleString()} hint="Awaiting action" tone={openCount > 0 ? 'rose' : 'green'} />
        <Stat label="Critical / high" value={criticalCount.toLocaleString()} hint="By severity" tone={criticalCount > 0 ? 'amber' : 'default'} />
        <Stat label="Total alerts" value={alerts.length.toLocaleString()} hint="All time" />
        <Stat label="Active rules" value={`${enabledRules}/${rules.length}`} hint="Enabled / total" tone="cyan" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">Alert feed</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages..."
              className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            >
              <option value="all">All severities</option>
              {severities.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-16">
              <Spinner label="Loading alerts..." />
            </div>
          ) : error && alerts.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title="Could not load alerts"
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
                title={alerts.length === 0 ? 'No alerts yet' : 'No alerts match your filters'}
                description={
                  alerts.length === 0
                    ? 'Alerts will appear here when a rule threshold is crossed. Create a rule to start monitoring.'
                    : 'Try clearing the search or filters.'
                }
                icon="🔔"
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Alert</TH>
                  <TH className="text-center">Severity</TH>
                  <TH className="text-right">Value</TH>
                  <TH className="text-center">Status</TH>
                  <TH>When</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((a) => {
                  const busy = !!busyAlert[a.id]
                  const isResolved = (a.status || '').toLowerCase() === 'resolved'
                  const isAck = (a.status || '').toLowerCase() === 'acknowledged'
                  return (
                    <TR key={a.id}>
                      <TD>
                        <div className="font-medium text-zinc-100">{a.message || 'Alert'}</div>
                        <div className="mt-0.5 text-xs text-zinc-500">Rule {a.rule_id || '—'}</div>
                      </TD>
                      <TD className="text-center">
                        <Badge tone={severityTone(a.severity)}>{a.severity || 'info'}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums text-zinc-300">{fmtValue(a.value)}</TD>
                      <TD className="text-center">
                        <Badge tone={statusTone(a.status)}>{a.status || 'open'}</Badge>
                      </TD>
                      <TD className="text-zinc-400">{fmtDate(a.created_at)}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          {!isAck && !isResolved && (
                            <Button
                              variant="secondary"
                              className="px-3 py-1.5 text-xs"
                              disabled={busy}
                              onClick={() => setAlertStatus(a, 'acknowledged')}
                            >
                              {busy ? '...' : 'Ack'}
                            </Button>
                          )}
                          {!isResolved && (
                            <Button
                              className="px-3 py-1.5 text-xs"
                              disabled={busy}
                              onClick={() => setAlertStatus(a, 'resolved')}
                            >
                              {busy ? '...' : 'Resolve'}
                            </Button>
                          )}
                          {isResolved && <Badge tone="green">Resolved ✓</Badge>}
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

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Alert rules</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Define which metrics to watch and the thresholds that raise alerts.</p>
          </div>
          <Button onClick={openCreateRule} className="px-3 py-1.5 text-xs">
            New rule
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-12">
              <Spinner label="Loading rules..." />
            </div>
          ) : rules.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title="No rules configured"
                description="Create a rule to monitor a metric and raise alerts when it crosses a threshold."
                icon="⚙"
                action={<Button onClick={openCreateRule}>Create rule</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Rule</TH>
                  <TH>Metric</TH>
                  <TH className="text-right">Threshold</TH>
                  <TH className="text-center">Enabled</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rules.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-zinc-100">{r.name || 'Rule'}</TD>
                    <TD className="text-zinc-300">{metricLabel(r.metric)}</TD>
                    <TD className="text-right tabular-nums text-lime-300">{fmtValue(r.threshold)}</TD>
                    <TD className="text-center">
                      <button
                        onClick={() => toggleRule(r)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          r.enabled ? 'bg-lime-500' : 'bg-zinc-700'
                        }`}
                        aria-label="Toggle rule"
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            r.enabled ? 'tranzinc-x-4' : 'tranzinc-x-0.5'
                          }`}
                        />
                      </button>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => openEditRule(r)}>
                          Edit
                        </Button>
                        <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => setDeletingRule(r)}>
                          Delete
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={ruleModalOpen}
        onClose={() => (submitting ? null : setRuleModalOpen(false))}
        title={editingRule ? 'Edit alert rule' : 'New alert rule'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRuleModalOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitRule} disabled={submitting}>
              {submitting ? 'Saving...' : editingRule ? 'Save changes' : 'Create rule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Recoverable spend spike"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Metric</label>
            <select
              value={form.metric}
              onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            >
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Threshold</label>
            <input
              value={form.threshold}
              onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
              type="number"
              placeholder="e.g. 1000"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-zinc-600">Alert raised when the metric crosses this value.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-lime-600 focus:ring-lime-500"
            />
            Enabled
          </label>
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!deletingRule}
        onClose={() => (deleteBusy ? null : setDeletingRule(null))}
        title="Delete alert rule"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletingRule(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteRule} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting...' : 'Delete rule'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          Delete rule <span className="font-medium text-zinc-100">{deletingRule?.name || 'this rule'}</span>? Existing
          alerts it raised will remain. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
