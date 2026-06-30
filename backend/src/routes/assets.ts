import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { storage_assets, access_patterns, findings, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Public: list / filter inventory
// query: account_id, asset_type, tier, temperature
router.get('/', async (c) => {
  const account_id = c.req.query('account_id')
  const asset_type = c.req.query('asset_type')
  const tier = c.req.query('tier')
  const temperature = c.req.query('temperature')

  const conds = []
  if (account_id) conds.push(eq(storage_assets.account_id, account_id))
  if (asset_type) conds.push(eq(storage_assets.asset_type, asset_type))
  if (tier) conds.push(eq(storage_assets.current_tier, tier))

  const rows = conds.length
    ? await db
        .select()
        .from(storage_assets)
        .where(and(...conds))
        .orderBy(desc(storage_assets.monthly_cost))
    : await db.select().from(storage_assets).orderBy(desc(storage_assets.monthly_cost))

  // temperature lives on access_patterns; filter via join when requested
  if (temperature) {
    const patterns = await db.select().from(access_patterns)
    const tempByAsset = new Map(patterns.map((p) => [p.asset_id, p.temperature]))
    return c.json(rows.filter((r) => tempByAsset.get(r.id) === temperature))
  }

  return c.json(rows)
})

// Public: asset detail — joins access + findings
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [asset] = await db.select().from(storage_assets).where(eq(storage_assets.id, id))
  if (!asset) return c.json({ error: 'Not found' }, 404)
  const [access] = await db
    .select()
    .from(access_patterns)
    .where(eq(access_patterns.asset_id, id))
  const assetFindings = await db
    .select()
    .from(findings)
    .where(eq(findings.asset_id, id))
    .orderBy(desc(findings.created_at))
  return c.json({ asset, access: access ?? null, findings: assetFindings })
})

// Auth: update asset tags
const tagsSchema = z.object({
  tags: z.record(z.string(), z.string()),
})

router.put('/:id/tags', authMiddleware, zValidator('json', tagsSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(storage_assets).where(eq(storage_assets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const { tags } = c.req.valid('json')
  const [updated] = await db
    .update(storage_assets)
    .set({ tags })
    .where(eq(storage_assets.id, id))
    .returning()
  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'asset',
    entity_id: id,
    action: 'tags_updated',
    detail: { tags },
  })
  return c.json(updated)
})

// Auth: delete asset
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(storage_assets).where(eq(storage_assets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  // Remove dependent access pattern first (FK)
  await db.delete(access_patterns).where(eq(access_patterns.asset_id, id))
  await db.delete(storage_assets).where(eq(storage_assets.id, id))
  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'asset',
    entity_id: id,
    action: 'deleted',
    detail: { name: existing.name },
  })
  return c.json({ success: true })
})

export default router
