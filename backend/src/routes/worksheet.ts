import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  recovery_actions,
  findings,
  recovery_cycles,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUSES = ['proposed', 'approved', 'in-progress', 'done', 'dismissed'] as const

/**
 * Default priority blend used when the caller does not supply an explicit
 * priority_score. Savings dominates; effort and risk penalize. Returns a
 * non-negative number on roughly the same scale as monthly savings.
 */
function computePriority(monthly: number, effort: number, risk: number): number {
  const e = Math.max(1, Math.min(5, effort || 1))
  const r = Math.max(1, Math.min(5, risk || 1))
  // weight: 0.6 savings (raw), penalize effort/risk multiplicatively
  const penalty = 1 + (e - 1) * 0.15 + (r - 1) * 0.25
  return Math.round((monthly / penalty) * 100) / 100
}

async function logActivity(
  userId: string,
  entityId: string,
  action: string,
  detail: Record<string, unknown>,
) {
  try {
    await db.insert(activity_log).values({
      user_id: userId,
      entity_type: 'recovery_action',
      entity_id: entityId,
      action,
      detail,
    })
  } catch {
    // activity logging is best-effort; never block the mutation
  }
}

// ---------------------------------------------------------------------------
// GET / — ranked recovery actions (query: account_id, action_type, status, risk)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const accountId = c.req.query('account_id')
  const actionType = c.req.query('action_type')
  const status = c.req.query('status')
  const riskRaw = c.req.query('risk')

  const conds = []
  if (accountId) conds.push(eq(recovery_actions.account_id, accountId))
  if (actionType) conds.push(eq(recovery_actions.action_type, actionType))
  if (status) conds.push(eq(recovery_actions.status, status))
  if (riskRaw) {
    const risk = parseInt(riskRaw, 10)
    if (Number.isFinite(risk)) conds.push(eq(recovery_actions.risk_score, risk))
  }

  const rows = conds.length
    ? await db
        .select()
        .from(recovery_actions)
        .where(and(...conds))
        .orderBy(desc(recovery_actions.priority_score), desc(recovery_actions.monthly_savings))
    : await db
        .select()
        .from(recovery_actions)
        .orderBy(desc(recovery_actions.priority_score), desc(recovery_actions.monthly_savings))

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /summary — total recoverable + by status/type
// ---------------------------------------------------------------------------

router.get('/summary', async (c) => {
  const accountId = c.req.query('account_id')
  const rows = accountId
    ? await db.select().from(recovery_actions).where(eq(recovery_actions.account_id, accountId))
    : await db.select().from(recovery_actions)

  // Only count actions that are still pursuing savings (exclude dismissed).
  const active = rows.filter((r) => r.status !== 'dismissed')
  const total_monthly = active.reduce((s, r) => s + (r.monthly_savings ?? 0), 0)
  const total_annual = active.reduce((s, r) => s + (r.annual_savings ?? 0), 0)

  const by_status: Record<string, { count: number; monthly: number }> = {}
  for (const s of STATUSES) by_status[s] = { count: 0, monthly: 0 }
  const by_type: Record<string, { count: number; monthly: number }> = {}

  for (const r of rows) {
    const st = r.status ?? 'proposed'
    if (!by_status[st]) by_status[st] = { count: 0, monthly: 0 }
    by_status[st].count += 1
    by_status[st].monthly += r.monthly_savings ?? 0

    const t = r.action_type ?? 'unknown'
    if (!by_type[t]) by_type[t] = { count: 0, monthly: 0 }
    by_type[t].count += 1
    by_type[t].monthly += r.monthly_savings ?? 0
  }

  return c.json({
    total_monthly: Math.round(total_monthly * 100) / 100,
    total_annual: Math.round(total_annual * 100) / 100,
    count: rows.length,
    by_status: Object.entries(by_status).map(([status, v]) => ({
      status,
      count: v.count,
      monthly: Math.round(v.monthly * 100) / 100,
    })),
    by_type: Object.entries(by_type).map(([action_type, v]) => ({
      action_type,
      count: v.count,
      monthly: Math.round(v.monthly * 100) / 100,
    })),
  })
})

// ---------------------------------------------------------------------------
// POST / — create action (often promoted from a finding)
// ---------------------------------------------------------------------------

