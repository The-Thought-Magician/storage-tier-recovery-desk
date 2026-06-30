# StorageTierRecoveryDesk

> Find the money trapped in mis-tiered, over-retained, and snapshot-bloated cloud storage and turn it into a prioritized recovery plan.

---

## Overview

StorageTierRecoveryDesk is a storage-specific cost-recovery analysis desk. It ingests cloud billing and usage exports (object storage, block volumes, snapshots, backups), enriches each asset with access-pattern signals, and computes the **exact dollars recoverable per action**: re-tier this bucket, delete this orphaned volume, prune this snapshot chain, tighten this retention policy. Every finding becomes a ranked line in a recovery worksheet with savings, effort, and risk, and the desk tracks realized savings as actions are marked done.

Unlike generic spend trackers (which show you the bill) or data-movers (which actually mutate your storage), StorageTierRecoveryDesk is a read-only **analysis and planning** layer that turns raw storage telemetry into a defensible, quarter-over-quarter recovery program. It is deterministic: every dollar figure is reproducible from the inputs and the pricing book, so a FinOps analyst can defend the number in a cost review.

The product is built for demoability: a built-in sample-data seeder generates a realistic multi-account, multi-provider storage estate so the entire workflow can be explored without connecting a real account.

---

## Problem

On large cloud estates, storage is routinely a top-three line item, and 15-40% of that spend is recoverable waste:

- **Mis-tiering.** Hot-tier (Standard) objects with cold access patterns that should sit in Infrequent Access, Glacier, or an archive tier. The price delta is large and the access risk is low, but native consoles do not compute the per-bucket monthly delta for you.
- **Snapshot and backup sprawl.** Snapshot chains and backup sets accumulate forever. Each one carries a monthly cost, but nobody attributes the carrying cost to the snapshot, so they never get pruned.
- **Orphaned and abandoned assets.** Volumes detached from any instance for months, buckets with zero reads in a quarter, incomplete multipart uploads silently billing. These are pure waste with near-zero deletion risk.
- **Over-retention.** Data kept far past its declared retention policy (or with no policy at all). Reconciling actual age against policy frees storage that nobody intended to keep.

Native tools (cost explorers, storage lens dashboards) surface aggregate spend and some recommendations, but they do not produce a **per-action dollar figure ranked by savings, effort, and risk** that a human can work through and check off. That worksheet is the gap.

---

## Target Users

- **FinOps analysts** at data-intensive companies (SaaS, media/streaming, analytics, genomics, fintech) who run quarterly cost reviews and need defensible savings numbers.
- **Storage and platform owners** who own the object/block storage and snapshot budgets and have authority to act on findings.
- **Cloud cost / engineering leadership** who want a recovery program with tracked realized savings, not a one-off audit.

**Buyer:** A FinOps analyst or storage/platform owner where object/block storage plus snapshots are a top-three cloud line, with a quarterly cost-review cadence and the authority (or direct influence) to action re-tiering and deletions. Recurring quarterly trigger, clear budget authority, large market. The first recovery cycle typically pays for the tool many times over.

---

## Why this is NOT an existing project

The nearest neighbors and the precise distinction:

- **archival-service / data-retention-engine** are *operational engines* that actually move or delete data (lifecycle execution, tiering execution). StorageTierRecoveryDesk does **not** mutate any storage. It is a read-only analysis and planning desk that tells you what to do and what it is worth; the actual moves happen in the cloud provider's tools. We model and rank; we never execute.
- **saas-spend-tracker** tracks SaaS subscription/seat spend. This is infrastructure storage cost, computed per storage asset, with tier-pricing math, not vendor invoices.
- **cost-anomaly-explainer** (nearest base) does anomaly attribution: it explains *spikes*. StorageTierRecoveryDesk is not about anomalies; it is about steady-state structural waste and the per-action recovery dollars to remove it, regardless of whether spend spiked.
- **nonprod-burn-warden** (nearest sibling) targets non-production *compute* scheduling (turn off idle dev instances). Different waste category entirely: that is compute scheduling, this is storage tiering/retention/orphan analysis.

The unique core is the **per-action recovery dollar engine**: for every asset and every candidate action, compute the precise monthly and annual savings from a pricing book, score effort and risk, rank into a worksheet, and track realized savings over time. That deterministic, defensible, storage-specific recovery worksheet is what no neighbor produces.

