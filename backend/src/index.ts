import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  accounts,
  storage_assets,
  access_patterns,
  pricing_books,
  pricing_entries,
} from './db/schema.js'

// ---- domain route files (authored by other agents) ----
import accountsRoutes from './routes/accounts.js'
import assetsRoutes from './routes/assets.js'
import accessRoutes from './routes/access.js'
import pricingRoutes from './routes/pricing.js'
import mistierRoutes from './routes/mistier.js'
import snapshotsRoutes from './routes/snapshots.js'
import orphansRoutes from './routes/orphans.js'
import retentionRoutes from './routes/retention.js'
import lifecycleRoutes from './routes/lifecycle.js'
import worksheetRoutes from './routes/worksheet.js'
import realizedRoutes from './routes/realized.js'
import cyclesRoutes from './routes/cycles.js'
import analysisRoutes from './routes/analysis.js'
import forecastRoutes from './routes/forecast.js'
import dashboardRoutes from './routes/dashboard.js'
import reportsRoutes from './routes/reports.js'
import allocationRoutes from './routes/allocation.js'
import alertsRoutes from './routes/alerts.js'
import viewsRoutes from './routes/views.js'
import activityRoutes from './routes/activity.js'
import notificationsRoutes from './routes/notifications.js'
import settingsRoutes from './routes/settings.js'
import ingestRoutes from './routes/ingest.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://storage-tier-recovery-desk.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

// ---------------------------------------------------------------------------
// Idempotent seed (count-then-insert). Seeds billing plans + a small demo
// estate so the dashboard renders on first boot. Safe to run repeatedly.
// ---------------------------------------------------------------------------
async function seedIfEmpty() {
  // billing plans
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 2900 },
    ])
    console.log('Seeded plans')
  }

  // demo estate
  const existingAccounts = await db.select().from(accounts).limit(1)
  if (existingAccounts.length === 0) {
    const demoUser = 'demo'
    const [acct] = await db
      .insert(accounts)
      .values({
        user_id: demoUser,
        name: 'Demo AWS Production',
        provider: 'aws',
        account_ref: '000000000000',
        default_region: 'us-east-1',
        currency: 'USD',
        connection_method: 'sample',
        environment: 'prod',
        team: 'platform',
        cost_center: 'eng',
        status: 'active',
      })
      .returning()

    // pricing book + a couple of entries
    const [book] = await db
      .insert(pricing_books)
      .values({ user_id: demoUser, name: 'AWS S3 Default', version: 1, is_default: true, currency: 'USD' })
      .returning()
    await db.insert(pricing_entries).values([
      {
        user_id: demoUser,
        book_id: book.id,
        provider: 'aws',
        region: 'us-east-1',
        tier: 'hot',
        storage_per_gb_month: 0.023,
        retrieval_per_gb: 0,
        request_per_1k: 0.005,
        min_duration_days: 0,
        early_delete_penalty_per_gb: 0,
      },
      {
        user_id: demoUser,
        book_id: book.id,
        provider: 'aws',
        region: 'us-east-1',
        tier: 'cold',
        storage_per_gb_month: 0.004,
        retrieval_per_gb: 0.01,
        request_per_1k: 0.01,
        min_duration_days: 30,
        early_delete_penalty_per_gb: 0.004,
      },
      {
        user_id: demoUser,
        book_id: book.id,
        provider: 'aws',
        region: 'us-east-1',
        tier: 'archive',
        storage_per_gb_month: 0.00099,
        retrieval_per_gb: 0.02,
        request_per_1k: 0.025,
        min_duration_days: 90,
        early_delete_penalty_per_gb: 0.00099,
      },
    ])

    // a few assets + access patterns
    const demoAssets = [
      { name: 'logs-archive-bucket', asset_type: 'bucket', current_tier: 'hot', size_bytes: 2.2e12, monthly_cost: 50.6, reads: 0, days: 210, temp: 'frozen' },
      { name: 'analytics-exports', asset_type: 'bucket', current_tier: 'hot', size_bytes: 8.0e11, monthly_cost: 18.4, reads: 4, days: 95, temp: 'cold' },
      { name: 'app-db-vol-01', asset_type: 'volume', current_tier: 'hot', size_bytes: 5.0e11, monthly_cost: 40.0, reads: 9000, days: 0, temp: 'hot' },
      { name: 'detached-vol-legacy', asset_type: 'volume', current_tier: 'hot', size_bytes: 2.5e11, monthly_cost: 20.0, reads: 0, days: 400, temp: 'never' },
      { name: 'nightly-snap-2024-01', asset_type: 'snapshot', current_tier: 'cold', size_bytes: 1.2e11, monthly_cost: 4.8, reads: 0, days: 365, temp: 'frozen' },
    ]
    for (const a of demoAssets) {
      const [asset] = await db
        .insert(storage_assets)
        .values({
          user_id: demoUser,
          account_id: acct.id,
          name: a.name,
          asset_type: a.asset_type,
          provider: 'aws',
          region: 'us-east-1',
          current_tier: a.current_tier,
          size_bytes: a.size_bytes,
          object_count: 1000,
          monthly_cost: a.monthly_cost,
          attached: a.asset_type === 'volume' ? a.name !== 'detached-vol-legacy' : true,
          tags: { env: 'prod', team: 'platform' },
        })
        .returning()
      await db.insert(access_patterns).values({
        user_id: demoUser,
        asset_id: asset.id,
        reads_30d: a.reads,
        reads_90d: a.reads * 2,
        requests_30d: a.reads,
        retrieval_gb_30d: 0,
        days_since_access: a.days,
        temperature: a.temp,
        access_score: a.reads > 0 ? Math.min(1, a.reads / 10000) : 0,
      })
    }
    console.log('Seeded demo estate')
  }
}

const api = new Hono()
api.route('/accounts', accountsRoutes)
api.route('/assets', assetsRoutes)
api.route('/access', accessRoutes)
api.route('/pricing', pricingRoutes)
api.route('/mistier', mistierRoutes)
api.route('/snapshots', snapshotsRoutes)
api.route('/orphans', orphansRoutes)
api.route('/retention', retentionRoutes)
api.route('/lifecycle', lifecycleRoutes)
api.route('/worksheet', worksheetRoutes)
api.route('/realized', realizedRoutes)
api.route('/cycles', cyclesRoutes)
api.route('/analysis', analysisRoutes)
api.route('/forecast', forecastRoutes)
api.route('/dashboard', dashboardRoutes)
api.route('/reports', reportsRoutes)
api.route('/allocation', allocationRoutes)
api.route('/alerts', alertsRoutes)
api.route('/views', viewsRoutes)
api.route('/activity', activityRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/settings', settingsRoutes)
api.route('/ingest', ingestRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, THEN run migrate() + seed (each idempotent and in
// its own try/catch) so a slow/cold DB never blocks the port binding.
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
    console.log('Migration complete')
  } catch (e) {
    console.error('Migration error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