const createSchema = z.object({
  finding_id: z.string().optional(),
  account_id: z.string().optional(),
  asset_id: z.string().optional(),
  cycle_id: z.string().optional(),
  action_type: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  monthly_savings: z.number().optional(),
  annual_savings: z.number().optional(),
  effort_score: z.number().int().min(1).max(5).optional(),
  risk_score: z.number().int().min(1).max(5).optional(),
  priority_score: z.number().optional(),
  owner: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().optional(),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // If promoting from a finding, hydrate defaults from that finding (ownership-checked).
  let base: {
    finding_id?: string | null
    account_id?: string | null
    asset_id?: string | null
    action_type: string
    title: string
    monthly_savings: number
    annual_savings: number
    effort_score: number
    risk_score: number
  } | null = null

  if (body.finding_id) {
    const [f] = await db
      .select()
      .from(findings)
      .where(eq(findings.id, body.finding_id))
    if (!f) return c.json({ error: 'Finding not found' }, 404)
    if (f.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
    base = {
      finding_id: f.id,
      account_id: f.account_id,
      asset_id: f.asset_id,
      action_type: f.recommended_action ?? f.finding_type,
      title: f.title,
      monthly_savings: f.monthly_savings ?? 0,
      annual_savings: f.annual_savings ?? 0,
      effort_score: f.effort_score ?? 1,
      risk_score: f.risk_score ?? 1,
    }
  }

  const action_type = body.action_type ?? base?.action_type
  const title = body.title ?? base?.title
  if (!action_type) return c.json({ error: 'action_type is required' }, 400)
  if (!title) return c.json({ error: 'title is required' }, 400)

  const monthly = body.monthly_savings ?? base?.monthly_savings ?? 0
  const annual = body.annual_savings ?? base?.annual_savings ?? monthly * 12
  const effort = body.effort_score ?? base?.effort_score ?? 1
  const risk = body.risk_score ?? base?.risk_score ?? 1
  const priority = body.priority_score ?? computePriority(monthly, effort, risk)

  // Validate cycle ownership if attaching to one.
  if (body.cycle_id) {
    const [cy] = await db
      .select()
      .from(recovery_cycles)
      .where(eq(recovery_cycles.id, body.cycle_id))
    if (!cy) return c.json({ error: 'Cycle not found' }, 404)
    if (cy.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  }

  const [created] = await db
    .insert(recovery_actions)
    .values({
      user_id: userId,
      finding_id: body.finding_id ?? base?.finding_id ?? null,
      account_id: body.account_id ?? base?.account_id ?? null,
      asset_id: body.asset_id ?? base?.asset_id ?? null,
      cycle_id: body.cycle_id ?? null,
      action_type,
      title,
      monthly_savings: monthly,
      annual_savings: annual,
      effort_score: effort,
      risk_score: risk,
      priority_score: priority,
      owner: body.owner ?? null,
      status: body.status ?? 'proposed',
      notes: body.notes ?? null,
    })
    .returning()

  await logActivity(userId, created.id, 'create', { title, monthly_savings: monthly })
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update status/owner/notes/cycle
// ---------------------------------------------------------------------------

const updateSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    owner: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    cycle_id: z.string().nullable().optional(),
    title: z.string().min(1).optional(),
    action_type: z.string().min(1).optional(),
    monthly_savings: z.number().optional(),
    annual_savings: z.number().optional(),
    effort_score: z.number().int().min(1).max(5).optional(),
    risk_score: z.number().int().min(1).max(5).optional(),
    priority_score: z.number().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(recovery_actions)
    .where(eq(recovery_actions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Validate cycle ownership when (re)assigning to a cycle.
  if (body.cycle_id) {
    const [cy] = await db
      .select()
      .from(recovery_cycles)
      .where(eq(recovery_cycles.id, body.cycle_id))
    if (!cy) return c.json({ error: 'Cycle not found' }, 404)
    if (cy.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  }

  const patch: Record<string, unknown> = { updated_at: new Date() }
  for (const k of [
    'status',
    'owner',
    'notes',
    'cycle_id',
    'title',
    'action_type',
    'monthly_savings',
    'annual_savings',
    'effort_score',
    'risk_score',
    'priority_score',
  ] as const) {
    if (body[k] !== undefined) patch[k] = body[k]
  }

  // Recompute priority if savings/effort/risk changed and no explicit priority given.
  if (
    body.priority_score === undefined &&
    (body.monthly_savings !== undefined ||
      body.effort_score !== undefined ||
      body.risk_score !== undefined)
  ) {
    const monthly = body.monthly_savings ?? existing.monthly_savings ?? 0
    const effort = body.effort_score ?? existing.effort_score ?? 1
    const risk = body.risk_score ?? existing.risk_score ?? 1
    patch.priority_score = computePriority(monthly, effort, risk)
  }

  const [updated] = await db
    .update(recovery_actions)
    .set(patch)
    .where(eq(recovery_actions.id, id))
    .returning()

  await logActivity(userId, id, 'update', { changed: Object.keys(patch) })
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete action
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(recovery_actions)
    .where(eq(recovery_actions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(recovery_actions).where(eq(recovery_actions.id, id))
  await logActivity(userId, id, 'delete', { title: existing.title })
  return c.json({ success: true })
})

export default router