---

## Major Features

### 1. Cloud Account & Connection Registry
- Register cloud accounts (AWS, GCP, Azure, or generic) with provider, account label, default region, and currency.
- Connection method per account: uploaded export, connected (read-only role ARN / service account, stored as metadata only), or sample-generated.
- Per-account status (active, archived), last-ingest timestamp, and asset/finding counts.
- Multi-account rollup: aggregate spend and recoverable dollars across all accounts in a workspace.
- Tag each account with environment (prod/staging/dev), team, and cost-center labels.

### 2. Storage Inventory Ingestion
- Ingest from billing+usage exports: object storage buckets, block volumes, snapshots, backups, and incomplete multipart uploads.
- Per-asset fields: provider, region, asset type, current tier/storage class, size (bytes), object count, monthly cost, created date, last-access/last-modified date, owner tags.
- CSV/JSON upload ingestion with a documented column mapping and a downloadable template.
- Sample-data seeder: generate a realistic estate (hundreds of assets across accounts, tiers, regions, with plausible access patterns) for instant demo.
- Idempotent ingestion runs with a run ledger (rows parsed, assets upserted, errors).
- Normalize provider-specific tier names into a canonical tier ladder (hot / warm / cold / archive / deep-archive).

### 3. Access-Pattern Enrichment
- Attach access signals to each asset: reads in last 30/90 days, last-access date, request counts, retrieval volume.
- Classify access temperature: hot, warm, cold, frozen, never-accessed.
- Compute days-since-last-access and access-frequency score per asset.
- Flag assets where access temperature is colder than the storage tier they sit in (the core mis-tier signal).
- Heatmap of access temperature across tiers and accounts.

### 4. Pricing Book
- Per-provider, per-region, per-tier pricing entries: storage $/GB-month, retrieval $/GB, request $/1k, minimum-storage-duration, and early-deletion penalty.
- Seeded default pricing book for common providers; fully editable per workspace.
- Versioned pricing: each finding records the pricing-book version used so savings are reproducible.
- Custom tiers and custom providers supported.
- Currency-aware; per-account currency respected in rollups.

### 5. Mis-Tier Detector
- For each asset, evaluate every cheaper eligible target tier and compute the monthly + annual cost delta after accounting for retrieval and request cost at the asset's access pattern.
- Recommend the optimal target tier per asset (the one that maximizes net savings without violating access-risk thresholds).
- Net-savings math: storage savings minus projected retrieval/request cost minus early-deletion penalty over the assumed horizon.
- Confidence score based on access-pattern data completeness.
- Bulk view: total mis-tier recoverable dollars, sortable by per-asset savings.
- Each detector result becomes a candidate recovery action.

### 6. Snapshot & Backup Bloat Ledger
- Inventory all snapshots and backups with source asset, chain/lineage, age, size, and incremental vs full.
- Compute monthly carrying cost per snapshot and per chain.
- Detect redundant snapshots (overlapping coverage), stale snapshots (past retention), and orphaned snapshots (source asset deleted).
- Snapshot chain visualization: which snapshots can be pruned without losing recovery points.
- Recommend prune sets with the carrying cost recovered.

### 7. Orphaned-Volume & Abandoned-Bucket Finder
- Detect block volumes detached from any instance for N+ days (configurable threshold).
- Detect buckets with zero reads over a lookback window and no recent writes.
- Detect incomplete multipart uploads still billing.
- Detect snapshots whose source volume no longer exists.
- Risk-rated: each orphan gets a deletion-risk score (e.g. recently detached vs detached for a year).
- Each orphan becomes a candidate recovery action with the full monthly cost as recoverable.

### 8. Retention-vs-Policy Reconciler
- Define retention policies per scope (account, tag, asset-type): max age, required tier transitions, deletion-after.
- Reconcile each asset's actual age and tier against the policy that applies to it.
- Flag over-retention (asset older than policy allows) and policy gaps (assets matching no policy).
- Compute recoverable dollars from bringing assets into policy compliance.
- Policy coverage report: percentage of assets and spend governed by a policy.

