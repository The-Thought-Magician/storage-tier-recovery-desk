import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { accounts, storage_assets, findings, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const accountSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(['aws', 'gcp', 'azure', 'other']),
  account_ref: z.string().optional().nullable(),
  default_region: z.string().optional().nullable(),
  currency: z.string().optional().default('USD'),
  connection_method: z.enum(['upload', 'connected', 'sample']).optional().default('sample'),
  environment: z.string().optional().nullable(),
  team: z.string().optional().nullable(),
  cost_center: z.string().optional().nullable(),
  status: z.enum(['active', 'archived']).optional().default('active'),
})

// Public: list accounts
router.get('/', async (c) => {
  const all = await db.select().from(accounts).orderBy(desc(accounts.created_at))
  return c.json(all)
})

// Public: multi-account rollup — total spend / recoverable, by provider
router.get('/rollup', async (c) => {
  const allAccounts = await db.select().from(accounts)
  const allAssets = await db.select().from(storage_assets)
  const allFindings = await db.select().from(findings)

  const accountById = new Map(allAccounts.map((a) => [a.id, a]))

  let total_spend = 0
  for (const asset of allAssets) total_spend += asset.monthly_cost ?? 0

  let total_recoverable = 0
  for (const f of allFindings) total_recoverable += f.monthly_savings ?? 0

  // by_provider: spend + recoverable grouped by account provider
  const providerMap = new Map<
    string,
    { provider: string; spend: number; recoverable: number; account_count: number; asset_count: number }
  >()
  for (const a of allAccounts) {
    if (!providerMap.has(a.provider)) {
      providerMap.set(a.provider, {
        provider: a.provider,
        spend: 0,
        recoverable: 0,
        account_count: 0,
        asset_count: 0,
      })
    }
    providerMap.get(a.provider)!.account_count += 1
  }
  for (const asset of allAssets) {
    const acct = accountById.get(asset.account_id)
    const provider = acct?.provider ?? asset.provider ?? 'other'
    if (!providerMap.has(provider)) {
      providerMap.set(provider, {
        provider,
        spend: 0,
        recoverable: 0,
        account_count: 0,
        asset_count: 0,
      })
    }
    const row = providerMap.get(provider)!
    row.spend += asset.monthly_cost ?? 0
    row.asset_count += 1
  }
  for (const f of allFindings) {
    const acct = f.account_id ? accountById.get(f.account_id) : undefined
    const provider = acct?.provider ?? 'other'
    if (!providerMap.has(provider)) {
      providerMap.set(provider, {
        provider,
        spend: 0,
        recoverable: 0,
        account_count: 0,
        asset_count: 0,
      })
    }
    providerMap.get(provider)!.recoverable += f.monthly_savings ?? 0
  }

  const by_provider = [...providerMap.values()].sort((a, b) => b.spend - a.spend)

  return c.json({
    total_spend,
    total_recoverable,
    account_count: allAccounts.length,
    by_provider,
  })
})

// Public: account detail
router.get('/:id', async (c) => {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, c.req.param('id')))
  if (!a) return c.json({ error: 'Not found' }, 404)
  return c.json(a)
})

// Auth: create account
router.post('/', authMiddleware, zValidator('json', accountSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(accounts)
    .values({
      user_id: userId,
      name: body.name,
      provider: body.provider,
      account_ref: body.account_ref ?? null,
      default_region: body.default_region ?? null,
      currency: body.currency ?? 'USD',
      connection_method: body.connection_method ?? 'sample',
      environment: body.environment ?? null,
      team: body.team ?? null,
      cost_center: body.cost_center ?? null,
      status: body.status ?? 'active',
    })
    .returning()
  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'account',
    entity_id: created.id,
    action: 'created',
    detail: { name: created.name, provider: created.provider },
  })
  return c.json(created, 201)
})

// Auth: update account
router.put('/:id', authMiddleware, zValidator('json', accountSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(accounts).where(eq(accounts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(accounts)
    .set({ ...body, updated_at: new Date() })
    .where(eq(accounts.id, id))
    .returning()
  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'account',
    entity_id: id,
    action: 'updated',
    detail: { ...body },
  })
  return c.json(updated)
})

// Auth: delete account
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(accounts).where(eq(accounts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(accounts).where(eq(accounts.id, id))
  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'account',
    entity_id: id,
    action: 'deleted',
    detail: { name: existing.name },
  })
  return c.json({ success: true })
})

export default router
