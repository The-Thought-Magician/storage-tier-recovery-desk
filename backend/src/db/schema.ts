import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  provider: text('provider').notNull(), // aws | gcp | azure | other
  account_ref: text('account_ref'), // external account id / project id
  default_region: text('default_region'),
  currency: text('currency').notNull().default('USD'),
  connection_method: text('connection_method').notNull().default('sample'), // upload | connected | sample
  environment: text('environment'), // prod | staging | dev
  team: text('team'),
  cost_center: text('cost_center'),
  status: text('status').notNull().default('active'), // active | archived
  last_ingest_at: timestamp('last_ingest_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Storage assets
// ---------------------------------------------------------------------------
export const storage_assets = pgTable('storage_assets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  external_id: text('external_id'), // ARN / resource id
  name: text('name').notNull(),
  asset_type: text('asset_type').notNull(), // bucket | volume | snapshot | backup | multipart
  provider: text('provider').notNull(),
  region: text('region'),
  current_tier: text('current_tier').notNull(), // hot | warm | cold | archive | deep-archive
  size_bytes: real('size_bytes').notNull().default(0),
  object_count: integer('object_count').default(0),
  monthly_cost: real('monthly_cost').notNull().default(0),
  source_asset_id: text('source_asset_id'), // for snapshots/backups: source volume/bucket
  is_incremental: boolean('is_incremental').default(false),
  attached: boolean('attached').default(true), // for volumes
  detached_since: timestamp('detached_since'),
  asset_created_at: timestamp('asset_created_at'),
  last_modified_at: timestamp('last_modified_at'),
  tags: jsonb('tags').$type<Record<string, string>>().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Access patterns
// ---------------------------------------------------------------------------
export const access_patterns = pgTable('access_patterns', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  asset_id: text('asset_id').notNull().references(() => storage_assets.id).unique(),
  reads_30d: integer('reads_30d').default(0),
  reads_90d: integer('reads_90d').default(0),
  requests_30d: integer('requests_30d').default(0),
  retrieval_gb_30d: real('retrieval_gb_30d').default(0),
  last_access_at: timestamp('last_access_at'),
  days_since_access: integer('days_since_access'),
  temperature: text('temperature').notNull().default('warm'), // hot | warm | cold | frozen | never
  access_score: real('access_score').default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------
export const pricing_books = pgTable('pricing_books', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  is_default: boolean('is_default').default(false),
  currency: text('currency').notNull().default('USD'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const pricing_entries = pgTable('pricing_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  book_id: text('book_id').notNull().references(() => pricing_books.id),
  provider: text('provider').notNull(),
  region: text('region').notNull(),
  tier: text('tier').notNull(),
  storage_per_gb_month: real('storage_per_gb_month').notNull().default(0),
  retrieval_per_gb: real('retrieval_per_gb').default(0),
  request_per_1k: real('request_per_1k').default(0),
  min_duration_days: integer('min_duration_days').default(0),
  early_delete_penalty_per_gb: real('early_delete_penalty_per_gb').default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.book_id, t.provider, t.region, t.tier)])

// ---------------------------------------------------------------------------
// Retention policies
// ---------------------------------------------------------------------------
export const retention_policies = pgTable('retention_policies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  scope_type: text('scope_type').notNull().default('account'), // account | tag | asset_type | all
  scope_value: text('scope_value'), // account_id, tag key:value, or asset_type
  max_age_days: integer('max_age_days'),
  transition_after_days: integer('transition_after_days'),
  transition_to_tier: text('transition_to_tier'),
  delete_after_days: integer('delete_after_days'),
  enabled: boolean('enabled').default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Lifecycle models (modeled, not applied)
// ---------------------------------------------------------------------------
export const lifecycle_models = pgTable('lifecycle_models', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  account_id: text('account_id').references(() => accounts.id),
  name: text('name').notNull(),
  rules: jsonb('rules').$type<Array<{ after_days: number; from_tier: string; to_tier: string; expire?: boolean }>>().default([]),
  simulated_monthly_savings: real('simulated_monthly_savings').default(0),
  simulated_assets_affected: integer('simulated_assets_affected').default(0),
  simulated_data_moved_gb: real('simulated_data_moved_gb').default(0),
  last_simulated_at: timestamp('last_simulated_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Analysis runs
// ---------------------------------------------------------------------------
export const analysis_runs = pgTable('analysis_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  account_id: text('account_id').references(() => accounts.id),
  pricing_book_id: text('pricing_book_id').references(() => pricing_books.id),
  status: text('status').notNull().default('completed'), // running | completed | failed
  findings_count: integer('findings_count').default(0),
  total_recoverable_monthly: real('total_recoverable_monthly').default(0),
  summary: jsonb('summary').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Findings (raw detector output)
// ---------------------------------------------------------------------------
export const findings = pgTable('findings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  run_id: text('run_id').references(() => analysis_runs.id),
  account_id: text('account_id').references(() => accounts.id),
  asset_id: text('asset_id').references(() => storage_assets.id),
  finding_type: text('finding_type').notNull(), // mistier | snapshot_bloat | orphan | over_retention | lifecycle
  title: text('title').notNull(),
  detail: text('detail'),
  recommended_action: text('recommended_action'), // re-tier | prune-snapshot | delete-orphan | tighten-retention | apply-lifecycle
  target_tier: text('target_tier'),
  monthly_savings: real('monthly_savings').notNull().default(0),
  annual_savings: real('annual_savings').notNull().default(0),
  effort_score: integer('effort_score').default(1), // 1-5
  risk_score: integer('risk_score').default(1), // 1-5
  priority_score: real('priority_score').default(0),
  confidence: real('confidence').default(1),
  pricing_book_version: integer('pricing_book_version'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Recovery actions (worksheet)
// ---------------------------------------------------------------------------
export const recovery_actions = pgTable('recovery_actions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  finding_id: text('finding_id').references(() => findings.id),
  account_id: text('account_id').references(() => accounts.id),
  asset_id: text('asset_id').references(() => storage_assets.id),
  cycle_id: text('cycle_id').references(() => recovery_cycles.id),
  action_type: text('action_type').notNull(),
  title: text('title').notNull(),
  monthly_savings: real('monthly_savings').notNull().default(0),
  annual_savings: real('annual_savings').notNull().default(0),
  effort_score: integer('effort_score').default(1),
  risk_score: integer('risk_score').default(1),
  priority_score: real('priority_score').default(0),
  owner: text('owner'),
  status: text('status').notNull().default('proposed'), // proposed | approved | in-progress | done | dismissed
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Recovery cycles
// ---------------------------------------------------------------------------
export const recovery_cycles = pgTable('recovery_cycles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  target_monthly_savings: real('target_monthly_savings').default(0),
  start_date: timestamp('start_date'),
  end_date: timestamp('end_date'),
  status: text('status').notNull().default('open'), // open | closed
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Realized savings
// ---------------------------------------------------------------------------
export const realized_savings = pgTable('realized_savings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  action_id: text('action_id').notNull().references(() => recovery_actions.id).unique(),
  cycle_id: text('cycle_id').references(() => recovery_cycles.id),
  modeled_monthly: real('modeled_monthly').default(0),
  realized_monthly: real('realized_monthly').default(0),
  variance: real('variance').default(0),
  realized_at: timestamp('realized_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Ingestion runs
// ---------------------------------------------------------------------------
export const ingestion_runs = pgTable('ingestion_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  account_id: text('account_id').references(() => accounts.id),
  source: text('source').notNull(), // upload | sample
  rows_parsed: integer('rows_parsed').default(0),
  assets_upserted: integer('assets_upserted').default(0),
  errors: jsonb('errors').$type<string[]>().default([]),
  status: text('status').notNull().default('completed'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Tags (cost allocation dimension values)
// ---------------------------------------------------------------------------
export const tags = pgTable('tags', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.user_id, t.key, t.value)])

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------
export const saved_views = pgTable('saved_views', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  scope: text('scope').notNull().default('inventory'), // inventory | findings | worksheet
  filters: jsonb('filters').$type<Record<string, unknown>>().default({}),
  is_default: boolean('is_default').default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Alert rules + alerts
// ---------------------------------------------------------------------------
export const alert_rules = pgTable('alert_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  metric: text('metric').notNull(), // recoverable_above | orphan_age_above | policy_coverage_below
  threshold: real('threshold').notNull(),
  enabled: boolean('enabled').default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  rule_id: text('rule_id').references(() => alert_rules.id),
  message: text('message').notNull(),
  severity: text('severity').notNull().default('info'), // info | warning | critical
  value: real('value'),
  status: text('status').notNull().default('open'), // open | acknowledged | resolved
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------
export const activity_log = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id'),
  action: text('action').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  kind: text('kind').notNull().default('info'),
  link: text('link'),
  read: boolean('read').default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Workspace settings
// ---------------------------------------------------------------------------
export const workspace_settings = pgTable('workspace_settings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  default_currency: text('default_currency').notNull().default('USD'),
  fiscal_quarter_start: integer('fiscal_quarter_start').default(1), // month 1-12
  weight_savings: real('weight_savings').default(0.6),
  weight_effort: real('weight_effort').default(0.2),
  weight_risk: real('weight_risk').default(0.2),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------
export const plans = pgTable('plans', {
  id: text('id').primaryKey(), // 'free' | 'pro'
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