### 9. Lifecycle-Policy Modeler
- Build candidate lifecycle policies (transition rules: after N days move tier A to tier B; expire after M days) without applying them.
- Simulate a candidate policy against the current inventory and project monthly savings, assets affected, and data moved.
- Compare multiple candidate policies side by side.
- Export the modeled policy as provider-ready lifecycle JSON for the user to apply themselves.
- What-if horizon: project savings over 1/3/12 months.

### 10. Recovery Worksheet
- Single ranked list of all candidate recovery actions across every detector.
- Each action: asset(s), action type (re-tier / prune-snapshot / delete-orphan / tighten-retention / apply-lifecycle), monthly savings, annual savings, effort score, risk score, and a composite priority score.
- Filter and group by account, action type, risk band, effort band.
- Assign owner, set status (proposed / approved / in-progress / done / dismissed), add notes.
- The desk's headline number: total recoverable monthly and annual dollars.

### 11. Realized-Savings Tracker
- When an action is marked done, capture the realized monthly savings (defaults to modeled, editable to actual).
- Cumulative realized savings over time, vs. modeled potential.
- Realized-vs-modeled variance per action and in aggregate.
- Savings run-rate and projected annualized realized savings.
- Per-cycle (quarter) realized savings rollup.

### 12. Recovery Cycles (Quarterly Programs)
- Group a set of worksheet actions into a named cycle (e.g. "Q3 FY26 Storage Recovery").
- Cycle target dollar amount, start/end dates, and progress vs target.
- Cycle status board: proposed / approved / done counts and dollars.
- Close-out report per cycle with realized savings.
- Compare cycle-over-cycle recovery trend.

### 13. Findings Engine & Re-Analysis
- A single "analyze" run that executes all detectors over the current inventory and produces/refreshes candidate actions.
- Deterministic: same inputs + same pricing book version yield the same findings.
- Re-analysis diff: what changed since the last run (new findings, resolved findings, changed savings).
- Per-run finding counts and total recoverable dollars snapshot.

### 14. Savings Forecast & Scenarios
- Forecast recoverable dollars under scenarios: "act on all low-risk", "act on top 20 by savings", "full program".
- Scenario builder selecting a subset of actions and projecting monthly/annual impact.
- Sensitivity: how savings change if access patterns or pricing shift.

### 15. Dashboards & KPIs
- Executive dashboard: total spend, total recoverable, recovered-to-date, recovery rate, top opportunities.
- Spend breakdown by provider, tier, account, region.
- Recoverable breakdown by action type and risk band.
- Trend charts: spend, recoverable, realized savings over time.

### 16. Reports & Exports
- Generate a recovery report (per workspace, per account, or per cycle) summarizing findings, savings, and realized progress.
- Export worksheet, findings, and inventory as CSV/JSON.
- Shareable report snapshot for cost reviews.

### 17. Tagging & Cost Allocation
- Asset tags (team, environment, cost-center, project) ingested and editable.
- Recoverable-dollar allocation by tag dimension (which team owns the most waste).
- Untagged-asset report (cost-allocation gaps).

### 18. Alerts & Thresholds
- Configurable thresholds: recoverable dollars above X, orphan age above N days, policy-coverage below Y%.
- Alert records generated on analysis when thresholds are crossed.
- Alert feed with acknowledge/resolve.

### 19. Saved Views & Filters
- Save named filter sets over inventory, findings, and worksheet (e.g. "prod cold objects > $500/mo").
- Quick-switch saved views; mark a default view.

### 20. Activity Log & Audit Trail
- Record every state change: ingestion runs, analysis runs, action status changes, policy edits, realized-savings edits.
- Per-entity history and a workspace-wide activity feed.
- Who/when/what for defensibility in cost reviews.

### 21. Notifications
- Per-user notifications for new high-value findings, cycle milestones, and crossed thresholds.
- Mark-read / mark-all-read.

### 22. Settings & Workspace Profile
- Workspace profile: default currency, fiscal-quarter start, risk/effort scoring weights.
- Scoring-weight tuning for the composite priority formula.
- Sample-data reset and seed controls.

### 23. Billing (Stripe-optional)
- Free plan for all signed-in users; all features free.
- Pro plan scaffold via Stripe; checkout/portal/webhook return 503 when Stripe is unconfigured.
- Plan view shows current subscription.

