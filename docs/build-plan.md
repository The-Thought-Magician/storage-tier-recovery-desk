# StorageTierRecoveryDesk — Build Plan (Authoritative Build Contract)

This is the single source of truth. Filenames, mount paths, api method names, and page files declared here are binding. Every api method is implemented by exactly one route endpoint and consumed by at least one page.

Stack: Hono 4.12.27 backend (Render), drizzle-orm 0.45.2 + @neondatabase/serverless (Neon Postgres), Next.js 16 + React 19 + Tailwind 4 frontend (Vercel), `@neondatabase/auth@0.4.2-beta`. Backend trusts `X-User-Id` header via `getUserId(c)`. Routes mount under `/api/v1` via a child Hono `api` router. Frontend calls relative `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`. Full Stripe-optional-503 billing.

---

## (a) Tables (columns)

1. **accounts** — id, user_id, name, provider, account_ref, default_region, currency, connection_method, environment, team, cost_center, status, last_ingest_at, created_at, updated_at
2. **storage_assets** — id, user_id, account_id→accounts, external_id, name, asset_type, provider, region, current_tier, size_bytes, object_count, monthly_cost, source_asset_id, is_incremental, attached, detached_since, asset_created_at, last_modified_at, tags(jsonb), metadata(jsonb), created_at
3. **access_patterns** — id, user_id, asset_id→storage_assets(unique), reads_30d, reads_90d, requests_30d, retrieval_gb_30d, last_access_at, days_since_access, temperature, access_score, created_at
4. **pricing_books** — id, user_id, name, version, is_default, currency, created_at
5. **pricing_entries** — id, user_id, book_id→pricing_books, provider, region, tier, storage_per_gb_month, retrieval_per_gb, request_per_1k, min_duration_days, early_delete_penalty_per_gb, created_at; UNIQUE(book_id, provider, region, tier)
6. **retention_policies** — id, user_id, name, scope_type, scope_value, max_age_days, transition_after_days, transition_to_tier, delete_after_days, enabled, created_at, updated_at
7. **lifecycle_models** — id, user_id, account_id→accounts, name, rules(jsonb), simulated_monthly_savings, simulated_assets_affected, simulated_data_moved_gb, last_simulated_at, created_at
8. **analysis_runs** — id, user_id, account_id→accounts, pricing_book_id→pricing_books, status, findings_count, total_recoverable_monthly, summary(jsonb), created_at
9. **findings** — id, user_id, run_id→analysis_runs, account_id→accounts, asset_id→storage_assets, finding_type, title, detail, recommended_action, target_tier, monthly_savings, annual_savings, effort_score, risk_score, priority_score, confidence, pricing_book_version, metadata(jsonb), created_at
10. **recovery_cycles** — id, user_id, name, target_monthly_savings, start_date, end_date, status, created_at
11. **recovery_actions** — id, user_id, finding_id→findings, account_id→accounts, asset_id→storage_assets, cycle_id→recovery_cycles, action_type, title, monthly_savings, annual_savings, effort_score, risk_score, priority_score, owner, status, notes, created_at, updated_at
12. **realized_savings** — id, user_id, action_id→recovery_actions(unique), cycle_id→recovery_cycles, modeled_monthly, realized_monthly, variance, realized_at, created_at
13. **ingestion_runs** — id, user_id, account_id→accounts, source, rows_parsed, assets_upserted, errors(jsonb), status, created_at
14. **tags** — id, user_id, key, value, created_at; UNIQUE(user_id, key, value)
15. **saved_views** — id, user_id, name, scope, filters(jsonb), is_default, created_at
16. **alert_rules** — id, user_id, name, metric, threshold, enabled, created_at
17. **alerts** — id, user_id, rule_id→alert_rules, message, severity, value, status, created_at
18. **activity_log** — id, user_id, entity_type, entity_id, action, detail(jsonb), created_at
19. **notifications** — id, user_id, title, body, kind, link, read, created_at
20. **workspace_settings** — id, user_id(unique), default_currency, fiscal_quarter_start, weight_savings, weight_effort, weight_risk, created_at, updated_at
21. **plans** — id('free'/'pro'), name, price_cents, created_at
22. **subscriptions** — id, user_id(unique), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files

All mount under `/api/v1/<mount>`. Reads are public; writes are auth-gated (`authMiddleware` + `getUserId(c)`) with zod validation and ownership checks. Every domain route file does `export default router`.

