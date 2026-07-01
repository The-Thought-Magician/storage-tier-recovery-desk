// All calls are same-origin relative fetches to /api/proxy/<path>, which maps 1:1
// to the backend /api/v1/<path>. The proxy route injects X-User-Id server-side.

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`/api/proxy/${path}`, init)
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = data && (data.error || data.message)
    let msg: string
    if (typeof err === 'string') {
      msg = err
    } else if (err && Array.isArray(err.issues)) {
      msg = err.issues
        .map((i: { path?: string[]; message?: string }) => `${(i.path ?? []).join('.')}: ${i.message}`)
        .join('; ')
    } else if (err) {
      msg = JSON.stringify(err)
    } else {
      msg = `Request failed (${res.status})`
    }
    throw new Error(msg)
  }
  return data
}

function get(path: string) {
  return req(path)
}
function send(method: string, path: string, body?: unknown) {
  return req(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

function qs(params?: Record<string, unknown>): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // accounts
  getAccounts: () => get('accounts'),
  getAccountsRollup: () => get('accounts/rollup'),
  getAccount: (id: string) => get(`accounts/${id}`),
  createAccount: (body: unknown) => send('POST', 'accounts', body),
  updateAccount: (id: string, body: unknown) => send('PUT', `accounts/${id}`, body),
  deleteAccount: (id: string) => send('DELETE', `accounts/${id}`),

  // assets
  getAssets: (params?: Record<string, unknown>) => get(`assets${qs(params)}`),
  getAsset: (id: string) => get(`assets/${id}`),
  updateAssetTags: (id: string, body: unknown) => send('PUT', `assets/${id}/tags`, body),
  deleteAsset: (id: string) => send('DELETE', `assets/${id}`),

  // access
  getAccessPatterns: (params?: Record<string, unknown>) => get(`access${qs(params)}`),
  getAccessHeatmap: () => get('access/heatmap'),
  enrichAccess: () => send('POST', 'access/enrich'),

  // pricing
  getPricingBooks: () => get('pricing/books'),
  getPricingEntries: (id: string) => get(`pricing/books/${id}/entries`),
  createPricingBook: (body: unknown) => send('POST', 'pricing/books', body),
  createPricingEntry: (body: unknown) => send('POST', 'pricing/entries', body),
  updatePricingEntry: (id: string, body: unknown) => send('PUT', `pricing/entries/${id}`, body),
  deletePricingEntry: (id: string) => send('DELETE', `pricing/entries/${id}`),

  // mistier
  getMistier: (params?: Record<string, unknown>) => get(`mistier${qs(params)}`),
  getMistierSummary: () => get('mistier/summary'),

  // snapshots
  getSnapshots: () => get('snapshots'),
  getSnapshotChains: () => get('snapshots/chains'),
  getSnapshotPruneCandidates: () => get('snapshots/prune-candidates'),

  // orphans
  getOrphans: () => get('orphans'),
  getOrphansSummary: () => get('orphans/summary'),

  // retention
  getRetentionPolicies: () => get('retention/policies'),
  getRetentionReconcile: () => get('retention/reconcile'),
  createRetentionPolicy: (body: unknown) => send('POST', 'retention/policies', body),
  updateRetentionPolicy: (id: string, body: unknown) => send('PUT', `retention/policies/${id}`, body),
  deleteRetentionPolicy: (id: string) => send('DELETE', `retention/policies/${id}`),

  // lifecycle
  getLifecycleModels: () => get('lifecycle'),
  getLifecycleModel: (id: string) => get(`lifecycle/${id}`),
  createLifecycleModel: (body: unknown) => send('POST', 'lifecycle', body),
  simulateLifecycleModel: (id: string, body?: unknown) => send('POST', `lifecycle/${id}/simulate`, body),
  deleteLifecycleModel: (id: string) => send('DELETE', `lifecycle/${id}`),

  // worksheet
  getWorksheet: (params?: Record<string, unknown>) => get(`worksheet${qs(params)}`),
  getWorksheetSummary: () => get('worksheet/summary'),
  createAction: (body: unknown) => send('POST', 'worksheet', body),
  updateAction: (id: string, body: unknown) => send('PUT', `worksheet/${id}`, body),
  deleteAction: (id: string) => send('DELETE', `worksheet/${id}`),

  // realized
  getRealized: () => get('realized'),
  getRealizedSummary: () => get('realized/summary'),
  recordRealized: (body: unknown) => send('POST', 'realized', body),

  // cycles
  getCycles: () => get('cycles'),
  getCycle: (id: string) => get(`cycles/${id}`),
  createCycle: (body: unknown) => send('POST', 'cycles', body),
  updateCycle: (id: string, body: unknown) => send('PUT', `cycles/${id}`, body),
  deleteCycle: (id: string) => send('DELETE', `cycles/${id}`),

  // analysis
  getAnalysisRuns: () => get('analysis/runs'),
  getAnalysisRun: (id: string) => get(`analysis/runs/${id}`),
  getAnalysisDiff: () => get('analysis/diff'),
  runAnalysis: (body?: unknown) => send('POST', 'analysis/run', body),

  // forecast
  getForecast: () => get('forecast'),
  projectScenario: (body: unknown) => send('POST', 'forecast/scenario', body),

  // dashboard
  getDashboard: () => get('dashboard'),
  getDashboardBreakdown: () => get('dashboard/breakdown'),
  getDashboardTrend: () => get('dashboard/trend'),

  // reports
  getReportSummary: (params?: Record<string, unknown>) => get(`reports/summary${qs(params)}`),
  getReportExport: (params?: Record<string, unknown>) => get(`reports/export${qs(params)}`),

  // allocation
  getAllocation: (params?: Record<string, unknown>) => get(`allocation${qs(params)}`),
  getUntaggedAllocation: () => get('allocation/untagged'),
  getTags: () => get('allocation/tags'),

  // alerts
  getAlerts: () => get('alerts'),
  getAlertRules: () => get('alerts/rules'),
  createAlertRule: (body: unknown) => send('POST', 'alerts/rules', body),
  updateAlertRule: (id: string, body: unknown) => send('PUT', `alerts/rules/${id}`, body),
  deleteAlertRule: (id: string) => send('DELETE', `alerts/rules/${id}`),
  updateAlertStatus: (id: string, body: unknown) => send('PUT', `alerts/${id}/status`, body),

  // views
  getViews: (params?: Record<string, unknown>) => get(`views${qs(params)}`),
  createView: (body: unknown) => send('POST', 'views', body),
  updateView: (id: string, body: unknown) => send('PUT', `views/${id}`, body),
  deleteView: (id: string) => send('DELETE', `views/${id}`),

  // activity
  getActivity: (params?: Record<string, unknown>) => get(`activity${qs(params)}`),

  // notifications
  getNotifications: () => get('notifications'),
  markNotificationRead: (id: string) => send('PUT', `notifications/${id}/read`),
  markAllNotificationsRead: () => send('PUT', 'notifications/read-all'),

  // settings
  getSettings: () => get('settings'),
  updateSettings: (body: unknown) => send('PUT', 'settings', body),

  // ingest
  getIngestRuns: () => get('ingest/runs'),
  uploadIngest: (body: unknown) => send('POST', 'ingest/upload', body),
  seedSample: (body?: unknown) => send('POST', 'ingest/seed', body),

  // billing
  getBillingPlan: () => get('billing/plan'),
  createCheckout: (body?: unknown) => send('POST', 'billing/checkout', body),
  createPortal: (body?: unknown) => send('POST', 'billing/portal', body),
}

export default api
