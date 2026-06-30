import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  recovery_cycles,
  recovery_actions,
  realized_savings,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function logActivity(
  userId: string,
  entityId: string,
  action: string,
  detail: Record<string, unknown>,
) {
  try {
    await db.insert(activity_log).values({
      user_id: userId,
      entity_type: 'recovery_cycle',
      entity_id: entityId,
      action,
      detail,
    })
  } catch {
    // best-effort
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Compute progress for a cycle from its actions + realized records.
 */
function computeProgress(
  cycle: { target_monthly_savings: number | null },
  actions: Array<{ status: string | null; monthly_savings: number | null }>,
  realized: Array<{ realized_monthly: number | null; modeled_monthly: number | null }>,
) {
  const target = cycle.target_monthly_savings ?? 0
  const action_count = actions.length
  const done_count = actions.filter((a) => a.status === 'done').length
  const dismissed_count = actions.filter((a) => a.status === 'dismissed').length

  const planned_monthly = actions
    .filter((a) => a.status !== 'dismissed')
    .reduce((s, a) => s + (a.monthly_savings ?? 0), 0)
  const realized_monthly = realized.reduce((s, r) => s + (r.realized_monthly ?? 0), 0)
  const modeled_monthly = realized.reduce((s, r) => s + (r.modeled_monthly ?? 0), 0)

  const completion_pct = action_count > 0 ? round2((done_count / action_count) * 100) : 0
  const target_attainment_pct = target > 0 ? round2((realized_monthly / target) * 100) : 0

  return {
    target_monthly: round2(target),
    action_count,
    done_count,
    dismissed_count,
    planned_monthly: round2(planned_monthly),
    realized_monthly: round2(realized_monthly),
    modeled_monthly: round2(modeled_monthly),
    variance: round2(realized_monthly - modeled_monthly),
    completion_pct,
    target_attainment_pct,
  }
}

// ---------------------------------------------------------------------------
// GET / — list cycles with progress
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const cycles = await db
    .select()
    .from(recovery_cycles)
    .orderBy(desc(recovery_cycles.created_at))

  const out = []
  for (const cy of cycles) {
    const actions = await db
      .select()
      .from(recovery_actions)
      .where(eq(recovery_actions.cycle_id, cy.id))
    const realized = await db
      .select()
      .from(realized_savings)
      .where(eq(realized_savings.cycle_id, cy.id))
    out.push({ ...cy, progress: computeProgress(cy, actions, realized) })
  }
  return c.json(out)
})

// ---------------------------------------------------------------------------
// GET /:id — cycle detail with actions + realized (+ close-out summary)
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [cycle] = await db
    .select()
    .from(recovery_cycles)
    .where(eq(recovery_cycles.id, id))
  if (!cycle) return c.json({ error: 'Not found' }, 404)

  const actions = await db
    .select()
    .from(recovery_actions)
    .where(eq(recovery_actions.cycle_id, id))
    .orderBy(desc(recovery_actions.priority_score))
  const realized = await db
    .select()
    .from(realized_savings)
    .where(eq(realized_savings.cycle_id, id))
    .orderBy(desc(realized_savings.realized_at))

  const progress = computeProgress(cycle, actions, realized)

  // Close-out detail: per-status breakdown of action savings for the report.
  const by_status: Record<string, { count: number; monthly: number }> = {}
  for (const a of actions) {
    const st = a.status ?? 'proposed'
    if (!by_status[st]) by_status[st] = { count: 0, monthly: 0 }
    by_status[st].count += 1
    by_status[st].monthly += a.monthly_savings ?? 0
  }

  return c.json({
    cycle,
    actions,
    realized,
    progress,
    close_out: {
      status: cycle.status,
      target_monthly: progress.target_monthly,
      realized_monthly: progress.realized_monthly,
      target_attainment_pct: progress.target_attainment_pct,
      by_status: Object.entries(by_status).map(([status, v]) => ({
        status,
        count: v.count,
        monthly: round2(v.monthly),
      })),
    },
  })
})

// ---------------------------------------------------------------------------
// POST / — create cycle
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1),
  target_monthly_savings: z.number().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  status: z.enum(['open', 'closed']).optional(),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [created] = await db
    .insert(recovery_cycles)
    .values({
      user_id: userId,
      name: body.name,
      target_monthly_savings: body.target_monthly_savings ?? 0,
      start_date: body.start_date ? new Date(body.start_date) : null,
      end_date: body.end_date ? new Date(body.end_date) : null,
      status: body.status ?? 'open',
    })
    .returning()

  await logActivity(userId, created.id, 'create', { name: created.name })
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update / close cycle
// ---------------------------------------------------------------------------

const updateSchema = z
  .object({
    name: z.string().min(1).optional(),
    target_monthly_savings: z.number().optional(),
    start_date: z.string().datetime().nullable().optional(),
    end_date: z.string().datetime().nullable().optional(),
    status: z.enum(['open', 'closed']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(recovery_cycles)
    .where(eq(recovery_cycles.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.target_monthly_savings !== undefined)
    patch.target_monthly_savings = body.target_monthly_savings
  if (body.start_date !== undefined)
    patch.start_date = body.start_date ? new Date(body.start_date) : null
  if (body.end_date !== undefined)
    patch.end_date = body.end_date ? new Date(body.end_date) : null
  if (body.status !== undefined) patch.status = body.status

  const [updated] = await db
    .update(recovery_cycles)
    .set(patch)
    .where(eq(recovery_cycles.id, id))
    .returning()

  await logActivity(userId, id, body.status === 'closed' ? 'close' : 'update', {
    changed: Object.keys(patch),
  })
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete cycle (detach its actions/realized first)
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(recovery_cycles)
    .where(eq(recovery_cycles.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Detach FK references so the cycle delete does not violate constraints.
  await db
    .update(recovery_actions)
    .set({ cycle_id: null, updated_at: new Date() })
    .where(and(eq(recovery_actions.cycle_id, id), eq(recovery_actions.user_id, userId)))
  await db
    .update(realized_savings)
    .set({ cycle_id: null })
    .where(and(eq(realized_savings.cycle_id, id), eq(realized_savings.user_id, userId)))

  await db.delete(recovery_cycles).where(eq(recovery_cycles.id, id))
  await logActivity(userId, id, 'delete', { name: existing.name })
  return c.json({ success: true })
})

export default router