### accounts.ts → `/api/v1/accounts`
- `GET /` — public — list accounts → `Account[]`
- `GET /rollup` — public — aggregate spend + recoverable across accounts → `{ total_spend, total_recoverable, account_count, by_provider: [] }`
- `GET /:id` — public — account detail → `Account`
- `POST /` — auth — create account → `Account`
- `PUT /:id` — auth — update account → `Account`
- `DELETE /:id` — auth — delete account → `{ success }`

### assets.ts → `/api/v1/assets`
- `GET /` — public — list/filter inventory (query: account_id, asset_type, tier, temperature) → `Asset[]`
- `GET /:id` — public — asset detail (joins access + findings) → `{ asset, access, findings }`
- `PUT /:id/tags` — auth — update asset tags → `Asset`
- `DELETE /:id` — auth — remove asset → `{ success }`

### access.ts → `/api/v1/access`
- `GET /` — public — list access patterns (query: account_id) → `AccessPattern[]`
- `GET /heatmap` — public — temperature x tier matrix → `{ matrix: [], tiers, temperatures }`
- `POST /enrich` — auth — (re)compute temperature/score for all assets → `{ updated }`

### pricing.ts → `/api/v1/pricing`
- `GET /books` — public — list pricing books → `PricingBook[]`
- `GET /books/:id/entries` — public — list entries for a book → `PricingEntry[]`
- `POST /books` — auth — create pricing book → `PricingBook`
- `POST /entries` — auth — create pricing entry → `PricingEntry`
- `PUT /entries/:id` — auth — update entry → `PricingEntry`
- `DELETE /entries/:id` — auth — delete entry → `{ success }`

### mistier.ts → `/api/v1/mistier`
- `GET /` — public — mis-tier findings list with savings (query: account_id) → `Finding[]`
- `GET /summary` — public — total mis-tier recoverable + count → `{ total_monthly, total_annual, count }`

### snapshots.ts → `/api/v1/snapshots`
- `GET /` — public — snapshot/backup ledger with carrying cost → `Asset[]` (asset_type in snapshot/backup)
- `GET /chains` — public — chains/lineage grouped by source → `{ chains: [] }`
- `GET /prune-candidates` — public — redundant/stale/orphaned snapshots with recoverable cost → `{ candidates: [], total_monthly }`

### orphans.ts → `/api/v1/orphans`
- `GET /` — public — orphaned volumes, abandoned buckets, multipart, orphaned snapshots → `{ orphans: [], total_monthly }`
- `GET /summary` — public — counts by orphan type + recoverable → `{ by_type: [], total_monthly }`

### retention.ts → `/api/v1/retention`
- `GET /policies` — public — list retention policies → `RetentionPolicy[]`
- `GET /reconcile` — public — over-retention + policy-gap findings + coverage → `{ violations: [], gaps: [], coverage_pct, recoverable_monthly }`
- `POST /policies` — auth — create policy → `RetentionPolicy`
- `PUT /policies/:id` — auth — update policy → `RetentionPolicy`
- `DELETE /policies/:id` — auth — delete policy → `{ success }`

### lifecycle.ts → `/api/v1/lifecycle`
- `GET /` — public — list lifecycle models → `LifecycleModel[]`
- `GET /:id` — public — model detail → `LifecycleModel`
- `POST /` — auth — create model → `LifecycleModel`
- `POST /:id/simulate` — auth — simulate model vs inventory → `{ model, simulated_monthly_savings, simulated_assets_affected, simulated_data_moved_gb }`
- `DELETE /:id` — auth — delete model → `{ success }`

### worksheet.ts → `/api/v1/worksheet`
- `GET /` — public — ranked recovery actions (query: account_id, action_type, status, risk) → `RecoveryAction[]`
- `GET /summary` — public — total recoverable monthly/annual + by status/type → `{ total_monthly, total_annual, by_status, by_type }`
- `POST /` — auth — create action (often promoted from a finding) → `RecoveryAction`
- `PUT /:id` — auth — update status/owner/notes/cycle → `RecoveryAction`
- `DELETE /:id` — auth — delete action → `{ success }`

