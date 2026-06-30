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

interface WorkspaceSettings {
  id?: string
  default_currency: string
  fiscal_quarter_start: number
  weight_savings: number
  weight_effort: number
  weight_risk: number
  created_at?: string
  updated_at?: string
}

interface SavedView {
  id: string
  name: string
  scope: string
  filters: Record<string, unknown> | null
  is_default: boolean
  created_at?: string
}

interface Notification {
  id: string
  title: string
  body: string | null
  kind: string | null
  link: string | null
  read: boolean
  created_at?: string
}

interface Plan {
  id: string
  name: string
  price_cents: number
}

interface Subscription {
  id?: string
  user_id?: string
  plan_id: string
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  status?: string | null
  current_period_end?: string | null
}

interface BillingPlan {
  subscription: Subscription | null
  plan: Plan | null
  stripeEnabled: boolean
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR']
const VIEW_SCOPES = ['inventory', 'worksheet', 'mistier', 'snapshots', 'orphans', 'allocation', 'findings']

const EMPTY_SETTINGS: WorkspaceSettings = {
  default_currency: 'USD',
  fiscal_quarter_start: 1,
  weight_savings: 0.5,
  weight_effort: 0.25,
  weight_risk: 0.25,
}

const EMPTY_VIEW = {
  name: '',
  scope: 'inventory',
  filters: '{}',
  is_default: false,
}
type ViewForm = typeof EMPTY_VIEW

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function money(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function kindTone(kind: string | null): 'cyan' | 'amber' | 'rose' | 'green' | 'slate' {
  switch ((kind || '').toLowerCase()) {
    case 'alert':
    case 'error':
      return 'rose'
    case 'warning':
      return 'amber'
    case 'success':
      return 'green'
    case 'info':
      return 'cyan'
    default:
      return 'slate'
  }
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<WorkspaceSettings>(EMPTY_SETTINGS)
  const [views, setViews] = useState<SavedView[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [billing, setBilling] = useState<BillingPlan | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // settings form
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  // views modal
  const [viewModalOpen, setViewModalOpen] = useState(false)
  const [viewForm, setViewForm] = useState<ViewForm>(EMPTY_VIEW)
  const [savingView, setSavingView] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)
  const [busyViewId, setBusyViewId] = useState<string | null>(null)

  // notifications
  const [notifFilter, setNotifFilter] = useState<'all' | 'unread'>('all')
  const [busyNotif, setBusyNotif] = useState(false)

  // billing
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingMsg, setBillingMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [s, v, n, b] = await Promise.all([
        api.getSettings(),
        api.getViews(),
        api.getNotifications(),
        api.getBillingPlan(),
      ])
      if (s) {
        setSettings({
          default_currency: s.default_currency ?? 'USD',
          fiscal_quarter_start: Number(s.fiscal_quarter_start ?? 1),
          weight_savings: Number(s.weight_savings ?? 0.5),
          weight_effort: Number(s.weight_effort ?? 0.25),
          weight_risk: Number(s.weight_risk ?? 0.25),
          id: s.id,
          created_at: s.created_at,
          updated_at: s.updated_at,
        })
      }
      setViews(Array.isArray(v) ? v : [])
      setNotifications(Array.isArray(n) ? n : [])
      setBilling(b || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const weightTotal = settings.weight_savings + settings.weight_effort + settings.weight_risk
  const normalized = useMemo(() => {
    const t = weightTotal || 1
    return {
      savings: settings.weight_savings / t,
      effort: settings.weight_effort / t,
      risk: settings.weight_risk / t,
    }
  }, [settings.weight_savings, settings.weight_effort, settings.weight_risk, weightTotal])

  const unreadCount = notifications.filter((n) => !n.read).length

  const filteredNotifs = useMemo(() => {
    if (notifFilter === 'unread') return notifications.filter((n) => !n.read)
    return notifications
  }, [notifications, notifFilter])

  async function saveSettings() {
    setSavingSettings(true)
    setSettingsMsg(null)
    setSettingsError(null)
    try {
      const body = {
        default_currency: settings.default_currency,
        fiscal_quarter_start: settings.fiscal_quarter_start,
        weight_savings: settings.weight_savings,
        weight_effort: settings.weight_effort,
        weight_risk: settings.weight_risk,
      }
      const updated = await api.updateSettings(body)
      if (updated) {
        setSettings((prev) => ({
          ...prev,
          default_currency: updated.default_currency ?? prev.default_currency,
          fiscal_quarter_start: Number(updated.fiscal_quarter_start ?? prev.fiscal_quarter_start),
          weight_savings: Number(updated.weight_savings ?? prev.weight_savings),
          weight_effort: Number(updated.weight_effort ?? prev.weight_effort),
          weight_risk: Number(updated.weight_risk ?? prev.weight_risk),
          updated_at: updated.updated_at ?? prev.updated_at,
        }))
      }
      setSettingsMsg('Settings saved')
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSavingSettings(false)
    }
  }

  function setWeight(key: 'weight_savings' | 'weight_effort' | 'weight_risk', value: number) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSettingsMsg(null)
  }

  function openCreateView() {
    setViewForm(EMPTY_VIEW)
    setViewError(null)
    setViewModalOpen(true)
  }

  async function submitView() {
    if (!viewForm.name.trim()) {
      setViewError('Name is required')
      return
    }
    let filters: unknown = {}
    if (viewForm.filters.trim()) {
      try {
        filters = JSON.parse(viewForm.filters)
      } catch {
        setViewError('Filters must be valid JSON')
        return
      }
    }
    setSavingView(true)
    setViewError(null)
    try {
      await api.createView({
        name: viewForm.name.trim(),
        scope: viewForm.scope,
        filters,
        is_default: viewForm.is_default,
      })
      setViewModalOpen(false)
      await load()
    } catch (e) {
      setViewError(e instanceof Error ? e.message : 'Failed to save view')
    } finally {
      setSavingView(false)
    }
  }

  async function removeView(v: SavedView) {
    if (!confirm(`Delete saved view "${v.name}"?`)) return
    setBusyViewId(v.id)
    try {
      await api.deleteView(v.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete view')
    } finally {
      setBusyViewId(null)
    }
  }

  async function readNotif(n: Notification) {
    if (n.read) return
    setBusyNotif(true)
    try {
      await api.markNotificationRead(n.id)
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark read')
    } finally {
      setBusyNotif(false)
    }
  }

  async function readAll() {
    if (unreadCount === 0) return
    setBusyNotif(true)
    try {
      await api.markAllNotificationsRead()
      setNotifications((prev) => prev.map((x) => ({ ...x, read: true })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all read')
    } finally {
      setBusyNotif(false)
    }
  }

  async function startCheckout() {
    setBillingBusy(true)
    setBillingMsg(null)
    try {
      const res = await api.createCheckout({ plan_id: 'pro' })
      if (res && res.url) {
        window.location.href = res.url
      } else {
        setBillingMsg('Checkout session created but no redirect URL was returned.')
      }
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Failed to start checkout')
    } finally {
      setBillingBusy(false)
    }
  }

  async function openPortal() {
    setBillingBusy(true)
    setBillingMsg(null)
    try {
      const res = await api.createPortal()
      if (res && res.url) {
        window.location.href = res.url
      } else {
        setBillingMsg('Portal session created but no redirect URL was returned.')
      }
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Failed to open billing portal')
    } finally {
      setBillingBusy(false)
    }
  }

  const currentPlanId = billing?.subscription?.plan_id || billing?.plan?.id || 'free'
  const isPro = currentPlanId === 'pro'
  const stripeEnabled = !!billing?.stripeEnabled

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Workspace preferences, recovery scoring weights, saved views, notifications, and billing.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-24">
          <Spinner label="Loading settings…" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Currency" value={settings.default_currency} hint="Workspace default" />
            <Stat label="Saved Views" value={views.length} hint={`${views.filter((v) => v.is_default).length} default`} />
            <Stat
              label="Unread Notifications"
              value={unreadCount}
              tone={unreadCount ? 'amber' : 'default'}
              hint={`${notifications.length} total`}
            />
            <Stat
              label="Plan"
              value={isPro ? 'Pro' : 'Free'}
              tone={isPro ? 'cyan' : 'default'}
              hint={stripeEnabled ? 'Billing enabled' : 'Billing not configured'}
            />
          </div>

          {/* Workspace + scoring weights */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Workspace &amp; Scoring</h2>
                {settings.updated_at && (
                  <span className="text-xs text-slate-500">Updated {fmtDate(settings.updated_at)}</span>
                )}
              </div>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Default Currency">
                  <select
                    value={settings.default_currency}
                    onChange={(e) => {
                      setSettings({ ...settings, default_currency: e.target.value })
                      setSettingsMsg(null)
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Fiscal Quarter Start Month" hint="1 = January">
                  <select
                    value={settings.fiscal_quarter_start}
                    onChange={(e) => {
                      setSettings({ ...settings, fiscal_quarter_start: Number(e.target.value) })
                      setSettingsMsg(null)
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {new Date(2000, m - 1, 1).toLocaleString(undefined, { month: 'long' })}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Recovery Priority Weights</h3>
                  <span className="text-xs text-slate-500">
                    priority = savings × w<sub>s</sub> − effort × w<sub>e</sub> − risk × w<sub>r</sub>
                  </span>
                </div>
                <div className="space-y-4">
                  <WeightSlider
                    label="Savings"
                    tone="emerald"
                    value={settings.weight_savings}
                    normalized={normalized.savings}
                    onChange={(v) => setWeight('weight_savings', v)}
                  />
                  <WeightSlider
                    label="Effort"
                    tone="amber"
                    value={settings.weight_effort}
                    normalized={normalized.effort}
                    onChange={(v) => setWeight('weight_effort', v)}
                  />
                  <WeightSlider
                    label="Risk"
                    tone="rose"
                    value={settings.weight_risk}
                    normalized={normalized.risk}
                    onChange={(v) => setWeight('weight_risk', v)}
                  />
                </div>

                {/* normalized distribution bar */}
                <div className="mt-4">
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full bg-emerald-500" style={{ width: `${normalized.savings * 100}%` }} title={`Savings ${(normalized.savings * 100).toFixed(0)}%`} />
                    <div className="h-full bg-amber-500" style={{ width: `${normalized.effort * 100}%` }} title={`Effort ${(normalized.effort * 100).toFixed(0)}%`} />
                    <div className="h-full bg-rose-500" style={{ width: `${normalized.risk * 100}%` }} title={`Risk ${(normalized.risk * 100).toFixed(0)}%`} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Savings {(normalized.savings * 100).toFixed(0)}%</span>
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />Effort {(normalized.effort * 100).toFixed(0)}%</span>
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" />Risk {(normalized.risk * 100).toFixed(0)}%</span>
                    <span className="ml-auto">raw total {weightTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-3">
                <Button onClick={saveSettings} disabled={savingSettings}>
                  {savingSettings ? 'Saving…' : 'Save Settings'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={savingSettings}
                  onClick={() => {
                    setSettings((prev) => ({ ...prev, weight_savings: 0.5, weight_effort: 0.25, weight_risk: 0.25 }))
                    setSettingsMsg(null)
                  }}
                >
                  Reset Weights
                </Button>
                {settingsMsg && <span className="text-sm text-emerald-300">{settingsMsg}</span>}
                {settingsError && <span className="text-sm text-rose-300">{settingsError}</span>}
              </div>
            </CardBody>
          </Card>

          {/* Saved views */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Saved Views</h2>
                <Button variant="secondary" className="px-3 py-1.5" onClick={openCreateView}>+ New View</Button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {views.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No saved views"
                    description="Save table filters from any module to quickly recall them here."
                    action={<Button onClick={openCreateView}>+ New View</Button>}
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Scope</TH>
                      <TH>Filters</TH>
                      <TH>Default</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {views.map((v) => (
                      <TR key={v.id}>
                        <TD className="font-medium text-slate-100">{v.name}</TD>
                        <TD><Badge tone="cyan">{v.scope}</Badge></TD>
                        <TD className="max-w-xs">
                          <code className="block truncate text-xs text-slate-500">
                            {v.filters && Object.keys(v.filters).length ? JSON.stringify(v.filters) : '—'}
                          </code>
                        </TD>
                        <TD>{v.is_default ? <Badge tone="green">Default</Badge> : <span className="text-slate-600">—</span>}</TD>
                        <TD className="text-right">
                          <Button
                            variant="ghost"
                            className="px-2 py-1 text-rose-400 hover:text-rose-300"
                            disabled={busyViewId === v.id}
                            onClick={() => removeView(v)}
                          >
                            Delete
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* Notifications */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="mr-auto text-sm font-semibold text-slate-200">Notifications</h2>
                <div className="flex overflow-hidden rounded-lg border border-slate-700">
                  <button
                    onClick={() => setNotifFilter('all')}
                    className={`px-3 py-1.5 text-sm ${notifFilter === 'all' ? 'bg-cyan-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-slate-200'}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setNotifFilter('unread')}
                    className={`px-3 py-1.5 text-sm ${notifFilter === 'unread' ? 'bg-cyan-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-slate-200'}`}
                  >
                    Unread{unreadCount ? ` (${unreadCount})` : ''}
                  </button>
                </div>
                <Button
                  variant="secondary"
                  className="px-3 py-1.5"
                  disabled={busyNotif || unreadCount === 0}
                  onClick={readAll}
                >
                  Mark all read
                </Button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {filteredNotifs.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title={notifFilter === 'unread' ? 'No unread notifications' : 'No notifications'}
                    description={notifFilter === 'unread' ? 'You are all caught up.' : 'Alerts, analysis runs, and recovery updates will appear here.'}
                  />
                </div>
              ) : (
                <ul className="divide-y divide-slate-800/70">
                  {filteredNotifs.map((n) => (
                    <li
                      key={n.id}
                      className={`flex items-start gap-3 px-5 py-4 ${n.read ? '' : 'bg-cyan-500/5'}`}
                    >
                      <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${n.read ? 'bg-slate-700' : 'bg-cyan-400'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-100">{n.title}</span>
                          {n.kind && <Badge tone={kindTone(n.kind)}>{n.kind}</Badge>}
                          <span className="ml-auto text-xs text-slate-500">{fmtDate(n.created_at)}</span>
                        </div>
                        {n.body && <p className="mt-1 text-sm text-slate-400">{n.body}</p>}
                        <div className="mt-2 flex items-center gap-3">
                          {n.link && (
                            <a href={n.link} className="text-xs font-medium text-cyan-400 hover:text-cyan-300">
                              View →
                            </a>
                          )}
                          {!n.read && (
                            <button
                              onClick={() => readNotif(n)}
                              disabled={busyNotif}
                              className="text-xs font-medium text-slate-400 hover:text-slate-200 disabled:opacity-50"
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Billing */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Billing</h2>
            </CardHeader>
            <CardBody>
              {!stripeEnabled && (
                <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                  Stripe is not configured for this workspace. Billing actions are unavailable until a Stripe key is set.
                </div>
              )}
              {billingMsg && (
                <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                  {billingMsg}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className={`rounded-xl border p-5 ${!isPro ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-slate-800 bg-slate-950/40'}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-slate-100">Free</h3>
                    {!isPro && <Badge tone="cyan">Current</Badge>}
                  </div>
                  <p className="mt-1 text-2xl font-semibold text-slate-100">$0<span className="text-sm font-normal text-slate-500">/mo</span></p>
                  <ul className="mt-3 space-y-1 text-sm text-slate-400">
                    <li>Single cloud account</li>
                    <li>Core detectors</li>
                    <li>Manual analysis runs</li>
                  </ul>
                </div>

                <div className={`rounded-xl border p-5 ${isPro ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-slate-800 bg-slate-950/40'}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-slate-100">Pro</h3>
                    {isPro && <Badge tone="cyan">Current</Badge>}
                  </div>
                  <p className="mt-1 text-2xl font-semibold text-slate-100">
                    {billing?.plan && billing.plan.id === 'pro' ? money(billing.plan.price_cents) : '$49'}
                    <span className="text-sm font-normal text-slate-500">/mo</span>
                  </p>
                  <ul className="mt-3 space-y-1 text-sm text-slate-400">
                    <li>Unlimited accounts</li>
                    <li>Scheduled analysis &amp; alerts</li>
                    <li>Forecasting &amp; allocation</li>
                  </ul>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {isPro ? (
                  <Button onClick={openPortal} disabled={billingBusy || !stripeEnabled}>
                    {billingBusy ? 'Opening…' : 'Manage Subscription'}
                  </Button>
                ) : (
                  <Button onClick={startCheckout} disabled={billingBusy || !stripeEnabled}>
                    {billingBusy ? 'Redirecting…' : 'Upgrade to Pro'}
                  </Button>
                )}
                {billing?.subscription?.status && (
                  <Badge tone={billing.subscription.status === 'active' ? 'green' : 'amber'}>
                    {billing.subscription.status}
                  </Badge>
                )}
                {billing?.subscription?.current_period_end && (
                  <span className="text-xs text-slate-500">
                    Renews {fmtDate(billing.subscription.current_period_end)}
                  </span>
                )}
              </div>
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={viewModalOpen}
        onClose={() => !savingView && setViewModalOpen(false)}
        title="New Saved View"
        footer={
          <>
            <Button variant="secondary" onClick={() => setViewModalOpen(false)} disabled={savingView}>Cancel</Button>
            <Button onClick={submitView} disabled={savingView}>{savingView ? 'Saving…' : 'Create View'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {viewError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{viewError}</div>
          )}
          <Field label="Name">
            <input
              value={viewForm.name}
              onChange={(e) => setViewForm({ ...viewForm, name: e.target.value })}
              placeholder="e.g. Cold AWS buckets"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
            />
          </Field>
          <Field label="Scope">
            <select
              value={viewForm.scope}
              onChange={(e) => setViewForm({ ...viewForm, scope: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              {VIEW_SCOPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Filters (JSON)" hint="optional">
            <textarea
              value={viewForm.filters}
              onChange={(e) => setViewForm({ ...viewForm, filters: e.target.value })}
              rows={4}
              placeholder='{"tier":"standard","temperature":"cold"}'
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={viewForm.is_default}
              onChange={(e) => setViewForm({ ...viewForm, is_default: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-cyan-500"
            />
            Set as default view for this scope
          </label>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        {hint && <span className="font-normal normal-case text-slate-600">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function WeightSlider({
  label,
  tone,
  value,
  normalized,
  onChange,
}: {
  label: string
  tone: 'emerald' | 'amber' | 'rose'
  value: number
  normalized: number
  onChange: (v: number) => void
}) {
  const accent = tone === 'emerald' ? 'accent-emerald-500' : tone === 'amber' ? 'accent-amber-500' : 'accent-rose-500'
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-400">
          {value.toFixed(2)}
          <span className="ml-2 text-xs text-slate-600">{(normalized * 100).toFixed(0)}% weight</span>
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full ${accent}`}
      />
    </div>
  )
}
