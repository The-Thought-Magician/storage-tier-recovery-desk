import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  analysis_runs,
  findings,
  storage_assets,
  access_patterns,
  pricing_books,
  pricing_entries,
  retention_policies,
  workspace_settings,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const BYTES_PER_GB = 1024 * 1024 * 1024

// Default scoring weights (overridden by workspace_settings when present).
const DEFAULT_WEIGHTS = { savings: 0.6, effort: 0.2, risk: 0.2 }

// Ordered cost ladder used to decide whether a tier move is "down" (cheaper).
const TIER_RANK: Record<string, number> = {
  hot: 4,
  warm: 3,
  cold: 2,
  archive: 1,
  'deep-archive': 0,
}

function priorityScore(
  monthly: number,
  effort: number,
  risk: number,
  weights: { savings: number; effort: number; risk: number },
): number {
  // Higher savings is better; lower effort/risk is better (inverted on a 1-5 scale).
  const savingsComponent = monthly
  const effortComponent = (6 - effort) / 5
  const riskComponent = (6 - risk) / 5
  return (
    weights.savings * savingsComponent +
    weights.effort * effortComponent * 100 +
    weights.risk * riskComponent * 100
  )
}

interface DetectorFinding {
  account_id: string | null
  asset_id: string | null
  finding_type: string
  title: string
  detail: string
  recommended_action: string
  target_tier: string | null
  monthly_savings: number
  annual_savings: number
  effort_score: number
  risk_score: number
  confidence: number
  metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// GET /runs — list analysis runs (public)
// ---------------------------------------------------------------------------
router.get('/runs', async (c) => {
  const userId = getUserId(c)
  const rows = userId
    ? await db
        .select()
        .from(analysis_runs)
        .where(eq(analysis_runs.user_id, userId))
        .orderBy(desc(analysis_runs.created_at))
    : await db.select().from(analysis_runs).orderBy(desc(analysis_runs.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /runs/:id — run detail + findings (public)
// ---------------------------------------------------------------------------
router.get('/runs/:id', async (c) => {
  const id = c.req.param('id')
  const [run] = await db.select().from(analysis_runs).where(eq(analysis_runs.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  const runFindings = await db
    .select()
    .from(findings)
    .where(eq(findings.run_id, id))
    .orderBy(desc(findings.priority_score))
  return c.json({ run, findings: runFindings })
})

// ---------------------------------------------------------------------------
// GET /diff — diff latest two runs for the user (public)
// ---------------------------------------------------------------------------
router.get('/diff', async (c) => {
  const userId = getUserId(c)
  const runs = userId
    ? await db
        .select()
        .from(analysis_runs)
        .where(eq(analysis_runs.user_id, userId))
        .orderBy(desc(analysis_runs.created_at))
        .limit(2)
    : await db
        .select()
        .from(analysis_runs)
        .orderBy(desc(analysis_runs.created_at))
        .limit(2)

  if (runs.length < 2) {
    return c.json({ new: [], resolved: [], changed: [], latest: runs[0] ?? null, previous: null })
  }

  const [latest, previous] = runs
  const latestFindings = await db.select().from(findings).where(eq(findings.run_id, latest.id))
  const previousFindings = await db.select().from(findings).where(eq(findings.run_id, previous.id))

  // Key findings by (asset_id + finding_type) so we can match across runs.
  const key = (f: { asset_id: string | null; finding_type: string }) =>
    `${f.asset_id ?? 'none'}::${f.finding_type}`
  const prevByKey = new Map(previousFindings.map((f) => [key(f), f]))
  const latestByKey = new Map(latestFindings.map((f) => [key(f), f]))

  const newFindings: typeof latestFindings = []
  const changed: Array<{
    asset_id: string | null
    finding_type: string
    title: string
    previous_monthly: number
    current_monthly: number
    delta: number
  }> = []
  for (const f of latestFindings) {
    const prior = prevByKey.get(key(f))
    if (!prior) {
      newFindings.push(f)
    } else if (Math.abs((prior.monthly_savings ?? 0) - (f.monthly_savings ?? 0)) > 0.01) {
      changed.push({
        asset_id: f.asset_id,
        finding_type: f.finding_type,
        title: f.title,
        previous_monthly: prior.monthly_savings ?? 0,
        current_monthly: f.monthly_savings ?? 0,
        delta: (f.monthly_savings ?? 0) - (prior.monthly_savings ?? 0),
      })
    }
  }

  const resolved = previousFindings.filter((f) => !latestByKey.has(key(f)))

  return c.json({
    new: newFindings,
    resolved,
    changed,
    latest,
    previous,
  })
})

// ---------------------------------------------------------------------------
// POST /run — execute all detectors, produce findings + a run (auth)
// ---------------------------------------------------------------------------
const runSchema = z.object({
  account_id: z.string().optional(),
  pricing_book_id: z.string().optional(),
})

router.post('/run', authMiddleware, zValidator('json', runSchema.optional()), async (c) => {
  const userId = getUserId(c)
  const body = (c.req.valid('json') ?? {}) as z.infer<typeof runSchema>

  // Resolve scoring weights from workspace settings (fallback to defaults).
  const [settings] = await db
    .select()
    .from(workspace_settings)
    .where(eq(workspace_settings.user_id, userId))
  const weights = {
    savings: settings?.weight_savings ?? DEFAULT_WEIGHTS.savings,
    effort: settings?.weight_effort ?? DEFAULT_WEIGHTS.effort,
    risk: settings?.weight_risk ?? DEFAULT_WEIGHTS.risk,
  }

  // Resolve pricing book: explicit > default > none.
  let pricingBookId = body.pricing_book_id ?? null
  if (!pricingBookId) {
    const [defaultBook] = await db
      .select()
      .from(pricing_books)
      .where(and(eq(pricing_books.user_id, userId), eq(pricing_books.is_default, true)))
    pricingBookId = defaultBook?.id ?? null
  }
  let pricingBookVersion: number | null = null
  const priceMap = new Map<string, number>() // `${provider}|${region}|${tier}` -> per-gb-month
  if (pricingBookId) {
    const [book] = await db.select().from(pricing_books).where(eq(pricing_books.id, pricingBookId))
    pricingBookVersion = book?.version ?? null
    const entries = await db
      .select()
      .from(pricing_entries)
      .where(eq(pricing_entries.book_id, pricingBookId))
    for (const e of entries) {
      priceMap.set(`${e.provider}|${e.region}|${e.tier}`, e.storage_per_gb_month ?? 0)
    }
  }

  const tierPrice = (provider: string, region: string | null, tier: string): number | null => {
    const exact = priceMap.get(`${provider}|${region ?? ''}|${tier}`)
    if (exact !== undefined) return exact
    // Fall back to any region for the provider/tier.
    for (const [k, v] of priceMap) {
      const [p, , t] = k.split('|')
      if (p === provider && t === tier) return v
    }
    return null
  }

  // Load the estate for this user (optionally scoped to one account).
  const assetWhere = body.account_id
    ? and(eq(storage_assets.user_id, userId), eq(storage_assets.account_id, body.account_id))
    : eq(storage_assets.user_id, userId)
  const assets = await db.select().from(storage_assets).where(assetWhere)
  const accessRows = await db
    .select()
    .from(access_patterns)
    .where(eq(access_patterns.user_id, userId))
  const accessByAsset = new Map(accessRows.map((a) => [a.asset_id, a]))
  const policies = await db
    .select()
    .from(retention_policies)
    .where(and(eq(retention_policies.user_id, userId), eq(retention_policies.enabled, true)))

  const detected: DetectorFinding[] = []

  // Build a quick index of source -> snapshot/backup children for chain detection.
  const childrenBySource = new Map<string, typeof assets>()
  for (const a of assets) {
    if (a.source_asset_id) {
      const arr = childrenBySource.get(a.source_asset_id) ?? []
      arr.push(a)
      childrenBySource.set(a.source_asset_id, arr)
    }
  }

  for (const asset of assets) {
    const access = accessByAsset.get(asset.id)
    const gb = (asset.size_bytes ?? 0) / BYTES_PER_GB
    const monthlyCost = asset.monthly_cost ?? 0

    // --- Detector 1: mistier (cold/frozen data sitting in hot/warm tiers) ---
    const temperature = access?.temperature ?? 'warm'
    const daysSince = access?.days_since_access ?? null
    const isCold = temperature === 'cold' || temperature === 'frozen' || temperature === 'never'
    if (
      (asset.asset_type === 'bucket' || asset.asset_type === 'volume') &&
      isCold &&
      TIER_RANK[asset.current_tier] >= TIER_RANK['warm']
    ) {
      // Pick a colder target tier one or two steps down.
      const target =
        temperature === 'never' || temperature === 'frozen' ? 'archive' : 'cold'
      const currentPrice = tierPrice(asset.provider, asset.region, asset.current_tier)
      const targetPrice = tierPrice(asset.provider, asset.region, target)
      let monthly: number
      if (currentPrice !== null && targetPrice !== null && gb > 0) {
        monthly = Math.max(0, (currentPrice - targetPrice) * gb)
      } else {
        // No pricing book: estimate the savings as a fraction of current spend.
        const factor = target === 'archive' ? 0.7 : 0.4
        monthly = monthlyCost * factor
      }
      if (monthly > 0.01) {
        const effort = 2
        const risk = temperature === 'never' ? 2 : 3
        detected.push({
          account_id: asset.account_id,
          asset_id: asset.id,
          finding_type: 'mistier',
          title: `Re-tier ${asset.name} from ${asset.current_tier} to ${target}`,
          detail: `Asset is ${temperature}${
            daysSince !== null ? ` (${daysSince}d since last access)` : ''
          } but stored in ${asset.current_tier}. Moving to ${target} cuts storage cost.`,
          recommended_action: 're-tier',
          target_tier: target,
          monthly_savings: monthly,
          annual_savings: monthly * 12,
          effort_score: effort,
          risk_score: risk,
          confidence: temperature === 'never' ? 0.95 : 0.8,
          metadata: { temperature, days_since_access: daysSince, size_gb: gb },
        })
      }
    }

    // --- Detector 2: snapshot/backup bloat (redundant / incremental chains) ---
    if (asset.asset_type === 'snapshot' || asset.asset_type === 'backup') {
      const siblings = asset.source_asset_id
        ? childrenBySource.get(asset.source_asset_id) ?? []
        : []
      const isRedundant = siblings.length > 3 || asset.is_incremental === true
      const ageDays = asset.asset_created_at
        ? Math.floor((Date.now() - new Date(asset.asset_created_at).getTime()) / 86_400_000)
        : null
      const stale = ageDays !== null && ageDays > 180
      if ((isRedundant || stale) && monthlyCost > 0.01) {
        // Prune redundant/stale snapshots: recover most of the carrying cost.
        const factor = stale && siblings.length > 3 ? 0.9 : stale ? 0.6 : 0.5
        const monthly = monthlyCost * factor
        detected.push({
          account_id: asset.account_id,
          asset_id: asset.id,
          finding_type: 'snapshot_bloat',
          title: `Prune ${asset.asset_type} ${asset.name}`,
          detail: `${asset.asset_type} carries $${monthlyCost.toFixed(2)}/mo.${
            stale ? ` Stale (${ageDays}d old).` : ''
          }${siblings.length > 3 ? ` ${siblings.length} snapshots from the same source.` : ''}`,
          recommended_action: 'prune-snapshot',
          target_tier: null,
          monthly_savings: monthly,
          annual_savings: monthly * 12,
          effort_score: 1,
          risk_score: asset.is_incremental ? 4 : 2,
          confidence: stale ? 0.85 : 0.6,
          metadata: { age_days: ageDays, chain_size: siblings.length, is_incremental: asset.is_incremental },
        })
      }
    }

    // --- Detector 3: orphans (detached volumes, abandoned multipart, orphan snapshots) ---
    const isDetachedVolume = asset.asset_type === 'volume' && asset.attached === false
    const isMultipart = asset.asset_type === 'multipart'
    const isOrphanSnapshot =
      (asset.asset_type === 'snapshot' || asset.asset_type === 'backup') &&
      asset.source_asset_id != null &&
      !assets.some((x) => x.id === asset.source_asset_id || x.external_id === asset.source_asset_id)
    if ((isDetachedVolume || isMultipart || isOrphanSnapshot) && monthlyCost > 0.01) {
      const detachedDays = asset.detached_since
        ? Math.floor((Date.now() - new Date(asset.detached_since).getTime()) / 86_400_000)
        : null
      const orphanKind = isDetachedVolume
        ? 'detached-volume'
        : isMultipart
          ? 'abandoned-multipart'
          : 'orphan-snapshot'
      detected.push({
        account_id: asset.account_id,
        asset_id: asset.id,
        finding_type: 'orphan',
        title: `Delete orphaned ${orphanKind} ${asset.name}`,
        detail: isDetachedVolume
          ? `Volume detached${detachedDays !== null ? ` ${detachedDays}d ago` : ''}, still billing $${monthlyCost.toFixed(2)}/mo.`
          : isMultipart
            ? `Incomplete multipart upload billing $${monthlyCost.toFixed(2)}/mo.`
            : `Snapshot's source asset no longer exists; billing $${monthlyCost.toFixed(2)}/mo.`,
        recommended_action: 'delete-orphan',
        target_tier: null,
        monthly_savings: monthlyCost,
        annual_savings: monthlyCost * 12,
        effort_score: 1,
        risk_score: isMultipart ? 1 : 2,
        confidence: isMultipart ? 0.95 : 0.85,
        metadata: { orphan_kind: orphanKind, detached_days: detachedDays },
      })
    }

    // --- Detector 4: over-retention (asset older than an applicable policy) ---
    for (const policy of policies) {
      let inScope = false
      if (policy.scope_type === 'all') inScope = true
      else if (policy.scope_type === 'account') inScope = policy.scope_value === asset.account_id
      else if (policy.scope_type === 'asset_type') inScope = policy.scope_value === asset.asset_type
      else if (policy.scope_type === 'tag' && policy.scope_value) {
        const [k, v] = policy.scope_value.split(':')
        inScope = (asset.tags as Record<string, string> | null)?.[k] === v
      }
      if (!inScope) continue
      const ageDays = asset.asset_created_at
        ? Math.floor((Date.now() - new Date(asset.asset_created_at).getTime()) / 86_400_000)
        : null
      if (ageDays === null) continue
      if (policy.max_age_days != null && ageDays > policy.max_age_days && monthlyCost > 0.01) {
        detected.push({
          account_id: asset.account_id,
          asset_id: asset.id,
          finding_type: 'over_retention',
          title: `Over-retention: ${asset.name} exceeds policy "${policy.name}"`,
          detail: `Asset is ${ageDays}d old; policy max age is ${policy.max_age_days}d. Deleting recovers $${monthlyCost.toFixed(2)}/mo.`,
          recommended_action: 'tighten-retention',
          target_tier: null,
          monthly_savings: monthlyCost,
          annual_savings: monthlyCost * 12,
          effort_score: 2,
          risk_score: 3,
          confidence: 0.75,
          metadata: { policy_id: policy.id, age_days: ageDays, max_age_days: policy.max_age_days },
        })
        break // one over-retention finding per asset
      }
      if (
        policy.transition_after_days != null &&
        policy.transition_to_tier &&
        ageDays > policy.transition_after_days &&
        TIER_RANK[asset.current_tier] > (TIER_RANK[policy.transition_to_tier] ?? 0) &&
        monthlyCost > 0.01
      ) {
        const target = policy.transition_to_tier
        const currentPrice = tierPrice(asset.provider, asset.region, asset.current_tier)
        const targetPrice = tierPrice(asset.provider, asset.region, target)
        const monthly =
          currentPrice !== null && targetPrice !== null && gb > 0
            ? Math.max(0, (currentPrice - targetPrice) * gb)
            : monthlyCost * 0.4
        if (monthly > 0.01) {
          detected.push({
            account_id: asset.account_id,
            asset_id: asset.id,
            finding_type: 'lifecycle',
            title: `Apply lifecycle: transition ${asset.name} to ${target}`,
            detail: `Policy "${policy.name}" transitions after ${policy.transition_after_days}d; asset is ${ageDays}d old.`,
            recommended_action: 'apply-lifecycle',
            target_tier: target,
            monthly_savings: monthly,
            annual_savings: monthly * 12,
            effort_score: 2,
            risk_score: 2,
            confidence: 0.8,
            metadata: { policy_id: policy.id, age_days: ageDays },
          })
        }
        break
      }
    }
  }

  // Create the run row first so findings can reference it.
  const totalRecoverable = detected.reduce((s, f) => s + f.monthly_savings, 0)
  const summaryByType: Record<string, { count: number; monthly: number }> = {}
  for (const f of detected) {
    const bucket = (summaryByType[f.finding_type] ??= { count: 0, monthly: 0 })
    bucket.count += 1
    bucket.monthly += f.monthly_savings
  }

  const [run] = await db
    .insert(analysis_runs)
    .values({
      user_id: userId,
      account_id: body.account_id ?? null,
      pricing_book_id: pricingBookId,
      status: 'completed',
      findings_count: detected.length,
      total_recoverable_monthly: totalRecoverable,
      summary: { by_type: summaryByType, assets_scanned: assets.length },
    })
    .returning()

  // Persist findings with computed priority scores.
  if (detected.length > 0) {
    const rows = detected.map((f) => ({
      user_id: userId,
      run_id: run.id,
      account_id: f.account_id,
      asset_id: f.asset_id,
      finding_type: f.finding_type,
      title: f.title,
      detail: f.detail,
      recommended_action: f.recommended_action,
      target_tier: f.target_tier,
      monthly_savings: f.monthly_savings,
      annual_savings: f.annual_savings,
      effort_score: f.effort_score,
      risk_score: f.risk_score,
      priority_score: priorityScore(f.monthly_savings, f.effort_score, f.risk_score, weights),
      confidence: f.confidence,
      pricing_book_version: pricingBookVersion,
      metadata: f.metadata,
    }))
    await db.insert(findings).values(rows)
  }

  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'analysis_run',
    entity_id: run.id,
    action: 'run',
    detail: { findings_count: detected.length, total_recoverable_monthly: totalRecoverable },
  })

  return c.json(
    {
      run,
      findings_count: detected.length,
      total_recoverable_monthly: totalRecoverable,
    },
    201,
  )
})

export default router