### realized.ts → `/api/v1/realized`
- `GET /` — public — realized savings records → `RealizedSaving[]`
- `GET /summary` — public — cumulative realized vs modeled, run-rate → `{ realized_monthly, modeled_monthly, variance, annualized }`
- `POST /` — auth — record realized savings for an action → `RealizedSaving`

### cycles.ts → `/api/v1/cycles`
- `GET /` — public — list cycles with progress → `(RecoveryCycle & { progress })[]`
- `GET /:id` — public — cycle detail with actions + realized → `{ cycle, actions, realized }`
- `POST /` — auth — create cycle → `RecoveryCycle`
- `PUT /:id` — auth — update/close cycle → `RecoveryCycle`
- `DELETE /:id` — auth — delete cycle → `{ success }`

### analysis.ts → `/api/v1/analysis`
- `GET /runs` — public — list analysis runs → `AnalysisRun[]`
- `GET /runs/:id` — public — run detail + findings → `{ run, findings }`
- `GET /diff` — public — diff latest two runs → `{ new: [], resolved: [], changed: [] }`
- `POST /run` — auth — execute all detectors, produce findings + run → `{ run, findings_count, total_recoverable_monthly }`

### forecast.ts → `/api/v1/forecast`
- `GET /` — public — scenario forecasts (low-risk / top-20 / full) → `{ scenarios: [] }`
- `POST /scenario` — auth — project a chosen subset of action ids → `{ monthly, annual, count }`

### dashboard.ts → `/api/v1/dashboard`
- `GET /` — public — KPIs (total spend, recoverable, realized, recovery rate, top opportunities) → `{ kpis, top_opportunities }`
- `GET /breakdown` — public — spend + recoverable by provider/tier/account/region/action_type/risk → `{ by_provider, by_tier, by_account, by_region, by_action_type, by_risk }`
- `GET /trend` — public — spend/recoverable/realized over time → `{ points: [] }`

### reports.ts → `/api/v1/reports`
- `GET /summary` — public — generate report payload (query: scope=workspace|account|cycle, id?) → `{ report }`
- `GET /export` — public — CSV/JSON export (query: kind=worksheet|findings|inventory, format) → file body

### allocation.ts → `/api/v1/allocation`
- `GET /` — public — recoverable + spend by tag dimension (query: dimension) → `{ dimension, rows: [] }`
- `GET /untagged` — public — untagged assets / cost-allocation gaps → `{ assets: [], untagged_spend }`
- `GET /tags` — public — list tag dimension values → `Tag[]`

### alerts.ts → `/api/v1/alerts`
- `GET /` — public — alert feed → `Alert[]`
- `GET /rules` — public — list alert rules → `AlertRule[]`
- `POST /rules` — auth — create rule → `AlertRule`
- `PUT /rules/:id` — auth — update rule → `AlertRule`
- `DELETE /rules/:id` — auth — delete rule → `{ success }`
- `PUT /:id/status` — auth — acknowledge/resolve alert → `Alert`

### views.ts → `/api/v1/views`
- `GET /` — public — list saved views (query: scope) → `SavedView[]`
- `POST /` — auth — create saved view → `SavedView`
- `PUT /:id` — auth — update saved view → `SavedView`
- `DELETE /:id` — auth — delete saved view → `{ success }`

### activity.ts → `/api/v1/activity`
- `GET /` — public — activity feed (query: entity_type, limit) → `ActivityEntry[]`

### notifications.ts → `/api/v1/notifications`
- `GET /` — auth — current user notifications → `Notification[]`
- `PUT /:id/read` — auth — mark read → `Notification`
- `PUT /read-all` — auth — mark all read → `{ success }`

### settings.ts → `/api/v1/settings`
- `GET /` — auth — workspace settings (creates default on first read) → `WorkspaceSettings`
- `PUT /` — auth — update settings + scoring weights → `WorkspaceSettings`

### ingest.ts → `/api/v1/ingest`
- `GET /runs` — public — ingestion run ledger → `IngestionRun[]`
- `POST /upload` — auth — ingest parsed rows (assets/access) into an account → `{ run, assets_upserted }`
- `POST /seed` — auth — generate sample estate (accounts, assets, access, pricing) → `{ run, accounts, assets }`

### billing.ts → `/api/v1/billing`
- `GET /plan` — public(reads x-user-id) — current subscription + plan + stripeEnabled → `{ subscription, plan, stripeEnabled }`
- `POST /checkout` — auth — Stripe checkout (503 if unconfigured) → `{ url }`
- `POST /portal` — auth — Stripe billing portal (503 if unconfigured) → `{ url }`
- `POST /webhook` — public — Stripe webhook (503 if unconfigured) → `{ received }`

