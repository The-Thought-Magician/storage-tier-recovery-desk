import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { saved_views, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const VALID_SCOPES = ['inventory', 'findings', 'worksheet'] as const

const viewSchema = z.object({
  name: z.string().min(1),
  scope: z.enum(VALID_SCOPES).default('inventory'),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
  is_default: z.boolean().optional().default(false),
})

// Public: list saved views, optionally filtered by scope
router.get('/', async (c) => {
  const scope = c.req.query('scope')
  const conds = []
  if (scope && (VALID_SCOPES as readonly string[]).includes(scope)) {
    conds.push(eq(saved_views.scope, scope))
  }
  const rows = conds.length
    ? await db.select().from(saved_views).where(and(...conds)).orderBy(desc(saved_views.created_at))
    : await db.select().from(saved_views).orderBy(desc(saved_views.created_at))
  return c.json(rows)
})

// Auth: create a saved view
router.post('/', authMiddleware, zValidator('json', viewSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // If marked default, clear any existing default for the same user+scope
  if (body.is_default) {
    await db
      .update(saved_views)
      .set({ is_default: false })
      .where(and(eq(saved_views.user_id, userId), eq(saved_views.scope, body.scope)))
  }

  const [view] = await db
    .insert(saved_views)
    .values({
      user_id: userId,
      name: body.name,
      scope: body.scope,
      filters: body.filters as Record<string, unknown>,
      is_default: body.is_default,
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'saved_view',
    entity_id: view.id,
    action: 'created',
    detail: { name: view.name, scope: view.scope },
  })

  return c.json(view, 201)
})

// Auth: update a saved view (ownership-checked)
router.put('/:id', authMiddleware, zValidator('json', viewSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(saved_views).where(eq(saved_views.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const scope = body.scope ?? existing.scope

  // Clearing existing default if this one is being promoted to default
  if (body.is_default) {
    await db
      .update(saved_views)
      .set({ is_default: false })
      .where(and(eq(saved_views.user_id, userId), eq(saved_views.scope, scope)))
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.scope !== undefined) patch.scope = body.scope
  if (body.filters !== undefined) patch.filters = body.filters
  if (body.is_default !== undefined) patch.is_default = body.is_default

  const [updated] = await db
    .update(saved_views)
    .set(patch)
    .where(eq(saved_views.id, id))
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'saved_view',
    entity_id: id,
    action: 'updated',
    detail: { name: updated.name, scope: updated.scope },
  })

  return c.json(updated)
})

// Auth: delete a saved view (ownership-checked)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(saved_views).where(eq(saved_views.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(saved_views).where(eq(saved_views.id, id))

  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'saved_view',
    entity_id: id,
    action: 'deleted',
    detail: { name: existing.name, scope: existing.scope },
  })

  return c.json({ success: true })
})

export default router
