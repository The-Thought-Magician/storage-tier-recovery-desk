// ---------------------------------------------------------------------------
// cron.ts — THE ENGINE
//
// Pure, deterministic, self-contained scheduling math used by the route layer.
// No DB access, no external services, no I/O. Every function takes plain data
// and returns plain data so it can be unit-tested in isolation and called from
// any handler.
//
// Three schedule "kinds" are supported throughout:
//   - 'cron'   : a standard 5/6-field cron expression, evaluated in a timezone
//   - 'rate'   : a human "every N minutes|hours|days" expression, computed
//                arithmetically from the `from` instant
//   - 'oneoff' : a single ISO-8601 instant; fires once if it is in the future
// ---------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface JobInput {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  /** optional resource the job touches; used for resource-contention collisions */
  resourceId?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface CollisionWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export interface DstTrap {
  type: 'double_fire' | 'skip' | 'ambiguous'
  atLocal: string
  atUtc: string
}

export interface CoverageGap {
  gapStart: string
  gapEnd: string
  durationMinutes: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

export interface TimeWindow {
  start: string
  end: string
}

const DEFAULT_TZ = 'UTC'
const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse "every N minutes|hours|days" -> interval in ms. Returns null on miss. */
function parseRate(expr: string): { intervalMs: number; unit: string; n: number } | null {
  const m = /^\s*every\s+(\d+)\s*(minute|minutes|min|hour|hours|hr|day|days)\s*$/i.exec(expr)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2].toLowerCase()
  let intervalMs: number
  if (unit.startsWith('min')) intervalMs = n * MS_PER_MINUTE
  else if (unit.startsWith('hour') || unit.startsWith('hr')) intervalMs = n * MS_PER_HOUR
  else intervalMs = n * MS_PER_DAY
  return { intervalMs, unit, n }
}

/** Validate that a string is a parseable ISO instant. */
function parseISO(iso: string): Date | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Round a Date down to the minute and return ISO (UTC, no ms). */
function toMinuteISO(d: Date): string {
  const t = Math.floor(d.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Timezone offset (in minutes, east-positive) for an instant in a zone. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(date)
    const map: Record<string, string> = {}
    for (const p of parts) map[p.type] = p.value
    const asUTC = Date.UTC(
      parseInt(map.year, 10),
      parseInt(map.month, 10) - 1,
      parseInt(map.day, 10),
      parseInt(map.hour === '24' ? '0' : map.hour, 10),
      parseInt(map.minute, 10),
      parseInt(map.second, 10),
    )
    return Math.round((asUTC - date.getTime()) / MS_PER_MINUTE)
  } catch {
    return 0
  }
}

