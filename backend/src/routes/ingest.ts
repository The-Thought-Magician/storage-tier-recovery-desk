import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  accounts,
  storage_assets,
  access_patterns,
  pricing_books,
  pricing_entries,
  ingestion_runs,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const TIERS = ['hot', 'warm', 'cold', 'archive', 'deep-archive'] as const
const ASSET_TYPES = ['bucket', 'volume', 'snapshot', 'backup', 'multipart'] as const
const TEMPERATURES = ['hot', 'warm', 'cold', 'frozen', 'never'] as const

// ---------------------------------------------------------------------------
// Temperature / access-score derivation (mirrors access enrichment logic)
// ---------------------------------------------------------------------------
function deriveTemperature(daysSinceAccess: number | null, reads30d: number): typeof TEMPERATURES[number] {
  if (daysSinceAccess === null) return 'never'
  if (daysSinceAccess <= 7 || reads30d >= 100) return 'hot'
  if (daysSinceAccess <= 30 || reads30d >= 10) return 'warm'
  if (daysSinceAccess <= 90) return 'cold'
  if (daysSinceAccess <= 365) return 'frozen'
  return 'never'
}

function accessScore(reads30d: number, reads90d: number, daysSinceAccess: number | null): number {
  const recency = daysSinceAccess === null ? 0 : Math.max(0, 1 - daysSinceAccess / 365)
  const volume = Math.min(1, (reads30d + reads90d / 3) / 200)
  return Math.round((0.6 * recency + 0.4 * volume) * 1000) / 1000
}

