'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Stat } from '@/components/ui/Stat'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Account {
  id: string
  name?: string
  provider?: string
  account_ref?: string
  default_region?: string
  currency?: string
  connection_method?: string
  environment?: string
  team?: string
  cost_center?: string
  status?: string
  last_ingest_at?: string | null
  created_at?: string
}

interface ProviderRollup {
  provider?: string
  spend?: number
  recoverable?: number
  account_count?: number
}

interface Rollup {
  total_spend?: number
  total_recoverable?: number
  account_count?: number
  by_provider?: ProviderRollup[]
}

const PROVIDERS = ['aws', 'gcp', 'azure', 'oci', 'other']
const ENVIRONMENTS = ['production', 'staging', 'development', 'sandbox']
const CONNECTION_METHODS = ['read_only_role', 'access_key', 'service_account', 'manual']
const STATUSES = ['active', 'paused', 'disconnected']

const fmtMoney = (n: number | undefined | null, digits = 0) =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits })

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

const providerTone = (p?: string): 'amber' | 'blue' | 'cyan' | 'violet' | 'slate' => {
  switch ((p || '').toLowerCase()) {
    case 'aws':
      return 'amber'
    case 'azure':
      return 'blue'
    case 'gcp':
      return 'cyan'
    case 'oci':
      return 'violet'
    default:
      return 'slate'
  }
}

const statusTone = (s?: string): 'green' | 'amber' | 'rose' | 'slate' => {
  switch ((s || '').toLowerCase()) {
    case 'active':
      return 'green'
    case 'paused':
      return 'amber'
    case 'disconnected':
      return 'rose'
    default:
      return 'slate'
  }
}

type FormState = {
  name: string
  provider: string
  account_ref: string
  default_region: string
  currency: string
  connection_method: string
  environment: string
  team: string
  cost_center: string
  status: string
}

