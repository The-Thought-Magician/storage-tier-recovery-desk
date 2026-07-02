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

interface Account {
  id: string
  name: string
  provider?: string
}

interface LifecycleRule {
  match_tier?: string
  match_temperature?: string
  older_than_days?: number
  action?: string
  target_tier?: string
  [k: string]: unknown
}

interface LifecycleModel {
  id: string
  account_id: string | null
  name: string
  rules: LifecycleRule[]
  simulated_monthly_savings: number | null
  simulated_assets_affected: number | null
  simulated_data_moved_gb: number | null
  last_simulated_at: string | null
  created_at?: string
}

interface SimResult {
  model?: LifecycleModel
  simulated_monthly_savings: number
  simulated_assets_affected: number
  simulated_data_moved_gb: number
}

const TIERS = ['standard', 'infrequent', 'archive', 'deep_archive', 'cold']
const TEMPS = ['hot', 'warm', 'cool', 'cold', 'frozen']
const ACTIONS = ['transition', 'delete', 'flag']

function money(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function num(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })
}

const EMPTY_RULE: LifecycleRule = { match_tier: '', match_temperature: '', older_than_days: 30, action: 'transition', target_tier: 'archive' }

export default function LifecyclePage() {
  const [models, setModels] = useState<LifecycleModel[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [accountId, setAccountId] = useState('')
  const [rules, setRules] = useState<LifecycleRule[]>([{ ...EMPTY_RULE }])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [simBusyId, setSimBusyId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [mdl, acc] = await Promise.all([api.getLifecycleModels(), api.getAccounts()])
      const list: LifecycleModel[] = (Array.isArray(mdl) ? mdl : []).map((m: LifecycleModel) => ({
        ...m,
        rules: Array.isArray(m.rules) ? m.rules : [],
      }))
      setModels(list)
      setAccounts(Array.isArray(acc) ? acc : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load lifecycle models')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name || (id ? 'Unknown' : 'All accounts')

  function openCreate() {
    setName('')
    setAccountId('')
    setRules([{ ...EMPTY_RULE }])
    setFormError(null)
    setModalOpen(true)
  }

  function updateRule(i: number, patch: Partial<LifecycleRule>) {
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRule() {
    setRules((rs) => [...rs, { ...EMPTY_RULE }])
  }
  function removeRule(i: number) {
    setRules((rs) => rs.filter((_, idx) => idx !== i))
  }

  async function submit() {
    if (!name.trim()) {
      setFormError('Name is required')
      return
    }
    if (rules.length === 0) {
      setFormError('Add at least one rule')
      return
    }
    setSaving(true)
    setFormError(null)
    const cleanRules = rules.map((r) => ({
      match_tier: r.match_tier || null,
      match_temperature: r.match_temperature || null,
      older_than_days: r.older_than_days != null && r.older_than_days !== ('' as unknown) ? Number(r.older_than_days) : null,
      action: r.action || 'transition',
      target_tier: r.action === 'delete' ? null : r.target_tier || null,
    }))
    try {
      await api.createLifecycleModel({
        name: name.trim(),
        account_id: accountId || null,
        rules: cleanRules,
      })
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  async function simulate(m: LifecycleModel) {
    setSimBusyId(m.id)
    setError(null)
    try {
      const res: SimResult = await api.simulateLifecycleModel(m.id)
      setModels((prev) =>
        prev.map((x) =>
          x.id === m.id
            ? {
                ...x,
                simulated_monthly_savings: res.simulated_monthly_savings,
                simulated_assets_affected: res.simulated_assets_affected,
                simulated_data_moved_gb: res.simulated_data_moved_gb,
                last_simulated_at: new Date().toISOString(),
              }
            : x,
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed')
    } finally {
      setSimBusyId(null)
    }
  }

  async function remove(m: LifecycleModel) {
    if (!confirm(`Delete lifecycle model "${m.name}"?`)) return
    setBusyId(m.id)
    try {
      await api.deleteLifecycleModel(m.id)
      setSelected((s) => s.filter((id) => id !== m.id))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  function toggleSelect(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 3 ? [...s.slice(1), id] : [...s, id]))
  }

  const compareModels = useMemo(() => models.filter((m) => selected.includes(m.id)), [models, selected])
  const maxSavings = useMemo(
    () => Math.max(1, ...compareModels.map((m) => Number(m.simulated_monthly_savings || 0))),
    [compareModels],
  )

  const totalSimSavings = models.reduce((s, m) => s + Number(m.simulated_monthly_savings || 0), 0)
  const simulatedCount = models.filter((m) => m.last_simulated_at).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Lifecycle Modeler</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Build tiering rule sets, simulate them against your inventory, and compare projected savings before committing to a recovery action.
          </p>
        </div>
        <Button onClick={openCreate}>+ New Model</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {loading ? (
        <div className="py-24">
          <Spinner label="Loading lifecycle models…" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Models" value={models.length} hint={`${simulatedCount} simulated`} />
            <Stat label="Total Simulated Savings / mo" value={money(totalSimSavings)} tone="cyan" hint="Across all models" />
            <Stat label="Selected to Compare" value={`${compareModels.length} / 3`} hint="Pick up to 3 models" />
          </div>

          {compareModels.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-zinc-200">Comparison</h2>
              </CardHeader>
              <CardBody>
                <div className="space-y-4">
                  {compareModels.map((m) => {
                    const sav = Number(m.simulated_monthly_savings || 0)
                    return (
                      <div key={m.id}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="font-medium text-zinc-200">{m.name}</span>
                          <span className="tabular-nums text-emerald-300">{money(sav)}/mo</span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-lime-500 to-emerald-400"
                            style={{ width: `${(sav / maxSavings) * 100}%` }}
                          />
                        </div>
                        <div className="mt-1 flex gap-4 text-xs text-zinc-500">
                          <span>{num(m.simulated_assets_affected)} assets</span>
                          <span>{num(m.simulated_data_moved_gb)} GB moved</span>
                          {!m.last_simulated_at && <span className="text-amber-400">not yet simulated</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardBody>
            </Card>
          )}

          {models.length === 0 ? (
            <EmptyState
              title="No lifecycle models yet"
              description="Create a model with tiering rules, then simulate it to see how much you could save by moving cold data to colder tiers."
              action={<Button onClick={openCreate}>+ New Model</Button>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {models.map((m) => {
                const isSel = selected.includes(m.id)
                return (
                  <Card key={m.id} className={isSel ? 'ring-1 ring-lime-500/50' : ''}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-zinc-100">{m.name}</h3>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                            <Badge tone="slate">{accountName(m.account_id)}</Badge>
                            <span>{m.rules.length} rule{m.rules.length === 1 ? '' : 's'}</span>
                            {m.last_simulated_at ? (
                              <span>simulated {new Date(m.last_simulated_at).toLocaleDateString()}</span>
                            ) : (
                              <span className="text-amber-400">not simulated</span>
                            )}
                          </div>
                        </div>
                        <label className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-400">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggleSelect(m.id)}
                            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-lime-500"
                          />
                          Compare
                        </label>
                      </div>
                    </CardHeader>
                    <CardBody className="space-y-4">
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="rounded-lg bg-zinc-950 px-2 py-2">
                          <div className="text-xs text-zinc-500">Savings/mo</div>
                          <div className="text-sm font-semibold tabular-nums text-emerald-300">{money(m.simulated_monthly_savings)}</div>
                        </div>
                        <div className="rounded-lg bg-zinc-950 px-2 py-2">
                          <div className="text-xs text-zinc-500">Assets</div>
                          <div className="text-sm font-semibold tabular-nums text-zinc-200">{num(m.simulated_assets_affected)}</div>
                        </div>
                        <div className="rounded-lg bg-zinc-950 px-2 py-2">
                          <div className="text-xs text-zinc-500">Data Moved</div>
                          <div className="text-sm font-semibold tabular-nums text-zinc-200">{num(m.simulated_data_moved_gb)} GB</div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/50">
                        <Table>
                          <THead>
                            <TR>
                              <TH>If</TH>
                              <TH>Older Than</TH>
                              <TH>Then</TH>
                            </TR>
                          </THead>
                          <TBody>
                            {m.rules.map((r, i) => (
                              <TR key={i}>
                                <TD className="text-xs">
                                  {[r.match_tier && `tier=${r.match_tier}`, r.match_temperature && `temp=${r.match_temperature}`]
                                    .filter(Boolean)
                                    .join(', ') || 'any'}
                                </TD>
                                <TD className="text-xs tabular-nums">{r.older_than_days != null ? `${r.older_than_days}d` : '—'}</TD>
                                <TD className="text-xs">
                                  <Badge tone={r.action === 'delete' ? 'rose' : r.action === 'flag' ? 'amber' : 'cyan'}>
                                    {r.action || 'transition'}{r.target_tier ? ` → ${r.target_tier}` : ''}
                                  </Badge>
                                </TD>
                              </TR>
                            ))}
                          </TBody>
                        </Table>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button onClick={() => simulate(m)} disabled={simBusyId === m.id}>
                          {simBusyId === m.id ? 'Simulating…' : 'Simulate'}
                        </Button>
                        <Button variant="danger" disabled={busyId === m.id} onClick={() => remove(m)}>
                          Delete
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title="New Lifecycle Model"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create Model'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{formError}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Archive cold buckets"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Account</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Rules</label>
              <Button variant="ghost" className="px-2 py-1" onClick={addRule}>+ Add rule</Button>
            </div>
            <div className="space-y-3">
              {rules.map((r, i) => (
                <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-400">Rule {i + 1}</span>
                    {rules.length > 1 && (
                      <button onClick={() => removeRule(i)} className="text-xs text-rose-400 hover:text-rose-300">Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <Select label="Match Tier" value={r.match_tier || ''} onChange={(v) => updateRule(i, { match_tier: v })} options={['', ...TIERS]} />
                    <Select label="Match Temp" value={r.match_temperature || ''} onChange={(v) => updateRule(i, { match_temperature: v })} options={['', ...TEMPS]} />
                    <div>
                      <label className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-600">Older Than (d)</label>
                      <input
                        type="number"
                        min={0}
                        value={r.older_than_days ?? ''}
                        onChange={(e) => updateRule(i, { older_than_days: e.target.value === '' ? undefined : Number(e.target.value) })}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
                      />
                    </div>
                    <Select label="Action" value={r.action || 'transition'} onChange={(v) => updateRule(i, { action: v })} options={ACTIONS} />
                    <Select
                      label="Target Tier"
                      value={r.target_tier || ''}
                      onChange={(v) => updateRule(i, { target_tier: v })}
                      options={['', ...TIERS]}
                      disabled={r.action === 'delete'}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  disabled?: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-600">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o === '' ? 'any' : o}</option>
        ))}
      </select>
    </div>
  )
}
