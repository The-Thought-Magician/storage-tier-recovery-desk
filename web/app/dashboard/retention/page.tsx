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

interface RetentionPolicy {
  id: string
  name: string
  scope_type: string
  scope_value: string | null
  max_age_days: number | null
  transition_after_days: number | null
  transition_to_tier: string | null
  delete_after_days: number | null
  enabled: boolean
  created_at?: string
  updated_at?: string
}

interface ReconcileFinding {
  id?: string
  asset_id?: string
  asset_name?: string
  policy_id?: string
  policy_name?: string
  detail?: string
  age_days?: number
  current_tier?: string
  monthly_savings?: number
  [k: string]: unknown
}

interface Reconcile {
  violations: ReconcileFinding[]
  gaps: ReconcileFinding[]
  coverage_pct: number
  recoverable_monthly: number
}

const SCOPE_TYPES = ['workspace', 'account', 'provider', 'tier', 'asset_type', 'tag']
const TIERS = ['standard', 'infrequent', 'archive', 'deep_archive', 'cold']

const EMPTY_FORM = {
  name: '',
  scope_type: 'workspace',
  scope_value: '',
  max_age_days: '',
  transition_after_days: '',
  transition_to_tier: '',
  delete_after_days: '',
  enabled: true,
}
type FormState = typeof EMPTY_FORM

