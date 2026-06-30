import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import * as tables from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const ruleSchema = z.object({
  name: z.string().min(1),
  metric: z.enum(['recoverable_above', 'orphan_age_above', 'policy_coverage_below']),
  threshold: z.number(),
  enabled: z.boolean().optional().default(true),
})

const statusSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved']),
})

// ---------------------------------------------------------------------------
// GET / — alert feed
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? undefined
  const status = c.req.query('status') ?? undefined

  const conds = []
  if (userId) conds.push(eq(tables.alerts.user_id, userId))
  if (status) conds.push(eq(tables.alerts.status, status))

  const rows = await db
    .select()
    .from(tables.alerts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(tables.alerts.created_at))

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /rules — list alert rules
// ---------------------------------------------------------------------------
router.get('/rules', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? undefined

  const rows = userId
    ? await db
        .select()
        .from(tables.alert_rules)
        .where(eq(tables.alert_rules.user_id, userId))
        .orderBy(desc(tables.alert_rules.created_at))
    : await db.select().from(tables.alert_rules).orderBy(desc(tables.alert_rules.created_at))

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /rules — create rule
// ---------------------------------------------------------------------------
router.post('/rules', authMiddleware, zValidator('json', ruleSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [rule] = await db
    .insert(tables.alert_rules)
    .values({
      user_id: userId,
      name: body.name,
      metric: body.metric,
      threshold: body.threshold,
      enabled: body.enabled,
    })
    .returning()

  await db.insert(tables.activity_log).values({
    user_id: userId,
    entity_type: 'alert_rule',
    entity_id: rule.id,
    action: 'created',
    detail: { name: rule.name, metric: rule.metric, threshold: rule.threshold },
  })

  return c.json(rule, 201)
})

// ---------------------------------------------------------------------------
// PUT /rules/:id — update rule
// ---------------------------------------------------------------------------
router.put('/rules/:id', authMiddleware, zValidator('json', ruleSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(tables.alert_rules)
    .where(eq(tables.alert_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const [updated] = await db
    .update(tables.alert_rules)
    .set(body)
    .where(eq(tables.alert_rules.id, id))
    .returning()

  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /rules/:id — delete rule
// ---------------------------------------------------------------------------
router.delete('/rules/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(tables.alert_rules)
    .where(eq(tables.alert_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // detach alerts that referenced this rule, then delete the rule
  await db
    .update(tables.alerts)
    .set({ rule_id: null })
    .where(eq(tables.alerts.rule_id, id))
  await db.delete(tables.alert_rules).where(eq(tables.alert_rules.id, id))

  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// PUT /:id/status — acknowledge / resolve alert
// ---------------------------------------------------------------------------
router.put('/:id/status', authMiddleware, zValidator('json', statusSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(tables.alerts).where(eq(tables.alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const { status } = c.req.valid('json')
  const [updated] = await db
    .update(tables.alerts)
    .set({ status })
    .where(eq(tables.alerts.id, id))
    .returning()

  await db.insert(tables.activity_log).values({
    user_id: userId,
    entity_type: 'alert',
    entity_id: id,
    action: status,
    detail: { message: existing.message },
  })

  return c.json(updated)
})

export default router