---

## (c) lib/api.ts methods

Each is `fetch('/api/proxy/<path>')`; path maps 1:1 to `/api/v1/<path>`.

| Method | Verb | Proxy path |
|--------|------|------------|
| getAccounts | GET | /api/proxy/accounts |
| getAccountsRollup | GET | /api/proxy/accounts/rollup |
| getAccount | GET | /api/proxy/accounts/:id |
| createAccount | POST | /api/proxy/accounts |
| updateAccount | PUT | /api/proxy/accounts/:id |
| deleteAccount | DELETE | /api/proxy/accounts/:id |
| getAssets | GET | /api/proxy/assets |
| getAsset | GET | /api/proxy/assets/:id |
| updateAssetTags | PUT | /api/proxy/assets/:id/tags |
| deleteAsset | DELETE | /api/proxy/assets/:id |
| getAccessPatterns | GET | /api/proxy/access |
| getAccessHeatmap | GET | /api/proxy/access/heatmap |
| enrichAccess | POST | /api/proxy/access/enrich |
| getPricingBooks | GET | /api/proxy/pricing/books |
| getPricingEntries | GET | /api/proxy/pricing/books/:id/entries |
| createPricingBook | POST | /api/proxy/pricing/books |
| createPricingEntry | POST | /api/proxy/pricing/entries |
| updatePricingEntry | PUT | /api/proxy/pricing/entries/:id |
| deletePricingEntry | DELETE | /api/proxy/pricing/entries/:id |
| getMistier | GET | /api/proxy/mistier |
| getMistierSummary | GET | /api/proxy/mistier/summary |
| getSnapshots | GET | /api/proxy/snapshots |
| getSnapshotChains | GET | /api/proxy/snapshots/chains |
| getSnapshotPruneCandidates | GET | /api/proxy/snapshots/prune-candidates |
| getOrphans | GET | /api/proxy/orphans |
| getOrphansSummary | GET | /api/proxy/orphans/summary |
| getRetentionPolicies | GET | /api/proxy/retention/policies |
| getRetentionReconcile | GET | /api/proxy/retention/reconcile |
| createRetentionPolicy | POST | /api/proxy/retention/policies |
| updateRetentionPolicy | PUT | /api/proxy/retention/policies/:id |
| deleteRetentionPolicy | DELETE | /api/proxy/retention/policies/:id |
| getLifecycleModels | GET | /api/proxy/lifecycle |
| getLifecycleModel | GET | /api/proxy/lifecycle/:id |
| createLifecycleModel | POST | /api/proxy/lifecycle |
| simulateLifecycleModel | POST | /api/proxy/lifecycle/:id/simulate |
| deleteLifecycleModel | DELETE | /api/proxy/lifecycle/:id |
| getWorksheet | GET | /api/proxy/worksheet |
| getWorksheetSummary | GET | /api/proxy/worksheet/summary |
| createAction | POST | /api/proxy/worksheet |
| updateAction | PUT | /api/proxy/worksheet/:id |
| deleteAction | DELETE | /api/proxy/worksheet/:id |
| getRealized | GET | /api/proxy/realized |
| getRealizedSummary | GET | /api/proxy/realized/summary |
| recordRealized | POST | /api/proxy/realized |
| getCycles | GET | /api/proxy/cycles |
| getCycle | GET | /api/proxy/cycles/:id |
| createCycle | POST | /api/proxy/cycles |
| updateCycle | PUT | /api/proxy/cycles/:id |
| deleteCycle | DELETE | /api/proxy/cycles/:id |
| getAnalysisRuns | GET | /api/proxy/analysis/runs |
| getAnalysisRun | GET | /api/proxy/analysis/runs/:id |
| getAnalysisDiff | GET | /api/proxy/analysis/diff |
| runAnalysis | POST | /api/proxy/analysis/run |
| getForecast | GET | /api/proxy/forecast |
| projectScenario | POST | /api/proxy/forecast/scenario |
| getDashboard | GET | /api/proxy/dashboard |
| getDashboardBreakdown | GET | /api/proxy/dashboard/breakdown |
| getDashboardTrend | GET | /api/proxy/dashboard/trend |
| getReportSummary | GET | /api/proxy/reports/summary |
| getReportExport | GET | /api/proxy/reports/export |
| getAllocation | GET | /api/proxy/allocation |
| getUntaggedAllocation | GET | /api/proxy/allocation/untagged |
| getTags | GET | /api/proxy/allocation/tags |
| getAlerts | GET | /api/proxy/alerts |
| getAlertRules | GET | /api/proxy/alerts/rules |
| createAlertRule | POST | /api/proxy/alerts/rules |
| updateAlertRule | PUT | /api/proxy/alerts/rules/:id |
| deleteAlertRule | DELETE | /api/proxy/alerts/rules/:id |
| updateAlertStatus | PUT | /api/proxy/alerts/:id/status |
| getViews | GET | /api/proxy/views |
| createView | POST | /api/proxy/views |
| updateView | PUT | /api/proxy/views/:id |
| deleteView | DELETE | /api/proxy/views/:id |
| getActivity | GET | /api/proxy/activity |
| getNotifications | GET | /api/proxy/notifications |
| markNotificationRead | PUT | /api/proxy/notifications/:id/read |
| markAllNotificationsRead | PUT | /api/proxy/notifications/read-all |
| getSettings | GET | /api/proxy/settings |
| updateSettings | PUT | /api/proxy/settings |
| getIngestRuns | GET | /api/proxy/ingest/runs |
| uploadIngest | POST | /api/proxy/ingest/upload |
| seedSample | POST | /api/proxy/ingest/seed |
| getBillingPlan | GET | /api/proxy/billing/plan |
| createCheckout | POST | /api/proxy/billing/checkout |
| createPortal | POST | /api/proxy/billing/portal |