/** Local wall-clock string (no zone suffix) for an instant in a zone. */
function localWallClock(date: Date, timeZone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(date)
    const map: Record<string, string> = {}
    for (const p of parts) map[p.type] = p.value
    const hour = map.hour === '24' ? '00' : map.hour
    return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}`
  } catch {
    return date.toISOString()
  }
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (!expr || typeof expr !== 'string' || expr.trim() === '') {
    return { valid: false, error: 'Expression is empty' }
  }
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(expr)
      return { valid: true }
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : 'Invalid cron expression' }
    }
  }
  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return { valid: false, error: 'Expected "every N minutes|hours|days"' }
    return { valid: true }
  }
  if (kind === 'oneoff') {
    const d = parseISO(expr)
    if (!d) return { valid: false, error: 'Expected an ISO-8601 timestamp' }
    return { valid: true }
  }
  return { valid: false, error: `Unknown schedule kind: ${kind}` }
}

// ---------------------------------------------------------------------------
// describeExpression
// ---------------------------------------------------------------------------

export function describeExpression(kind: ScheduleKind, expr: string, timezone = DEFAULT_TZ): string {
  const v = validateExpression(kind, expr)
  if (!v.valid) return `Invalid schedule (${v.error})`
  if (kind === 'rate') {
    const r = parseRate(expr)!
    const unit = r.n === 1 ? r.unit.replace(/s$/, '') : r.unit.endsWith('s') ? r.unit : r.unit + 's'
    return `Every ${r.n} ${unit}`
  }
  if (kind === 'oneoff') {
    return `Once at ${expr} (${timezone})`
  }
  // cron
  const fields = expr.trim().split(/\s+/)
  const [min, hour, dom, mon, dow] = fields
  const parts: string[] = []
  if (min === '*' && hour === '*') parts.push('every minute')
  else if (hour === '*' && /^\*\/(\d+)$/.test(min)) parts.push(`every ${min.split('/')[1]} minutes`)
  else if (min !== '*' && hour !== '*') parts.push(`at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`)
  else if (hour !== '*') parts.push(`during hour ${hour}`)
  else parts.push(`at minute ${min}`)
  if (dom && dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (mon && mon !== '*') parts.push(`in month ${mon}`)
  if (dow && dow !== '*') parts.push(`on weekday ${dow}`)
  return `Cron "${expr}" — ${parts.join(', ')} (${timezone})`
}

// ---------------------------------------------------------------------------
// nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = DEFAULT_TZ,
  fromISO?: string,
  count = 10,
): string[] {
  const from = fromISO ? parseISO(fromISO) : new Date()
  if (!from) return []
  const n = Math.max(0, Math.min(count, 1000))
  if (n === 0) return []

  if (kind === 'cron') {
    try {
      const it = CronExpressionParser.parse(expr, { tz: timezone, currentDate: new Date(from) })
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        const next = it.next()
        out.push(next.toDate().toISOString())
      }
      return out
    } catch {
      return []
    }
  }

  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return []
    const out: string[] = []
    let t = from.getTime() + r.intervalMs
    for (let i = 0; i < n; i++) {
      out.push(new Date(t).toISOString())
      t += r.intervalMs
    }
    return out
  }

  if (kind === 'oneoff') {
    const d = parseISO(expr)
    if (!d) return []
    return d.getTime() > from.getTime() ? [d.toISOString()] : []
  }

  return []
}

// ---------------------------------------------------------------------------
// computeCollisions
//
// Bucket all job firings (across the horizon) by minute. Flag a window when the
// number of jobs firing in that minute is >= threshold, OR when >= 2 jobs that
// share the same resourceId fire in that minute.
// ---------------------------------------------------------------------------

export function computeCollisions(
  jobs: JobInput[],
  opts: { horizonDays?: number; threshold?: number } = {},
): CollisionWindow[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = opts.threshold ?? 3
  const from = new Date()
  const horizonEnd = from.getTime() + horizonDays * MS_PER_DAY

  // minute bucket -> { jobIds: Set, resourceCounts: Map<resourceId, Set<jobId>> }
  const buckets = new Map<string, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()

  for (const job of jobs) {
    // generous count cap so we cover the whole horizon
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? DEFAULT_TZ, from.toISOString(), 1000)
    for (const f of firings) {
      const d = parseISO(f)
      if (!d) continue
      if (d.getTime() > horizonEnd) break
      const key = toMinuteISO(d)
      let b = buckets.get(key)
      if (!b) {
        b = { jobIds: new Set(), resources: new Map() }
        buckets.set(key, b)
      }
      b.jobIds.add(job.id)
      if (job.resourceId) {
        let rs = b.resources.get(job.resourceId)
        if (!rs) {
          rs = new Set()
          b.resources.set(job.resourceId, rs)
        }
        rs.add(job.id)
      }
    }
  }

  const out: CollisionWindow[] = []
  for (const [minute, b] of buckets) {
    const concurrency = b.jobIds.size
    // resource contention: any resource touched by >= 2 distinct jobs
    let contendedResource: string | undefined
    for (const [resId, set] of b.resources) {
      if (set.size >= 2) {
        contendedResource = resId
        break
      }
    }
    if (concurrency >= threshold || contendedResource) {
      const windowStart = minute
      const windowEnd = toMinuteISO(new Date(parseISO(minute)!.getTime() + MS_PER_MINUTE))
      let severity: CollisionWindow['severity'] = 'low'
      if (concurrency >= threshold * 2) severity = 'high'
      else if (concurrency >= threshold || contendedResource) severity = 'medium'
      out.push({
        windowStart,
        windowEnd,
        jobIds: [...b.jobIds].sort(),
        severity,
        resourceId: contendedResource,
      })
    }
  }

  out.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return out
}

// ---------------------------------------------------------------------------
// loadHeatmap
//
// Hourly histogram of all firings across the horizon (bucket = ISO hour).
// ---------------------------------------------------------------------------

export function loadHeatmap(jobs: JobInput[], opts: { horizonDays?: number } = {}): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const from = new Date()
  const horizonEnd = from.getTime() + horizonDays * MS_PER_DAY
  const counts = new Map<string, number>()

  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? DEFAULT_TZ, from.toISOString(), 1000)
    for (const f of firings) {
      const d = parseISO(f)
      if (!d) continue
      if (d.getTime() > horizonEnd) break
      const hour = new Date(Math.floor(d.getTime() / MS_PER_HOUR) * MS_PER_HOUR)
        .toISOString()
        .replace(/:\d{2}\.\d{3}Z$/, ':00Z')
      counts.set(hour, (counts.get(hour) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ---------------------------------------------------------------------------
// dstTraps
//
// Walk the [from, from + days] window in the target timezone and detect DST
// transitions by comparing the UTC offset minute-over-the-hour. A negative jump
// (spring forward) creates a skip window; a positive jump (fall back) creates an
// ambiguous/double-fire window.
// ---------------------------------------------------------------------------

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone = DEFAULT_TZ,
  fromISO?: string,
  days = 365,
): DstTrap[] {
  const from = fromISO ? parseISO(fromISO) : new Date()
  if (!from) return []
  const out: DstTrap[] = []
  const end = from.getTime() + days * MS_PER_DAY

  // sample every hour; offset changes only happen at transitions
  let prevOffset = tzOffsetMinutes(from, timezone)
  for (let t = from.getTime() + MS_PER_HOUR; t <= end; t += MS_PER_HOUR) {
    const at = new Date(t)
    const offset = tzOffsetMinutes(at, timezone)
    if (offset !== prevOffset) {
      const delta = offset - prevOffset
      const atUtc = at.toISOString()
      const atLocal = localWallClock(at, timezone)
      if (delta > 0) {
        // spring forward: local clock jumps ahead, wall-clock times in the gap never occur
        out.push({ type: 'skip', atLocal, atUtc })
      } else {
        // fall back: local clock repeats, wall-clock times in the overlap happen twice
        out.push({ type: 'double_fire', atLocal, atUtc })
        out.push({ type: 'ambiguous', atLocal, atUtc })
      }
      prevOffset = offset
    }
  }

  // If a concrete schedule was supplied, keep only traps where the schedule
  // actually has firings near the transition (within an hour either side).
  if ((kind === 'cron' || kind === 'rate') && validateExpression(kind, expr).valid) {
    const firings = nextFirings(kind, expr, timezone, from.toISOString(), 1000).map((f) =>
      new Date(f).getTime(),
    )
    if (firings.length > 0) {
      return out.filter((trap) => {
        const tt = new Date(trap.atUtc).getTime()
        return firings.some((f) => Math.abs(f - tt) <= MS_PER_HOUR)
      })
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// coverageGaps
//
// Given a set of "covered" windows (e.g. expected maintenance/cover windows)
// and the actual job firings across the horizon, report intervals in the
// horizon where no covered window overlaps any firing — i.e. periods the jobs
// leave uncovered.
// ---------------------------------------------------------------------------

export function coverageGaps(
  windows: TimeWindow[],
  jobs: JobInput[],
  opts: { horizonDays?: number } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const from = new Date()
  const horizonStart = from.getTime()
  const horizonEnd = horizonStart + horizonDays * MS_PER_DAY

  // Normalize covered windows clipped to the horizon, sorted, merged.
  const covered: Array<[number, number]> = []
  for (const w of windows) {
    const s = parseISO(w.start)
    const e = parseISO(w.end)
    if (!s || !e) continue
    const start = Math.max(s.getTime(), horizonStart)
    const endT = Math.min(e.getTime(), horizonEnd)
    if (endT > start) covered.push([start, endT])
  }
  covered.sort((a, b) => a[0] - b[0])

  const merged: Array<[number, number]> = []
  for (const [s, e] of covered) {
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e)
    } else {
      merged.push([s, e])
    }
  }

  // The "demand" boundaries are the horizon plus every firing instant; we report
  // gaps in the covered windows across the whole horizon.
  const gaps: CoverageGap[] = []
  let cursor = horizonStart
  for (const [s, e] of merged) {
    if (s > cursor) {
      gaps.push({
        gapStart: new Date(cursor).toISOString(),
        gapEnd: new Date(s).toISOString(),
        durationMinutes: Math.round((s - cursor) / MS_PER_MINUTE),
      })
    }
    cursor = Math.max(cursor, e)
  }
  if (cursor < horizonEnd) {
    gaps.push({
      gapStart: new Date(cursor).toISOString(),
      gapEnd: new Date(horizonEnd).toISOString(),
      durationMinutes: Math.round((horizonEnd - cursor) / MS_PER_MINUTE),
    })
  }

  // Only keep gaps that contain at least one job firing (an actual uncovered run).
  const firingTimes: number[] = []
  for (const job of jobs) {
    for (const f of nextFirings(job.kind, job.expr, job.timezone ?? DEFAULT_TZ, from.toISOString(), 1000)) {
      const d = parseISO(f)
      if (!d) continue
      if (d.getTime() > horizonEnd) break
      firingTimes.push(d.getTime())
    }
  }
  if (firingTimes.length === 0) return gaps

  return gaps.filter((g) => {
    const gs = new Date(g.gapStart).getTime()
    const ge = new Date(g.gapEnd).getTime()
    return firingTimes.some((f) => f >= gs && f < ge)
  })
}

// ---------------------------------------------------------------------------
// autoSpread
//
// For jobs implicated in collisions, suggest a deterministic minute offset so
// that overlapping cron jobs spread out across the minute/hour. Only cron jobs
// are rewritten; rate/oneoff jobs are reported with a phase-shift reason.
// ---------------------------------------------------------------------------

export function autoSpread(jobs: JobInput[], opts: { threshold?: number } = {}): SpreadSuggestion[] {
  const threshold = opts.threshold ?? 3
  const collisions = computeCollisions(jobs, { threshold })
  if (collisions.length === 0) return []

  // Determine which jobs are involved in any collision and a stable order.
  const involved = new Set<string>()
  for (const w of collisions) for (const id of w.jobIds) involved.add(id)

  const suggestions: SpreadSuggestion[] = []
  const orderedInvolved = jobs.filter((j) => involved.has(j.id))

  orderedInvolved.forEach((job, idx) => {
    // Keep the first job on its slot; shift the rest by a deterministic offset.
    if (idx === 0) return
    if (job.kind === 'cron') {
      const fields = job.expr.trim().split(/\s+/)
      if (fields.length < 5) {
        suggestions.push({
          jobId: job.id,
          suggestedExpr: job.expr,
          reason: 'Non-standard cron; manual review needed',
        })
        return
      }
      const offset = (idx * 7) % 60 // deterministic, prime-ish step to scatter
      const minField = fields[0]
      // Only rewrite when the minute is a fixed value (not a range/step/list).
      if (/^\d+$/.test(minField)) {
        fields[0] = String((parseInt(minField, 10) + offset) % 60)
      } else {
        fields[0] = String(offset)
      }
      suggestions.push({
        jobId: job.id,
        suggestedExpr: fields.join(' '),
        reason: `Shift minute by +${offset} to avoid concurrency window`,
      })
    } else if (job.kind === 'rate') {
      suggestions.push({
        jobId: job.id,
        suggestedExpr: job.expr,
        reason: `Phase-shift start by ${(idx * 7) % 60}m to desync from colliding jobs`,
      })
    } else {
      suggestions.push({
        jobId: job.id,
        suggestedExpr: job.expr,
        reason: 'One-off job collides; reschedule to a clear minute',
      })
    }
  })

  return suggestions
}