const emptyForm: FormState = {
  name: '',
  provider: 'aws',
  account_ref: '',
  default_region: 'us-east-1',
  currency: 'USD',
  connection_method: 'read_only_role',
  environment: 'production',
  team: '',
  cost_center: '',
  status: 'active',
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [rollup, setRollup] = useState<Rollup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<Account | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [a, r] = await Promise.all([api.getAccounts(), api.getAccountsRollup()])
      setAccounts(Array.isArray(a) ? a : [])
      setRollup(r || {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accounts.filter((a) => {
      if (providerFilter && (a.provider || '').toLowerCase() !== providerFilter) return false
      if (statusFilter && (a.status || '').toLowerCase() !== statusFilter) return false
      if (q) {
        const hay = `${a.name} ${a.account_ref} ${a.team} ${a.cost_center} ${a.environment} ${a.default_region}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [accounts, search, providerFilter, statusFilter])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (a: Account) => {
    setEditing(a)
    setForm({
      name: a.name || '',
      provider: a.provider || 'aws',
      account_ref: a.account_ref || '',
      default_region: a.default_region || '',
      currency: a.currency || 'USD',
      connection_method: a.connection_method || 'read_only_role',
      environment: a.environment || 'production',
      team: a.team || '',
      cost_center: a.cost_center || '',
      status: a.status || 'active',
    })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async () => {
    if (!form.name.trim()) {
      setFormError('Account name is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        account_ref: form.account_ref.trim(),
        team: form.team.trim() || null,
        cost_center: form.cost_center.trim() || null,
      }
      if (editing) {
        await api.updateAccount(editing.id, payload)
      } else {
        await api.createAccount(payload)
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save account')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteAccount(deleting.id)
      setDeleting(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete account')
      setDeleting(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }))

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading accounts..." />
      </div>
    )
  }

  if (error && accounts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-500/30">
          <CardBody>
            <h2 className="text-base font-semibold text-rose-300">Could not load accounts</h2>
            <p className="mt-1 text-sm text-slate-400">{error}</p>
            <Button className="mt-4" variant="secondary" onClick={load}>
              Retry
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  const byProvider = rollup?.by_provider || []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Cloud Accounts</h1>
          <p className="mt-1 text-sm text-slate-500">
            Registry of connected cloud accounts and their spend / recoverable rollup.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load}>
            Refresh
          </Button>
          <Button onClick={openCreate}>+ New account</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-2 text-sm text-rose-300">{error}</div>
      )}

      {/* Rollup */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total Monthly Spend" value={fmtMoney(rollup?.total_spend)} />
        <Stat label="Total Recoverable / mo" value={fmtMoney(rollup?.total_recoverable)} tone="cyan" />
        <Stat label="Accounts" value={Number(rollup?.account_count ?? accounts.length).toLocaleString()} />
      </div>

      {byProvider.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">By provider</h2>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {byProvider.map((p) => {
                const total = Number(rollup?.total_spend ?? 0)
                const pct = total > 0 ? (Number(p.spend ?? 0) / total) * 100 : 0
                return (
                  <div key={p.provider} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                    <div className="flex items-center justify-between">
                      <Badge tone={providerTone(p.provider)}>{(p.provider || 'other').toUpperCase()}</Badge>
                      <span className="text-xs text-slate-500">{p.account_count ?? 0} acct</span>
                    </div>
                    <div className="mt-2 text-lg font-semibold tabular-nums text-slate-100">{fmtMoney(p.spend)}</div>
                    <div className="text-xs text-cyan-300">{fmtMoney(p.recoverable)} recoverable</div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-cyan-500/70" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, ref, team, cost center..."
          className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
        />
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
        >
          <option value="">All providers</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <Card>
        <CardBody className="p-0">
          {accounts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No cloud accounts yet"
                description="Add your first account to start ingesting storage inventory and finding recoverable savings."
                icon={<span>☁</span>}
                action={<Button onClick={openCreate}>+ New account</Button>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">No accounts match your filters.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Provider</TH>
                  <TH>Account Ref</TH>
                  <TH>Environment</TH>
                  <TH>Team</TH>
                  <TH>Region</TH>
                  <TH>Status</TH>
                  <TH>Last Ingest</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      <div className="font-medium text-slate-200">{a.name || 'Unnamed'}</div>
                      {a.cost_center && <div className="text-xs text-slate-500">{a.cost_center}</div>}
                    </TD>
                    <TD>
                      <Badge tone={providerTone(a.provider)}>{(a.provider || 'other').toUpperCase()}</Badge>
                    </TD>
                    <TD className="font-mono text-xs text-slate-400">{a.account_ref || '—'}</TD>
                    <TD className="capitalize">{a.environment || '—'}</TD>
                    <TD>{a.team || '—'}</TD>
                    <TD className="text-slate-400">{a.default_region || '—'}</TD>
                    <TD>
                      <Badge tone={statusTone(a.status)}>{a.status || 'unknown'}</Badge>
                    </TD>
                    <TD className="text-xs text-slate-500">{fmtDate(a.last_ingest_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openEdit(a)}>
                          Edit
                        </Button>
                        <Button variant="ghost" className="px-2 py-1 text-xs text-rose-300 hover:text-rose-200" onClick={() => setDeleting(a)}>
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

      {/* Create / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit account' : 'New cloud account'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create account'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-300">{formError}</div>
          )}
          <Field label="Name">
            <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Prod AWS — Platform" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <select className={inputCls} value={form.provider} onChange={(e) => set('provider', e.target.value)}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Account Ref">
              <input className={inputCls} value={form.account_ref} onChange={(e) => set('account_ref', e.target.value)} placeholder="123456789012" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default Region">
              <input className={inputCls} value={form.default_region} onChange={(e) => set('default_region', e.target.value)} placeholder="us-east-1" />
            </Field>
            <Field label="Currency">
              <input className={inputCls} value={form.currency} onChange={(e) => set('currency', e.target.value)} placeholder="USD" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Connection Method">
              <select className={inputCls} value={form.connection_method} onChange={(e) => set('connection_method', e.target.value)}>
                {CONNECTION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Environment">
              <select className={inputCls} value={form.environment} onChange={(e) => set('environment', e.target.value)}>
                {ENVIRONMENTS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Team">
              <input className={inputCls} value={form.team} onChange={(e) => set('team', e.target.value)} placeholder="Platform" />
            </Field>
            <Field label="Cost Center">
              <input className={inputCls} value={form.cost_center} onChange={(e) => set('cost_center', e.target.value)} placeholder="CC-1042" />
            </Field>
          </div>
          {editing && (
            <Field label="Status">
              <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete account"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete <span className="font-semibold text-slate-100">{deleting?.name}</span>? This removes the account and its
          associated inventory. This action cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}