---

## (d) Pages

### Public
| URL | File | Kind | API methods | Renders |
|-----|------|------|-------------|---------|
| `/` | `web/app/page.tsx` | public | (none) | Static landing: hero, feature grid, CTAs to sign-up/pricing |
| `/auth/sign-in` | `web/app/auth/sign-in/page.tsx` | public | (authClient) | Email/password sign-in form |
| `/auth/sign-up` | `web/app/auth/sign-up/page.tsx` | public | (authClient) | Email/password sign-up form |
| `/pricing` | `web/app/pricing/page.tsx` | public | getBillingPlan | Static plan cards + current plan |

### Dashboard (under `web/app/dashboard/*`, shared `DashboardLayout` sidebar)
| URL | File | Kind | API methods | Renders |
|-----|------|------|-------------|---------|
| `/dashboard` | `web/app/dashboard/page.tsx` | dashboard | getDashboard, getDashboardTrend | Executive overview: KPIs, recovery rate, top opportunities, trend |
| `/dashboard/accounts` | `web/app/dashboard/accounts/page.tsx` | dashboard | getAccounts, getAccountsRollup, createAccount, updateAccount, deleteAccount | Cloud account registry + rollup |
| `/dashboard/ingest` | `web/app/dashboard/ingest/page.tsx` | dashboard | getIngestRuns, uploadIngest, seedSample, getAccounts | Upload/seed ingestion + run ledger |
| `/dashboard/inventory` | `web/app/dashboard/inventory/page.tsx` | dashboard | getAssets, getAccounts, getViews | Storage inventory table with filters + saved views |
| `/dashboard/inventory/[id]` | `web/app/dashboard/inventory/[id]/page.tsx` | dashboard | getAsset, updateAssetTags | Asset detail: access, pricing, candidate actions, tags |
| `/dashboard/access` | `web/app/dashboard/access/page.tsx` | dashboard | getAccessPatterns, getAccessHeatmap, enrichAccess | Access-pattern table + temperature heatmap + enrich |
| `/dashboard/mistier` | `web/app/dashboard/mistier/page.tsx` | dashboard | getMistier, getMistierSummary, createAction | Mis-tier findings, savings, promote to worksheet |
| `/dashboard/snapshots` | `web/app/dashboard/snapshots/page.tsx` | dashboard | getSnapshots, getSnapshotChains, getSnapshotPruneCandidates, createAction | Snapshot/backup ledger, chains, prune candidates |
| `/dashboard/orphans` | `web/app/dashboard/orphans/page.tsx` | dashboard | getOrphans, getOrphansSummary, createAction | Orphan/abandoned finder + promote |
| `/dashboard/retention` | `web/app/dashboard/retention/page.tsx` | dashboard | getRetentionPolicies, getRetentionReconcile, createRetentionPolicy, updateRetentionPolicy, deleteRetentionPolicy | Retention policies + reconciliation/coverage |
| `/dashboard/lifecycle` | `web/app/dashboard/lifecycle/page.tsx` | dashboard | getLifecycleModels, createLifecycleModel, simulateLifecycleModel, deleteLifecycleModel, getAccounts | Lifecycle modeler + simulate/compare |
| `/dashboard/worksheet` | `web/app/dashboard/worksheet/page.tsx` | dashboard | getWorksheet, getWorksheetSummary, updateAction, deleteAction, getCycles | Ranked recovery worksheet, assign/status/cycle |
| `/dashboard/realized` | `web/app/dashboard/realized/page.tsx` | dashboard | getRealized, getRealizedSummary, recordRealized | Realized-savings tracker, modeled vs realized |
| `/dashboard/cycles` | `web/app/dashboard/cycles/page.tsx` | dashboard | getCycles, getCycle, createCycle, updateCycle, deleteCycle | Recovery cycles board + close-out |
| `/dashboard/analysis` | `web/app/dashboard/analysis/page.tsx` | dashboard | getAnalysisRuns, getAnalysisRun, getAnalysisDiff, runAnalysis | Analysis runs, run-now, re-analysis diff |
| `/dashboard/forecast` | `web/app/dashboard/forecast/page.tsx` | dashboard | getForecast, projectScenario, getWorksheet | Savings forecast + scenario builder |
| `/dashboard/allocation` | `web/app/dashboard/allocation/page.tsx` | dashboard | getAllocation, getUntaggedAllocation, getTags | Tag-based cost allocation + untagged gaps |
| `/dashboard/pricing` | `web/app/dashboard/pricing/page.tsx` | dashboard | getPricingBooks, getPricingEntries, createPricingBook, createPricingEntry, updatePricingEntry, deletePricingEntry | Pricing book editor |
| `/dashboard/alerts` | `web/app/dashboard/alerts/page.tsx` | dashboard | getAlerts, getAlertRules, createAlertRule, updateAlertRule, deleteAlertRule, updateAlertStatus | Alerts feed + rule config |
| `/dashboard/reports` | `web/app/dashboard/reports/page.tsx` | dashboard | getReportSummary, getReportExport, getDashboardBreakdown | Reports + CSV/JSON exports + breakdown |
| `/dashboard/activity` | `web/app/dashboard/activity/page.tsx` | dashboard | getActivity | Activity log / audit feed |
| `/dashboard/settings` | `web/app/dashboard/settings/page.tsx` | dashboard | getSettings, updateSettings, getViews, createView, deleteView, getNotifications, markNotificationRead, markAllNotificationsRead, getBillingPlan, createCheckout, createPortal | Workspace settings, scoring weights, saved views, notifications, billing |