---

## Data Model (tables)

- **accounts** — registered cloud accounts.
- **storage_assets** — every storage asset (bucket, volume, snapshot, backup, multipart).
- **access_patterns** — per-asset access signals.
- **pricing_books** — pricing-book versions per workspace.
- **pricing_entries** — per provider/region/tier pricing rows.
- **retention_policies** — retention policy definitions.
- **lifecycle_models** — modeled (un-applied) lifecycle policies and their simulated results.
- **analysis_runs** — each full analyze run.
- **findings** — candidate recovery actions produced by detectors.
- **recovery_actions** — worksheet actions with owner/status/savings (the actionable layer over findings).
- **recovery_cycles** — quarterly recovery programs.
- **realized_savings** — realized savings records per completed action.
- **ingestion_runs** — upload/seed ingestion run ledger.
- **tags** — asset tag dimension values (allocation).
- **saved_views** — saved filter sets.
- **alerts** — generated threshold alerts.
- **alert_rules** — configurable thresholds.
- **activity_log** — audit trail.
- **notifications** — per-user notifications.
- **workspace_settings** — per-user workspace profile/scoring weights.
- **plans** — billing plans (free/pro).
- **subscriptions** — per-user subscription.

---

## API Surface (high level)

- `/accounts` — CRUD + rollup.
- `/assets` — list/detail/filter inventory, update tags.
- `/access` — access-pattern enrichment + temperature classification.
- `/pricing` — pricing books and entries CRUD.
- `/mistier` — mis-tier detection results.
- `/snapshots` — snapshot/backup bloat ledger.
- `/orphans` — orphan/abandoned finder.
- `/retention` — retention policies + reconciliation.
- `/lifecycle` — lifecycle modeler + simulate.
- `/worksheet` — recovery actions list + status/owner.
- `/realized` — realized-savings tracker.
- `/cycles` — recovery cycles.
- `/analysis` — run analysis, list runs, diff.
- `/forecast` — savings forecast + scenarios.
- `/dashboard` — KPIs + breakdowns.
- `/reports` — report generation + export.
- `/allocation` — tag-based cost allocation.
- `/alerts` — alerts + alert rules.
- `/views` — saved views.
- `/activity` — activity log feed.
- `/notifications` — notifications.
- `/settings` — workspace settings.
- `/ingest` — upload/seed ingestion.
- `/billing` — Stripe-optional plan/checkout/portal/webhook.

---

## Frontend Pages (~24)

Public:
1. `/` — landing (static marketing).
2. `/auth/sign-in` — sign in.
3. `/auth/sign-up` — sign up.
4. `/pricing` — plans (static + plan fetch).

Dashboard (under `/dashboard`, shared sidebar):
5. `/dashboard` — executive overview (KPIs, top opportunities).
6. `/dashboard/accounts` — cloud account registry.
7. `/dashboard/ingest` — upload/seed ingestion + run ledger.
8. `/dashboard/inventory` — storage asset inventory with filters.
9. `/dashboard/inventory/[id]` — asset detail (access, pricing, candidate actions).
10. `/dashboard/access` — access-pattern enrichment + temperature heatmap.
11. `/dashboard/mistier` — mis-tier detector results.
12. `/dashboard/snapshots` — snapshot & backup bloat ledger.
13. `/dashboard/orphans` — orphan & abandoned finder.
14. `/dashboard/retention` — retention policies + reconciliation.
15. `/dashboard/lifecycle` — lifecycle-policy modeler + simulate/compare.
16. `/dashboard/worksheet` — recovery worksheet (ranked actions).
17. `/dashboard/realized` — realized-savings tracker.
18. `/dashboard/cycles` — recovery cycles.
19. `/dashboard/analysis` — analysis runs + re-analysis diff.
20. `/dashboard/forecast` — savings forecast + scenario builder.
21. `/dashboard/allocation` — tag-based cost allocation.
22. `/dashboard/pricing` — pricing book editor.
23. `/dashboard/alerts` — alerts + alert rules.
24. `/dashboard/reports` — reports + exports.
25. `/dashboard/activity` — activity log feed.
26. `/dashboard/settings` — workspace settings, saved views, notifications, billing.