// ---------------------------------------------------------------------------
// GET /runs — ingestion run ledger (public read)
// ---------------------------------------------------------------------------
router.get('/runs', async (c) => {
  const accountId = c.req.query('account_id')
  const rows = accountId
    ? await db
        .select()
        .from(ingestion_runs)
        .where(eq(ingestion_runs.account_id, accountId))
        .orderBy(desc(ingestion_runs.created_at))
    : await db.select().from(ingestion_runs).orderBy(desc(ingestion_runs.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /upload — ingest parsed rows (assets + access) into an account
// ---------------------------------------------------------------------------
const assetRowSchema = z.object({
  external_id: z.string().optional(),
  name: z.string().min(1),
  asset_type: z.enum(ASSET_TYPES),
  provider: z.string().optional(),
  region: z.string().optional(),
  current_tier: z.enum(TIERS).optional().default('hot'),
  size_bytes: z.number().nonnegative().optional().default(0),
  object_count: z.number().int().nonnegative().optional().default(0),
  monthly_cost: z.number().nonnegative().optional().default(0),
  source_asset_id: z.string().optional(),
  is_incremental: z.boolean().optional(),
  attached: z.boolean().optional(),
  detached_since: z.string().optional(),
  asset_created_at: z.string().optional(),
  last_modified_at: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // optional inline access pattern for this asset
  access: z
    .object({
      reads_30d: z.number().int().nonnegative().optional(),
      reads_90d: z.number().int().nonnegative().optional(),
      requests_30d: z.number().int().nonnegative().optional(),
      retrieval_gb_30d: z.number().nonnegative().optional(),
      last_access_at: z.string().optional(),
      days_since_access: z.number().int().nonnegative().optional(),
    })
    .optional(),
})

const uploadSchema = z.object({
  account_id: z.string().min(1),
  source: z.string().optional().default('upload'),
  rows: z.array(assetRowSchema).min(1),
})

router.post('/upload', authMiddleware, zValidator('json', uploadSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Ownership: account must belong to the user.
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, body.account_id), eq(accounts.user_id, userId)))
  if (!account) return c.json({ error: 'Account not found' }, 404)

  const errors: string[] = []
  let upserted = 0

  for (let i = 0; i < body.rows.length; i++) {
    const row = body.rows[i]
    try {
      // Match an existing asset by external_id (preferred) or name within the account.
      const existingMatches = await db
        .select()
        .from(storage_assets)
        .where(and(eq(storage_assets.user_id, userId), eq(storage_assets.account_id, body.account_id)))
      const existing = existingMatches.find((a) =>
        row.external_id ? a.external_id === row.external_id : a.name === row.name,
      )

      const assetValues = {
        user_id: userId,
        account_id: body.account_id,
        external_id: row.external_id ?? null,
        name: row.name,
        asset_type: row.asset_type,
        provider: row.provider ?? account.provider,
        region: row.region ?? account.default_region ?? null,
        current_tier: row.current_tier,
        size_bytes: row.size_bytes,
        object_count: row.object_count,
        monthly_cost: row.monthly_cost,
        source_asset_id: row.source_asset_id ?? null,
        is_incremental: row.is_incremental ?? false,
        attached: row.attached ?? true,
        detached_since: row.detached_since ? new Date(row.detached_since) : null,
        asset_created_at: row.asset_created_at ? new Date(row.asset_created_at) : null,
        last_modified_at: row.last_modified_at ? new Date(row.last_modified_at) : null,
        tags: row.tags ?? {},
        metadata: row.metadata ?? {},
      }

      let assetId: string
      if (existing) {
        const [updated] = await db
          .update(storage_assets)
          .set(assetValues)
          .where(eq(storage_assets.id, existing.id))
          .returning()
        assetId = updated.id
      } else {
        const [created] = await db.insert(storage_assets).values(assetValues).returning()
        assetId = created.id
      }

      // Upsert access pattern when supplied.
      if (row.access) {
        const reads30d = row.access.reads_30d ?? 0
        const reads90d = row.access.reads_90d ?? 0
        const days = row.access.days_since_access ?? null
        const temperature = deriveTemperature(days, reads30d)
        const score = accessScore(reads30d, reads90d, days)
        const accessValues = {
          user_id: userId,
          asset_id: assetId,
          reads_30d: reads30d,
          reads_90d: reads90d,
          requests_30d: row.access.requests_30d ?? 0,
          retrieval_gb_30d: row.access.retrieval_gb_30d ?? 0,
          last_access_at: row.access.last_access_at ? new Date(row.access.last_access_at) : null,
          days_since_access: days,
          temperature,
          access_score: score,
        }
        await db
          .insert(access_patterns)
          .values(accessValues)
          .onConflictDoUpdate({ target: access_patterns.asset_id, set: accessValues })
      }

      upserted++
    } catch (e) {
      errors.push(`Row ${i} (${row.name}): ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const [run] = await db
    .insert(ingestion_runs)
    .values({
      user_id: userId,
      account_id: body.account_id,
      source: body.source ?? 'upload',
      rows_parsed: body.rows.length,
      assets_upserted: upserted,
      errors,
      status: errors.length === 0 ? 'completed' : 'completed_with_errors',
    })
    .returning()

  await db
    .update(accounts)
    .set({ last_ingest_at: new Date(), updated_at: new Date() })
    .where(eq(accounts.id, body.account_id))

  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'ingestion_run',
    entity_id: run.id,
    action: 'upload',
    detail: { account_id: body.account_id, rows_parsed: body.rows.length, assets_upserted: upserted },
  })

  return c.json({ run, assets_upserted: upserted }, 201)
})

// ---------------------------------------------------------------------------
// POST /seed — generate a sample estate (accounts, assets, access, pricing)
// ---------------------------------------------------------------------------
const seedSchema = z.object({
  account_name: z.string().min(1).optional(),
  provider: z.enum(['aws', 'gcp', 'azure', 'other']).optional().default('aws'),
  region: z.string().optional().default('us-east-1'),
})

const SAMPLE_PRICING: Array<{
  provider: string
  region: string
  tier: string
  storage_per_gb_month: number
  retrieval_per_gb: number
  request_per_1k: number
  min_duration_days: number
  early_delete_penalty_per_gb: number
}> = [
  { provider: 'aws', region: 'us-east-1', tier: 'hot', storage_per_gb_month: 0.023, retrieval_per_gb: 0, request_per_1k: 0.0004, min_duration_days: 0, early_delete_penalty_per_gb: 0 },
  { provider: 'aws', region: 'us-east-1', tier: 'warm', storage_per_gb_month: 0.0125, retrieval_per_gb: 0.01, request_per_1k: 0.001, min_duration_days: 30, early_delete_penalty_per_gb: 0.0125 },
  { provider: 'aws', region: 'us-east-1', tier: 'cold', storage_per_gb_month: 0.004, retrieval_per_gb: 0.01, request_per_1k: 0.001, min_duration_days: 90, early_delete_penalty_per_gb: 0.012 },
  { provider: 'aws', region: 'us-east-1', tier: 'archive', storage_per_gb_month: 0.0036, retrieval_per_gb: 0.02, request_per_1k: 0.05, min_duration_days: 90, early_delete_penalty_per_gb: 0.0108 },
  { provider: 'aws', region: 'us-east-1', tier: 'deep-archive', storage_per_gb_month: 0.00099, retrieval_per_gb: 0.02, request_per_1k: 0.1, min_duration_days: 180, early_delete_penalty_per_gb: 0.00594 },
]

const GIB = 1024 * 1024 * 1024

// Deterministic-ish sample assets describing recovery opportunities.
const SAMPLE_ASSETS: Array<{
  external_id: string
  name: string
  asset_type: typeof ASSET_TYPES[number]
  current_tier: typeof TIERS[number]
  size_gb: number
  object_count: number
  source_external_id?: string
  is_incremental?: boolean
  attached?: boolean
  detached_days_ago?: number
  created_days_ago: number
  modified_days_ago: number
  tags: Record<string, string>
  access: { reads_30d: number; reads_90d: number; requests_30d: number; retrieval_gb_30d: number; days_since_access: number | null }
}> = [
  // Mis-tier: large hot bucket nobody reads -> should be cold/archive.
  { external_id: 'arn:s3:logs-archive', name: 'logs-archive-2021', asset_type: 'bucket', current_tier: 'hot', size_gb: 4096, object_count: 1_200_000, created_days_ago: 1400, modified_days_ago: 500, tags: { team: 'platform', env: 'prod' }, access: { reads_30d: 0, reads_90d: 2, requests_30d: 0, retrieval_gb_30d: 0, days_since_access: 410 } },
  // Mis-tier: warm bucket cold in practice.
  { external_id: 'arn:s3:analytics-raw', name: 'analytics-raw', asset_type: 'bucket', current_tier: 'warm', size_gb: 2048, object_count: 800_000, created_days_ago: 800, modified_days_ago: 200, tags: { team: 'data', env: 'prod' }, access: { reads_30d: 1, reads_90d: 4, requests_30d: 3, retrieval_gb_30d: 0.5, days_since_access: 120 } },
  // Genuinely hot, correctly tiered (no finding expected).
  { external_id: 'arn:s3:app-assets', name: 'app-assets-cdn', asset_type: 'bucket', current_tier: 'hot', size_gb: 256, object_count: 50_000, created_days_ago: 300, modified_days_ago: 1, tags: { team: 'web', env: 'prod' }, access: { reads_30d: 540, reads_90d: 1600, requests_30d: 9000, retrieval_gb_30d: 80, days_since_access: 0 } },
  // Detached / orphaned volume.
  { external_id: 'vol-0abc123orphan', name: 'old-db-volume', asset_type: 'volume', current_tier: 'hot', size_gb: 512, object_count: 0, attached: false, detached_days_ago: 95, created_days_ago: 700, modified_days_ago: 95, tags: { team: 'platform' }, access: { reads_30d: 0, reads_90d: 0, requests_30d: 0, retrieval_gb_30d: 0, days_since_access: null } },
  // Snapshot chain: base + incrementals, several redundant/stale.
  { external_id: 'snap-base-2022', name: 'db-snapshot-base', asset_type: 'snapshot', current_tier: 'warm', size_gb: 512, object_count: 0, source_external_id: 'vol-0abc123orphan', is_incremental: false, created_days_ago: 600, modified_days_ago: 600, tags: { team: 'platform' }, access: { reads_30d: 0, reads_90d: 0, requests_30d: 0, retrieval_gb_30d: 0, days_since_access: 600 } },
  { external_id: 'snap-inc-1', name: 'db-snapshot-inc-1', asset_type: 'snapshot', current_tier: 'warm', size_gb: 48, object_count: 0, source_external_id: 'vol-0abc123orphan', is_incremental: true, created_days_ago: 400, modified_days_ago: 400, tags: { team: 'platform' }, access: { reads_30d: 0, reads_90d: 0, requests_30d: 0, retrieval_gb_30d: 0, days_since_access: 400 } },
  { external_id: 'snap-inc-2', name: 'db-snapshot-inc-2', asset_type: 'snapshot', current_tier: 'warm', size_gb: 52, object_count: 0, source_external_id: 'vol-0abc123orphan', is_incremental: true, created_days_ago: 380, modified_days_ago: 380, tags: { team: 'platform' }, access: { reads_30d: 0, reads_90d: 0, requests_30d: 0, retrieval_gb_30d: 0, days_since_access: 380 } },
  // Old backup that should be pruned per retention.
  { external_id: 'backup-fy21', name: 'fy21-full-backup', asset_type: 'backup', current_tier: 'cold', size_gb: 1024, object_count: 0, created_days_ago: 1200, modified_days_ago: 1200, tags: { team: 'finance', env: 'prod' }, access: { reads_30d: 0, reads_90d: 0, requests_30d: 0, retrieval_gb_30d: 0, days_since_access: 1200 } },
  // Abandoned multipart upload.
  { external_id: 'mpu-abandoned-01', name: 'incomplete-upload', asset_type: 'multipart', current_tier: 'hot', size_gb: 18, object_count: 1, created_days_ago: 60, modified_days_ago: 60, tags: {}, access: { reads_30d: 0, reads_90d: 0, requests_30d: 0, retrieval_gb_30d: 0, days_since_access: null } },
  // Untagged warm bucket (allocation gap).
  { external_id: 'arn:s3:misc-untagged', name: 'misc-untagged', asset_type: 'bucket', current_tier: 'warm', size_gb: 320, object_count: 120_000, created_days_ago: 200, modified_days_ago: 40, tags: {}, access: { reads_30d: 6, reads_90d: 20, requests_30d: 40, retrieval_gb_30d: 2, days_since_access: 45 } },
]

router.post('/seed', authMiddleware, zValidator('json', seedSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const provider = body.provider
  const region = body.region
  const accountName = body.account_name ?? 'Sample Estate'

  // 1. Account.
  const [account] = await db
    .insert(accounts)
    .values({
      user_id: userId,
      name: accountName,
      provider,
      account_ref: `sample-${Date.now()}`,
      default_region: region,
      connection_method: 'sample',
      environment: 'prod',
      team: 'platform',
      status: 'active',
      last_ingest_at: new Date(),
    })
    .returning()

  // 2. Pricing book + entries (default book if the user has none).
  const existingBooks = await db
    .select()
    .from(pricing_books)
    .where(eq(pricing_books.user_id, userId))
  let book = existingBooks.find((b) => b.is_default) ?? existingBooks[0]
  if (!book) {
    const [created] = await db
      .insert(pricing_books)
      .values({ user_id: userId, name: 'Sample Pricing (AWS S3)', version: 1, is_default: true })
      .returning()
    book = created
    for (const p of SAMPLE_PRICING) {
      await db
        .insert(pricing_entries)
        .values({ user_id: userId, book_id: book.id, ...p })
        .onConflictDoNothing()
    }
  }

  // 3. Assets + access patterns. Resolve snapshot/backup source ids after insert.
  const externalToId = new Map<string, string>()
  let assetsCreated = 0

  // First pass: insert all assets (without resolving source linkage).
  const insertedRows: Array<{ id: string; def: typeof SAMPLE_ASSETS[number] }> = []
  for (const def of SAMPLE_ASSETS) {
    const now = Date.now()
    const detachedSince =
      def.detached_days_ago != null ? new Date(now - def.detached_days_ago * 86_400_000) : null
    const assetCreatedAt = new Date(now - def.created_days_ago * 86_400_000)
    const lastModifiedAt = new Date(now - def.modified_days_ago * 86_400_000)
    const sizeBytes = def.size_gb * GIB
    const pricing = SAMPLE_PRICING.find((p) => p.tier === def.current_tier)
    const monthlyCost = pricing ? Math.round(def.size_gb * pricing.storage_per_gb_month * 100) / 100 : 0

    const [asset] = await db
      .insert(storage_assets)
      .values({
        user_id: userId,
        account_id: account.id,
        external_id: def.external_id,
        name: def.name,
        asset_type: def.asset_type,
        provider,
        region,
        current_tier: def.current_tier,
        size_bytes: sizeBytes,
        object_count: def.object_count,
        monthly_cost: monthlyCost,
        is_incremental: def.is_incremental ?? false,
        attached: def.attached ?? true,
        detached_since: detachedSince,
        asset_created_at: assetCreatedAt,
        last_modified_at: lastModifiedAt,
        tags: def.tags,
        metadata: {},
      })
      .returning()
    externalToId.set(def.external_id, asset.id)
    insertedRows.push({ id: asset.id, def })
    assetsCreated++

    // Access pattern.
    const a = def.access
    const temperature = deriveTemperature(a.days_since_access, a.reads_30d)
    const score = accessScore(a.reads_30d, a.reads_90d, a.days_since_access)
    await db
      .insert(access_patterns)
      .values({
        user_id: userId,
        asset_id: asset.id,
        reads_30d: a.reads_30d,
        reads_90d: a.reads_90d,
        requests_30d: a.requests_30d,
        retrieval_gb_30d: a.retrieval_gb_30d,
        last_access_at:
          a.days_since_access != null ? new Date(now - a.days_since_access * 86_400_000) : null,
        days_since_access: a.days_since_access,
        temperature,
        access_score: score,
      })
      .onConflictDoUpdate({
        target: access_patterns.asset_id,
        set: { temperature, access_score: score },
      })
  }

  // Second pass: link source_asset_id for snapshots/backups.
  for (const { id, def } of insertedRows) {
    if (def.source_external_id) {
      const sourceId = externalToId.get(def.source_external_id)
      if (sourceId) {
        await db
          .update(storage_assets)
          .set({ source_asset_id: sourceId })
          .where(eq(storage_assets.id, id))
      }
    }
  }

  // 4. Ledger row.
  const [run] = await db
    .insert(ingestion_runs)
    .values({
      user_id: userId,
      account_id: account.id,
      source: 'sample',
      rows_parsed: SAMPLE_ASSETS.length,
      assets_upserted: assetsCreated,
      errors: [],
      status: 'completed',
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'account',
    entity_id: account.id,
    action: 'seed_sample',
    detail: { assets: assetsCreated },
  })

  return c.json({ run, accounts: [account], assets: assetsCreated }, 201)
})

export default router