function money(n: number | null | undefined): string {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function RetentionPage() {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([])
  const [reconcile, setReconcile] = useState<Reconcile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [enabledFilter, setEnabledFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RetentionPolicy | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [pol, rec] = await Promise.all([
        api.getRetentionPolicies(),
        api.getRetentionReconcile(),
      ])
      setPolicies(Array.isArray(pol) ? pol : [])
      setReconcile(rec || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load retention data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    return policies.filter((p) => {
      if (search && !`${p.name} ${p.scope_value || ''}`.toLowerCase().includes(search.toLowerCase())) return false
      if (scopeFilter !== 'all' && p.scope_type !== scopeFilter) return false
      if (enabledFilter === 'enabled' && !p.enabled) return false
      if (enabledFilter === 'disabled' && p.enabled) return false
      return true
    })
  }, [policies, search, scopeFilter, enabledFilter])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(p: RetentionPolicy) {
    setEditing(p)
    setForm({
      name: p.name,
      scope_type: p.scope_type,
      scope_value: p.scope_value || '',
      max_age_days: p.max_age_days != null ? String(p.max_age_days) : '',
      transition_after_days: p.transition_after_days != null ? String(p.transition_after_days) : '',
      transition_to_tier: p.transition_to_tier || '',
      delete_after_days: p.delete_after_days != null ? String(p.delete_after_days) : '',
      enabled: p.enabled,
    })
    setFormError(null)
    setModalOpen(true)
  }

  function numOrNull(v: string): number | null {
    if (v.trim() === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  async function submit() {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    const body = {
      name: form.name.trim(),
      scope_type: form.scope_type,
      scope_value: form.scope_value.trim() || null,
      max_age_days: numOrNull(form.max_age_days),
      transition_after_days: numOrNull(form.transition_after_days),
      transition_to_tier: form.transition_to_tier || null,
      delete_after_days: numOrNull(form.delete_after_days),
      enabled: form.enabled,
    }
    try {
      if (editing) {
        await api.updateRetentionPolicy(editing.id, body)
      } else {
        await api.createRetentionPolicy(body)
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(p: RetentionPolicy) {
    setBusyId(p.id)
    try {
      await api.updateRetentionPolicy(p.id, { ...p, enabled: !p.enabled })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(p: RetentionPolicy) {
    if (!confirm(`Delete retention policy "${p.name}"?`)) return
    setBusyId(p.id)
    try {
      await api.deleteRetentionPolicy(p.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  const coverage = reconcile?.coverage_pct ?? 0
  const violations = reconcile?.violations ?? []
  const gaps = reconcile?.gaps ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Retention &amp; Reconciliation</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Define lifecycle retention policies and reconcile them against your storage estate to surface over-retained data and coverage gaps.
          </p>
        </div>
        <Button onClick={openCreate}>+ New Policy</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-24">
          <Spinner label="Loading retention data…" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Policies" value={policies.length} hint={`${policies.filter((p) => p.enabled).length} enabled`} />
            <Stat
              label="Policy Coverage"
              value={`${coverage.toFixed(1)}%`}
              tone={coverage >= 80 ? 'green' : coverage >= 50 ? 'amber' : 'rose'}
              hint="Assets governed by a policy"
            />
            <Stat label="Over-Retention Violations" value={violations.length} tone={violations.length ? 'amber' : 'default'} hint="Assets past retention limits" />
            <Stat
              label="Recoverable / mo"
              value={money(reconcile?.recoverable_monthly)}
              tone="cyan"
              hint="From retention cleanup"
            />
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">Coverage</h2>
                <span className="text-xs text-zinc-500">{coverage.toFixed(1)}% of assets governed</span>
              </div>
            </CardHeader>
            <CardBody>
              <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-lime-500 to-emerald-400 transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, coverage))}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-6 text-xs text-zinc-500">
                <span><span className="font-semibold text-zinc-300">{violations.length}</span> over-retention violations</span>
                <span><span className="font-semibold text-zinc-300">{gaps.length}</span> policy gaps</span>
                <span><span className="font-semibold text-emerald-300">{money(reconcile?.recoverable_monthly)}</span> recoverable / mo</span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="mr-auto text-sm font-semibold text-zinc-200">Retention Policies</h2>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search policies…"
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
                />
                <select
                  value={scopeFilter}
                  onChange={(e) => setScopeFilter(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
                >
                  <option value="all">All scopes</option>
                  {SCOPE_TYPES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select
                  value={enabledFilter}
                  onChange={(e) => setEnabledFilter(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
                >
                  <option value="all">All status</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title={policies.length === 0 ? 'No retention policies yet' : 'No policies match your filters'}
                    description={policies.length === 0 ? 'Create a policy to start governing how long data is retained and when it transitions to colder tiers.' : 'Try clearing search or filters.'}
                    action={policies.length === 0 ? <Button onClick={openCreate}>+ New Policy</Button> : undefined}
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Scope</TH>
                      <TH className="text-right">Max Age</TH>
                      <TH className="text-right">Transition</TH>
                      <TH className="text-right">Delete After</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((p) => (
                      <TR key={p.id}>
                        <TD className="font-medium text-zinc-100">{p.name}</TD>
                        <TD>
                          <Badge tone="slate">{p.scope_type}</Badge>
                          {p.scope_value && <span className="ml-2 text-xs text-zinc-500">{p.scope_value}</span>}
                        </TD>
                        <TD className="text-right tabular-nums">{p.max_age_days != null ? `${p.max_age_days}d` : '—'}</TD>
                        <TD className="text-right tabular-nums">
                          {p.transition_after_days != null ? (
                            <span>{p.transition_after_days}d{p.transition_to_tier ? ` → ${p.transition_to_tier}` : ''}</span>
                          ) : '—'}
                        </TD>
                        <TD className="text-right tabular-nums">{p.delete_after_days != null ? `${p.delete_after_days}d` : '—'}</TD>
                        <TD>
                          <button
                            onClick={() => toggleEnabled(p)}
                            disabled={busyId === p.id}
                            className="disabled:opacity-50"
                            title="Toggle enabled"
                          >
                            <Badge tone={p.enabled ? 'green' : 'slate'}>{p.enabled ? 'Enabled' : 'Disabled'}</Badge>
                          </button>
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" className="px-2 py-1" onClick={() => openEdit(p)}>Edit</Button>
                            <Button variant="ghost" className="px-2 py-1 text-rose-400 hover:text-rose-300" disabled={busyId === p.id} onClick={() => remove(p)}>Delete</Button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-200">Over-Retention Violations</h2>
                  <Badge tone={violations.length ? 'amber' : 'slate'}>{violations.length}</Badge>
                </div>
              </CardHeader>
              <CardBody className="p-0">
                {violations.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="No violations" description="No assets exceed their retention limits." />
                  </div>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Asset</TH>
                        <TH>Policy</TH>
                        <TH className="text-right">Age</TH>
                        <TH className="text-right">Savings / mo</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {violations.map((v, i) => (
                        <TR key={v.id || v.asset_id || i}>
                          <TD className="font-medium text-zinc-200">{v.asset_name || v.asset_id || 'Asset'}</TD>
                          <TD className="text-zinc-400">{v.policy_name || '—'}</TD>
                          <TD className="text-right tabular-nums">{v.age_days != null ? `${v.age_days}d` : '—'}</TD>
                          <TD className="text-right tabular-nums text-emerald-300">{money(v.monthly_savings)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-200">Policy Gaps</h2>
                  <Badge tone={gaps.length ? 'amber' : 'slate'}>{gaps.length}</Badge>
                </div>
              </CardHeader>
              <CardBody className="p-0">
                {gaps.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="No gaps" description="All assets are covered by a retention policy." />
                  </div>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Asset</TH>
                        <TH>Tier</TH>
                        <TH>Detail</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {gaps.map((g, i) => (
                        <TR key={g.id || g.asset_id || i}>
                          <TD className="font-medium text-zinc-200">{g.asset_name || g.asset_id || 'Asset'}</TD>
                          <TD>{g.current_tier ? <Badge tone="slate">{g.current_tier}</Badge> : '—'}</TD>
                          <TD className="text-zinc-400">{g.detail || 'No governing policy'}</TD>
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

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? 'Edit Retention Policy' : 'New Retention Policy'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Policy'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</div>
          )}
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. 90-day cold archive"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Scope Type">
              <select
                value={form.scope_type}
                onChange={(e) => setForm({ ...form, scope_type: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              >
                {SCOPE_TYPES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Scope Value" hint="optional">
              <input
                value={form.scope_value}
                onChange={(e) => setForm({ ...form, scope_value: e.target.value })}
                placeholder={form.scope_type === 'workspace' ? '(all)' : 'value'}
                disabled={form.scope_type === 'workspace'}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none disabled:opacity-50"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Max Age (days)" hint="delete/flag past this">
              <input
                type="number"
                min={0}
                value={form.max_age_days}
                onChange={(e) => setForm({ ...form, max_age_days: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              />
            </Field>
            <Field label="Delete After (days)" hint="optional">
              <input
                type="number"
                min={0}
                value={form.delete_after_days}
                onChange={(e) => setForm({ ...form, delete_after_days: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Transition After (days)" hint="optional">
              <input
                type="number"
                min={0}
                value={form.transition_after_days}
                onChange={(e) => setForm({ ...form, transition_after_days: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              />
            </Field>
            <Field label="Transition To Tier" hint="optional">
              <select
                value={form.transition_to_tier}
                onChange={(e) => setForm({ ...form, transition_to_tier: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              >
                <option value="">—</option>
                {TIERS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-lime-500"
            />
            Enabled
          </label>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-zinc-500">
        <span>{label}</span>
        {hint && <span className="font-normal normal-case text-zinc-600">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