26 pages total (4 public + 22 dashboard). 25 route files (24 domain + billing).

---

## (e) DashboardLayout sidebar nav

`web/components/DashboardLayout.tsx` — `'use client'`, `<aside>` sidebar, active state via `usePathname()`, mobile drawer. Sections:

**Overview**
- Dashboard → `/dashboard`

**Estate**
- Accounts → `/dashboard/accounts`
- Ingest → `/dashboard/ingest`
- Inventory → `/dashboard/inventory`
- Access Patterns → `/dashboard/access`

**Detectors**
- Mis-Tier → `/dashboard/mistier`
- Snapshots & Backups → `/dashboard/snapshots`
- Orphans → `/dashboard/orphans`
- Retention → `/dashboard/retention`
- Lifecycle Modeler → `/dashboard/lifecycle`

**Recovery**
- Worksheet → `/dashboard/worksheet`
- Cycles → `/dashboard/cycles`
- Realized Savings → `/dashboard/realized`
- Forecast → `/dashboard/forecast`

**Analyze**
- Analysis Runs → `/dashboard/analysis`
- Allocation → `/dashboard/allocation`
- Pricing Book → `/dashboard/pricing`
- Alerts → `/dashboard/alerts`
- Reports → `/dashboard/reports`
- Activity → `/dashboard/activity`

**Account**
- Settings → `/dashboard/settings`
