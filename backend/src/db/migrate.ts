import { db } from './index.js'
import { sql } from 'drizzle-orm'

// Idempotent self-provisioning migration. Runs CREATE TABLE IF NOT EXISTS for
// every table in schema.ts (column names/types/PK/FK/UNIQUE match exactly),
// then creates supporting indexes on FKs and user_id/account_id.
export async function migrate() {
  const statements: string[] = [
    // accounts
    `CREATE TABLE IF NOT EXISTS accounts (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      name text NOT NULL,
      provider text NOT NULL,
      account_ref text,
      default_region text,
      currency text NOT NULL DEFAULT 'USD',
      connection_method text NOT NULL DEFAULT 'sample',
      environment text,
      team text,
      cost_center text,
      status text NOT NULL DEFAULT 'active',
      last_ingest_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,

    // storage_assets
    `CREATE TABLE IF NOT EXISTS storage_assets (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      account_id text NOT NULL REFERENCES accounts(id),
      external_id text,
      name text NOT NULL,
      asset_type text NOT NULL,
      provider text NOT NULL,
      region text,
      current_tier text NOT NULL,
      size_bytes real NOT NULL DEFAULT 0,
      object_count integer DEFAULT 0,
      monthly_cost real NOT NULL DEFAULT 0,
      source_asset_id text,
      is_incremental boolean DEFAULT false,
      attached boolean DEFAULT true,
      detached_since timestamptz,
      asset_created_at timestamptz,
      last_modified_at timestamptz,
      tags jsonb DEFAULT '{}'::jsonb,
      metadata jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // access_patterns
    `CREATE TABLE IF NOT EXISTS access_patterns (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      asset_id text NOT NULL UNIQUE REFERENCES storage_assets(id),
      reads_30d integer DEFAULT 0,
      reads_90d integer DEFAULT 0,
      requests_30d integer DEFAULT 0,
      retrieval_gb_30d real DEFAULT 0,
      last_access_at timestamptz,
      days_since_access integer,
      temperature text NOT NULL DEFAULT 'warm',
      access_score real DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // pricing_books
    `CREATE TABLE IF NOT EXISTS pricing_books (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      name text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      is_default boolean DEFAULT false,
      currency text NOT NULL DEFAULT 'USD',
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // pricing_entries
    `CREATE TABLE IF NOT EXISTS pricing_entries (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      book_id text NOT NULL REFERENCES pricing_books(id),
      provider text NOT NULL,
      region text NOT NULL,
      tier text NOT NULL,
      storage_per_gb_month real NOT NULL DEFAULT 0,
      retrieval_per_gb real DEFAULT 0,
      request_per_1k real DEFAULT 0,
      min_duration_days integer DEFAULT 0,
      early_delete_penalty_per_gb real DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (book_id, provider, region, tier)
    )`,

    // retention_policies
    `CREATE TABLE IF NOT EXISTS retention_policies (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      name text NOT NULL,
      scope_type text NOT NULL DEFAULT 'account',
      scope_value text,
      max_age_days integer,
      transition_after_days integer,
      transition_to_tier text,
      delete_after_days integer,
      enabled boolean DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,

    // lifecycle_models
    `CREATE TABLE IF NOT EXISTS lifecycle_models (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      account_id text REFERENCES accounts(id),
      name text NOT NULL,
      rules jsonb DEFAULT '[]'::jsonb,
      simulated_monthly_savings real DEFAULT 0,
      simulated_assets_affected integer DEFAULT 0,
      simulated_data_moved_gb real DEFAULT 0,
      last_simulated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // analysis_runs
    `CREATE TABLE IF NOT EXISTS analysis_runs (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      account_id text REFERENCES accounts(id),
      pricing_book_id text REFERENCES pricing_books(id),
      status text NOT NULL DEFAULT 'completed',
      findings_count integer DEFAULT 0,
      total_recoverable_monthly real DEFAULT 0,
      summary jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // findings
    `CREATE TABLE IF NOT EXISTS findings (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      run_id text REFERENCES analysis_runs(id),
      account_id text REFERENCES accounts(id),
      asset_id text REFERENCES storage_assets(id),
      finding_type text NOT NULL,
      title text NOT NULL,
      detail text,
      recommended_action text,
      target_tier text,
      monthly_savings real NOT NULL DEFAULT 0,
      annual_savings real NOT NULL DEFAULT 0,
      effort_score integer DEFAULT 1,
      risk_score integer DEFAULT 1,
      priority_score real DEFAULT 0,
      confidence real DEFAULT 1,
      pricing_book_version integer,
      metadata jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // recovery_cycles (before recovery_actions due to FK)
    `CREATE TABLE IF NOT EXISTS recovery_cycles (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      name text NOT NULL,
      target_monthly_savings real DEFAULT 0,
      start_date timestamptz,
      end_date timestamptz,
      status text NOT NULL DEFAULT 'open',
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // recovery_actions
    `CREATE TABLE IF NOT EXISTS recovery_actions (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      finding_id text REFERENCES findings(id),
      account_id text REFERENCES accounts(id),
      asset_id text REFERENCES storage_assets(id),
      cycle_id text REFERENCES recovery_cycles(id),
      action_type text NOT NULL,
      title text NOT NULL,
      monthly_savings real NOT NULL DEFAULT 0,
      annual_savings real NOT NULL DEFAULT 0,
      effort_score integer DEFAULT 1,
      risk_score integer DEFAULT 1,
      priority_score real DEFAULT 0,
      owner text,
      status text NOT NULL DEFAULT 'proposed',
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,

    // realized_savings
    `CREATE TABLE IF NOT EXISTS realized_savings (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      action_id text NOT NULL UNIQUE REFERENCES recovery_actions(id),
      cycle_id text REFERENCES recovery_cycles(id),
      modeled_monthly real DEFAULT 0,
      realized_monthly real DEFAULT 0,
      variance real DEFAULT 0,
      realized_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // ingestion_runs
    `CREATE TABLE IF NOT EXISTS ingestion_runs (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      account_id text REFERENCES accounts(id),
      source text NOT NULL,
      rows_parsed integer DEFAULT 0,
      assets_upserted integer DEFAULT 0,
      errors jsonb DEFAULT '[]'::jsonb,
      status text NOT NULL DEFAULT 'completed',
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // tags
    `CREATE TABLE IF NOT EXISTS tags (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      key text NOT NULL,
      value text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, key, value)
    )`,

    // saved_views
    `CREATE TABLE IF NOT EXISTS saved_views (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      name text NOT NULL,
      scope text NOT NULL DEFAULT 'inventory',
      filters jsonb DEFAULT '{}'::jsonb,
      is_default boolean DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // alert_rules
    `CREATE TABLE IF NOT EXISTS alert_rules (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      name text NOT NULL,
      metric text NOT NULL,
      threshold real NOT NULL,
      enabled boolean DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // alerts
    `CREATE TABLE IF NOT EXISTS alerts (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      rule_id text REFERENCES alert_rules(id),
      message text NOT NULL,
      severity text NOT NULL DEFAULT 'info',
      value real,
      status text NOT NULL DEFAULT 'open',
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // activity_log
    `CREATE TABLE IF NOT EXISTS activity_log (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      entity_type text NOT NULL,
      entity_id text,
      action text NOT NULL,
      detail jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // notifications
    `CREATE TABLE IF NOT EXISTS notifications (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      title text NOT NULL,
      body text,
      kind text NOT NULL DEFAULT 'info',
      link text,
      read boolean DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // workspace_settings
    `CREATE TABLE IF NOT EXISTS workspace_settings (
      id text PRIMARY KEY,
      user_id text NOT NULL UNIQUE,
      default_currency text NOT NULL DEFAULT 'USD',
      fiscal_quarter_start integer DEFAULT 1,
      weight_savings real DEFAULT 0.6,
      weight_effort real DEFAULT 0.2,
      weight_risk real DEFAULT 0.2,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,

    // plans
    `CREATE TABLE IF NOT EXISTS plans (
      id text PRIMARY KEY,
      name text NOT NULL,
      price_cents integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,

    // subscriptions
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id text PRIMARY KEY,
      user_id text NOT NULL UNIQUE,
      plan_id text NOT NULL DEFAULT 'free',
      stripe_customer_id text,
      stripe_subscription_id text,
      status text NOT NULL DEFAULT 'active',
      current_period_end timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,

    // ---- indexes ----
    `CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_assets_user ON storage_assets(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_assets_account ON storage_assets(account_id)`,
    `CREATE INDEX IF NOT EXISTS idx_assets_type ON storage_assets(asset_type)`,
    `CREATE INDEX IF NOT EXISTS idx_access_asset ON access_patterns(asset_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pricing_entries_book ON pricing_entries(book_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pricing_books_user ON pricing_books(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_retention_user ON retention_policies(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lifecycle_account ON lifecycle_models(account_id)`,
    `CREATE INDEX IF NOT EXISTS idx_analysis_user ON analysis_runs(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id)`,
    `CREATE INDEX IF NOT EXISTS idx_findings_asset ON findings(asset_id)`,
    `CREATE INDEX IF NOT EXISTS idx_findings_user ON findings(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_actions_finding ON recovery_actions(finding_id)`,
    `CREATE INDEX IF NOT EXISTS idx_actions_cycle ON recovery_actions(cycle_id)`,
    `CREATE INDEX IF NOT EXISTS idx_actions_user ON recovery_actions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cycles_user ON recovery_cycles(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_realized_action ON realized_savings(action_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ingestion_account ON ingestion_runs(account_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_alert_rules_user ON alert_rules(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
  ]

  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
}
