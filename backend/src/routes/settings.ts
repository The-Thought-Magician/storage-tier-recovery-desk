import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspace_settings, activity_log } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Ensure a settings row exists for the user; create the default on first access.
async function ensureSettings(userId: string) {
  const [existing] = await db
    .select()
    .from(workspace_settings)
    .where(eq(workspace_settings.user_id, userId))
  if (existing) return existing
  const [created] = await db
    .insert(workspace_settings)
    .values({ user_id: userId })
    .returning()
  return created
}

const settingsSchema = z.object({
  default_currency: z.string().min(1).max(8).optional(),
  fiscal_quarter_start: z.number().int().min(1).max(12).optional(),
  weight_savings: z.number().min(0).max(1).optional(),
  weight_effort: z.number().min(0).max(1).optional(),
  weight_risk: z.number().min(0).max(1).optional(),
})

// GET / — workspace settings (creates default on first read)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const settings = await ensureSettings(userId)
  return c.json(settings)
})

// PUT / — update settings + scoring weights
router.put('/', authMiddleware, zValidator('json', settingsSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Make sure the row exists before updating.
  await ensureSettings(userId)

  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.default_currency !== undefined) patch.default_currency = body.default_currency
  if (body.fiscal_quarter_start !== undefined) patch.fiscal_quarter_start = body.fiscal_quarter_start
  if (body.weight_savings !== undefined) patch.weight_savings = body.weight_savings
  if (body.weight_effort !== undefined) patch.weight_effort = body.weight_effort
  if (body.weight_risk !== undefined) patch.weight_risk = body.weight_risk

  const [updated] = await db
    .update(workspace_settings)
    .set(patch)
    .where(eq(workspace_settings.user_id, userId))
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'workspace_settings',
    entity_id: updated.id,
    action: 'update',
    detail: body as Record<string, unknown>,
  })

  return c.json(updated)
})

export default router
