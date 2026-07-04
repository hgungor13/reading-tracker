import { Hono } from 'hono'
import {
  buildPushPayload,
  type PushSubscription,
  type PushMessage,
  type VapidKeys,
} from '@block65/webcrypto-web-push'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  APP_NAME: string
  // Secrets / vars — see README (.dev.vars locally, `wrangler secret put` in prod).
  VAPID_SUBJECT: string
  VAPID_PUBLIC: string
  VAPID_PRIVATE: string
}

type StoredSub = {
  endpoint: string
  p256dh: string
  auth: string
}

const app = new Hono<{ Bindings: Env }>()

// ---- Push spike endpoints -------------------------------------------------

// The client fetches this to build its push subscription.
app.get('/api/vapid-public-key', (c) => {
  if (!c.env.VAPID_PUBLIC) return c.json({ error: 'VAPID public key not configured' }, 500)
  return c.json({ publicKey: c.env.VAPID_PUBLIC })
})

// Store (or refresh) a device's push subscription.
app.post('/api/subscribe', async (c) => {
  const body = await c.req.json<{
    subscription: PushSubscription
    label?: string
    user_id?: number
  }>()
  const sub = body.subscription
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return c.json({ error: 'Invalid subscription' }, 400)
  }

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, label, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh  = excluded.p256dh,
       auth    = excluded.auth,
       label   = excluded.label`,
  )
    .bind(sub.endpoint, body.user_id ?? null, sub.keys.p256dh, sub.keys.auth, body.label ?? null)
    .run()

  return c.json({ ok: true })
})

// Spike: push a test notification to every stored device.
app.post('/api/test-push', async (c) => {
  const result = await pushToAll(c.env, {
    title: c.env.APP_NAME ?? 'Reading Tracker',
    body: 'Test push ✅ — the notification pipe works.',
    url: '/',
    tag: 'test-push',
  })
  return c.json(result)
})

// ---- Reading plans, membership, slices, logs (Milestone 2) ----------------

const TIMEZONE = 'Europe/Istanbul'

// "Today" in the group's timezone as YYYY-MM-DD (en-CA formats ISO-like).
function localDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE })
}

// Short, unambiguous join code (no 0/O/1/I/L).
function newGroupCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  let code = ''
  for (const b of bytes) code += alphabet[b % alphabet.length]
  return code
}

// Create a book + reading plan; returns the group code to share.
app.post('/api/plans', async (c) => {
  const body = await c.req.json<{
    title: string
    author?: string
    total_pages?: number
    plan_name?: string
    pages_per_day?: number
    start_date?: string
  }>()
  if (!body.title?.trim()) return c.json({ error: 'Book title is required' }, 400)

  const book = await c.env.DB.prepare(
    `INSERT INTO books (title, author, total_pages) VALUES (?1, ?2, ?3) RETURNING id`,
  )
    .bind(body.title.trim(), body.author?.trim() ?? null, body.total_pages ?? null)
    .first<{ id: number }>()

  const planName = body.plan_name?.trim() || body.title.trim()
  const pagesPerDay = body.pages_per_day ?? 10
  const startDate = body.start_date ?? localDate()

  let plan: { id: number; group_code: string } | null = null
  for (let attempt = 0; attempt < 5 && !plan; attempt++) {
    try {
      plan = await c.env.DB.prepare(
        `INSERT INTO reading_plans (book_id, name, group_code, pages_per_day, start_date)
         VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id, group_code`,
      )
        .bind(book!.id, planName, newGroupCode(), pagesPerDay, startDate)
        .first<{ id: number; group_code: string }>()
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e // collision — retry
    }
  }
  if (!plan) return c.json({ error: 'Could not generate a unique group code' }, 500)

  return c.json({ plan_id: plan.id, group_code: plan.group_code, book_id: book!.id })
})

// Join a plan by code + name. Creates the user + membership (idempotent).
app.post('/api/join', async (c) => {
  const { group_code, name } = await c.req.json<{ group_code: string; name: string }>()
  if (!group_code?.trim() || !name?.trim()) {
    return c.json({ error: 'group_code and name are required' }, 400)
  }
  const code = group_code.trim().toUpperCase()

  const plan = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.group_code, p.pages_per_day, p.start_date,
            b.title, b.author, b.total_pages
     FROM reading_plans p JOIN books b ON b.id = p.book_id
     WHERE p.group_code = ?1 AND p.active = 1`,
  )
    .bind(code)
    .first<Record<string, unknown> & { id: number }>()
  if (!plan) return c.json({ error: 'No active plan with that code' }, 404)

  let user = await c.env.DB.prepare(`SELECT id, name FROM users WHERE name = ?1`)
    .bind(name.trim())
    .first<{ id: number; name: string }>()
  if (!user) {
    user = await c.env.DB.prepare(`INSERT INTO users (name) VALUES (?1) RETURNING id, name`)
      .bind(name.trim())
      .first<{ id: number; name: string }>()
  }

  await c.env.DB.prepare(
    `INSERT INTO memberships (plan_id, user_id) VALUES (?1, ?2)
     ON CONFLICT(plan_id, user_id) DO NOTHING`,
  )
    .bind(plan.id, user!.id)
    .run()

  const membership = await c.env.DB.prepare(
    `SELECT id, current_page, pages_per_day, assigned_from, assigned_to, slice_note
     FROM memberships WHERE plan_id = ?1 AND user_id = ?2`,
  )
    .bind(plan.id, user!.id)
    .first()

  return c.json({ membership, user, plan })
})

// Set (or update) a member's assigned slice + pace.
app.post('/api/memberships/:id/assign', async (c) => {
  const id = Number(c.req.param('id'))
  // The reader chooses their START and their READ COUNT; the END is derived.
  const body = await c.req.json<{ assigned_from?: number; pages_per_period?: number }>()

  const ctx = await c.env.DB.prepare(
    `SELECT p.group_code, b.total_pages
     FROM memberships m
     JOIN reading_plans p ON p.id = m.plan_id
     JOIN books b ON b.id = p.book_id
     WHERE m.id = ?1`,
  )
    .bind(id)
    .first<{ group_code: string; total_pages: number | null }>()
  if (!ctx) return c.json({ error: 'Membership not found' }, 404)

  // Start must stay within the book (plan threshold).
  const tp = ctx.total_pages
  const from = body.assigned_from
  if (from != null && (from < 1 || (tp != null && from > tp))) {
    return c.json({ error: `Start page must be between 1 and ${tp ?? '…'}` }, 400)
  }
  const readCount = body.pages_per_period
  if (readCount != null && readCount < 1) {
    return c.json({ error: 'Pages to read must be at least 1' }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE memberships SET assigned_from = ?2, pages_per_period = ?3 WHERE id = ?1`,
  )
    .bind(id, from ?? null, readCount ?? null)
    .run()

  // Regenerate this reader's schedule (this also computes assigned_to = last page).
  const plan = await planByCode(c.env, ctx.group_code)
  const periods = plan
    ? await regenerateForMember(c.env, plan, {
        id,
        assigned_from: from ?? null,
        pages_per_period: readCount ?? null,
      })
    : 0

  const end = await c.env.DB.prepare(`SELECT assigned_to FROM memberships WHERE id = ?1`)
    .bind(id)
    .first<{ assigned_to: number | null }>()
  return c.json({ ok: true, periods, assigned_to: end?.assigned_to ?? null })
})

// Toggle a reading day (calendar). done=true marks read, done=false unmarks.
// Recomputes which periods are complete from the log afterwards.
app.post('/api/memberships/:id/read', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req
    .json<{ date?: string; done?: boolean }>()
    .catch(() => ({}) as { date?: string; done?: boolean })
  const date = body.date || localDate()
  const done = body.done !== false // default true

  if (done) {
    await c.env.DB.prepare(
      `INSERT INTO reading_logs (membership_id, log_date) VALUES (?1, ?2)
       ON CONFLICT(membership_id, log_date) DO NOTHING`,
    )
      .bind(id, date)
      .run()
  } else {
    await c.env.DB.prepare(`DELETE FROM reading_logs WHERE membership_id = ?1 AND log_date = ?2`)
      .bind(id, date)
      .run()
  }
  await recomputeDone(c.env, id)
  return c.json({ ok: true, date, read: done })
})

// The reader's read-days, for the calendar.
app.get('/api/memberships/:id/logs', async (c) => {
  const id = Number(c.req.param('id'))
  const { results } = await c.env.DB.prepare(
    `SELECT log_date FROM reading_logs WHERE membership_id = ?1 ORDER BY log_date`,
  )
    .bind(id)
    .all<{ log_date: string }>()
  return c.json({ dates: results.map((r) => r.log_date) })
})

// Dashboard data: members, their slices, and who read today.
app.get('/api/plans/:code/status', async (c) => {
  const code = c.req.param('code').toUpperCase()
  const plan = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.group_code, p.pages_per_day, p.start_date, p.end_date,
            p.start_page, p.pages_per_period, p.page_step, p.period_unit, p.period_every,
            p.reader_count, b.title, b.author, b.total_pages
     FROM reading_plans p JOIN books b ON b.id = p.book_id
     WHERE p.group_code = ?1`,
  )
    .bind(code)
    .first<Record<string, unknown> & { id: number }>()
  if (!plan) return c.json({ error: 'Plan not found' }, 404)

  const date = localDate()
  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS membership_id, u.name, m.current_page, m.pages_per_day,
            m.assigned_from, m.assigned_to, m.pages_per_period, m.slice_note,
            CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS read_today,
            r.from_page AS today_from, r.to_page AS today_to,
            (SELECT COUNT(*) FROM reading_logs rl WHERE rl.membership_id = m.id) AS read_days
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN reading_logs r ON r.membership_id = m.id AND r.log_date = ?2
     WHERE m.plan_id = ?1
     ORDER BY u.name`,
  )
    .bind(plan.id, date)
    .all()

  return c.json({ plan, date, members: results })
})

// ---- Schedule generation (Milestone 4) ------------------------------------

type PeriodUnit = 'day' | 'week' | 'month'
type PeriodRow = { seq: number; due_date: string; from_page: number; to_page: number; page_count: number }

// Calendar-accurate date stepping (weekly = same weekday; monthly = same
// day-of-month next month, clamped for short months). All UTC, deterministic.
function addInterval(startISO: string, unit: PeriodUnit, every: number, steps: number): string {
  const [y, m, d] = startISO.split('-').map(Number)
  if (unit === 'month') {
    const totalMonths = m - 1 + every * steps
    const ny = y + Math.floor(totalMonths / 12)
    const nm = (((totalMonths % 12) + 12) % 12) + 1
    const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
    const nd = Math.min(d, lastDay)
    return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
  }
  const days = (unit === 'week' ? 7 : 1) * every * steps
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

// The core generator: constant read count, start page strides by pageStep.
function generatePeriods(opts: {
  startDate: string
  endDate: string
  startPage: number
  pagesPerPeriod: number
  pageStep: number
  unit: PeriodUnit
  every: number
  maxPage?: number | null
}): PeriodRow[] {
  const step = opts.pageStep > 0 ? opts.pageStep : opts.pagesPerPeriod
  const rows: PeriodRow[] = []
  for (let i = 0; i < 5000; i++) {
    const due = addInterval(opts.startDate, opts.unit, opts.every, i)
    if (due > opts.endDate) break
    const from = opts.startPage + i * step
    // Don't schedule past the last page of the book (plan threshold).
    if (opts.maxPage != null && from > opts.maxPage) break
    let to = from + opts.pagesPerPeriod - 1
    if (opts.maxPage != null && to > opts.maxPage) to = opts.maxPage
    rows.push({
      seq: i + 1,
      due_date: due,
      from_page: from,
      to_page: to,
      page_count: to - from + 1,
    })
  }
  return rows
}

type PlanRow = {
  id: number
  group_code: string
  book_id: number
  name: string
  start_date: string
  end_date: string | null
  start_page: number
  pages_per_period: number
  page_step: number
  period_unit: PeriodUnit
  period_every: number
  reader_count: number | null
  total_pages: number | null
}

function planByCode(env: Env, code: string) {
  return env.DB.prepare(
    `SELECT p.*, b.total_pages FROM reading_plans p
     JOIN books b ON b.id = p.book_id
     WHERE p.group_code = ?1`,
  )
    .bind(code.toUpperCase())
    .first<PlanRow>()
}

// Regenerate a single member's periods from their own start page.
async function regenerateForMember(
  env: Env,
  plan: PlanRow,
  member: { id: number; assigned_from: number | null; pages_per_period?: number | null },
): Promise<number> {
  if (!plan.end_date) return 0
  const rows = generatePeriods({
    startDate: plan.start_date,
    endDate: plan.end_date,
    // The reader's start page is their slice; page 1 if they haven't set one.
    startPage: member.assigned_from ?? 1,
    // Read count is per-reader now; fall back to the plan's default.
    pagesPerPeriod: member.pages_per_period ?? plan.pages_per_period,
    // The start-page jump stays shared across the whole plan.
    pageStep: plan.page_step,
    unit: plan.period_unit,
    every: plan.period_every,
    maxPage: plan.total_pages,
  })
  await env.DB.prepare(`DELETE FROM reading_periods WHERE membership_id = ?1`).bind(member.id).run()
  if (rows.length) {
    await env.DB.batch(
      rows.map((r) =>
        env.DB.prepare(
          `INSERT INTO reading_periods (membership_id, seq, due_date, from_page, to_page, page_count)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        ).bind(member.id, r.seq, r.due_date, r.from_page, r.to_page, r.page_count),
      ),
    )
  }
  // The "initial slice" end is DERIVED from the first period: start + pages read.
  const endPage = rows.length ? rows[0].to_page : null
  await env.DB.prepare(`UPDATE memberships SET assigned_to = ?2 WHERE id = ?1`)
    .bind(member.id, endPage)
    .run()
  // Re-align which periods are done against the reading log after regeneration.
  await recomputeDone(env, member.id)
  return rows.length
}

// A period is "done" when the reader has that many read-days: the k-th earliest
// reading log completes the k-th period. Recompute from the log (source of truth)
// so marking/unmarking any day stays consistent.
async function recomputeDone(env: Env, membershipId: number): Promise<void> {
  const { results: logs } = await env.DB.prepare(
    `SELECT log_date FROM reading_logs WHERE membership_id = ?1 ORDER BY log_date`,
  )
    .bind(membershipId)
    .all<{ log_date: string }>()
  const { results: periods } = await env.DB.prepare(
    `SELECT id FROM reading_periods WHERE membership_id = ?1 ORDER BY seq`,
  )
    .bind(membershipId)
    .all<{ id: number }>()
  if (!periods.length) return
  await env.DB.batch(
    periods.map((p, i) =>
      env.DB.prepare(`UPDATE reading_periods SET done_date = ?2 WHERE id = ?1`).bind(
        p.id,
        i < logs.length ? logs[i].log_date : null,
      ),
    ),
  )
}

// Set the plan's cadence, then regenerate every member's schedule.
app.post('/api/plans/:code/schedule', async (c) => {
  const plan = await planByCode(c.env, c.req.param('code'))
  if (!plan) return c.json({ error: 'Plan not found' }, 404)

  const b = await c.req.json<{
    // Plan / book basics (all optional — this endpoint doubles as "edit plan")
    title?: string
    author?: string
    total_pages?: number
    name?: string
    start_date?: string
    // Schedule cadence. Start page AND pages-to-read are NOT here — they belong
    // to each reader's slice. page_step (the jump) stays shared.
    end_date: string
    pages_per_period?: number
    page_step?: number
    period_unit: PeriodUnit
    period_every?: number
    reader_count?: number
  }>()

  if (!b.end_date || !b.period_unit) {
    return c.json({ error: 'end_date and period_unit are required' }, 400)
  }
  if (!['day', 'week', 'month'].includes(b.period_unit)) {
    return c.json({ error: 'period_unit must be day, week or month' }, 400)
  }
  const startDate = b.start_date || plan.start_date
  if (b.end_date < startDate) {
    return c.json({ error: 'End date must be on or after the start date' }, 400)
  }

  // Update the book (title/author/total pages) when provided.
  if (b.title !== undefined || b.author !== undefined || b.total_pages !== undefined) {
    await c.env.DB.prepare(
      `UPDATE books SET
         title = COALESCE(?2, title),
         author = COALESCE(?3, author),
         total_pages = COALESCE(?4, total_pages)
       WHERE id = ?1`,
    )
      .bind(plan.book_id, b.title?.trim() || null, b.author?.trim() || null, b.total_pages ?? null)
      .run()
  }

  await c.env.DB.prepare(
    `UPDATE reading_plans SET
       name = COALESCE(?2, name), start_date = ?3, end_date = ?4,
       pages_per_period = COALESCE(?5, pages_per_period), page_step = ?6, period_unit = ?7,
       period_every = ?8, reader_count = ?9
     WHERE id = ?1`,
  )
    .bind(
      plan.id,
      b.name?.trim() || null,
      startDate,
      b.end_date,
      b.pages_per_period ?? null,
      b.page_step ?? 0,
      b.period_unit,
      b.period_every ?? 1,
      b.reader_count ?? null,
    )
    .run()

  // Re-read the plan (fresh total_pages) and regenerate everyone's schedule.
  const fresh = (await planByCode(c.env, plan.group_code))!
  const { results: members } = await c.env.DB.prepare(
    `SELECT id, assigned_from, pages_per_period FROM memberships WHERE plan_id = ?1`,
  )
    .bind(plan.id)
    .all<{ id: number; assigned_from: number | null; pages_per_period: number | null }>()

  let total = 0
  for (const m of members) total += await regenerateForMember(c.env, fresh, m)

  return c.json({ ok: true, members: members.length, total_periods: total })
})

// A member's generated schedule.
app.get('/api/memberships/:id/periods', async (c) => {
  const id = Number(c.req.param('id'))
  const { results } = await c.env.DB.prepare(
    `SELECT seq, due_date, from_page, to_page, page_count, done_date
     FROM reading_periods WHERE membership_id = ?1 ORDER BY seq`,
  )
    .bind(id)
    .all()
  return c.json({ periods: results })
})

// Clone the plan into the next window: shift dates, continue each reader's
// pages from where they left off, and regenerate.
app.post('/api/plans/:code/clone', async (c) => {
  const plan = await planByCode(c.env, c.req.param('code'))
  if (!plan) return c.json({ error: 'Plan not found' }, 404)
  if (!plan.end_date) return c.json({ error: 'Set a schedule before cloning' }, 400)

  const b = await c.req.json<{ start_date?: string; end_date?: string; name?: string }>()
  const duration = daysBetween(plan.start_date, plan.end_date)
  const newStart = b.start_date ?? addInterval(plan.end_date, 'day', 1, 1)
  const newEnd = b.end_date ?? addInterval(newStart, 'day', 1, duration)

  // New plan (same book), fresh code, same cadence.
  let created: { id: number; group_code: string } | null = null
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    try {
      created = await c.env.DB.prepare(
        `INSERT INTO reading_plans
           (book_id, name, group_code, pages_per_day, start_date, end_date, start_page,
            pages_per_period, page_step, period_unit, period_every, reader_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         RETURNING id, group_code`,
      )
        .bind(
          plan.book_id,
          b.name?.trim() || plan.name,
          newGroupCode(),
          plan.pages_per_period,
          newStart,
          newEnd,
          plan.start_page,
          plan.pages_per_period,
          plan.page_step,
          plan.period_unit,
          plan.period_every,
          plan.reader_count,
        )
        .first<{ id: number; group_code: string }>()
    } catch (e) {
      if (!String(e).includes('UNIQUE')) throw e
    }
  }
  if (!created) return c.json({ error: 'Could not generate a unique group code' }, 500)

  // Carry each member forward, continuing from their last page read.
  const { results: members } = await c.env.DB.prepare(
    `SELECT m.id, m.user_id, m.assigned_from, m.assigned_to, m.pages_per_period,
            (SELECT MAX(to_page) FROM reading_periods p WHERE p.membership_id = m.id) AS last_page
     FROM memberships m WHERE m.plan_id = ?1`,
  )
    .bind(plan.id)
    .all<{ id: number; user_id: number; assigned_from: number | null; assigned_to: number | null; pages_per_period: number | null; last_page: number | null }>()

  const newPlan = { ...plan, id: created.id, group_code: created.group_code, start_date: newStart, end_date: newEnd } as PlanRow

  let total = 0
  for (const m of members) {
    const nextStart = m.last_page != null ? m.last_page + 1 : (m.assigned_from ?? plan.start_page)
    const nm = await c.env.DB.prepare(
      `INSERT INTO memberships (plan_id, user_id, assigned_from, assigned_to, pages_per_period)
       VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
    )
      .bind(created.id, m.user_id, nextStart, m.assigned_to, m.pages_per_period)
      .first<{ id: number }>()
    total += await regenerateForMember(c.env, newPlan, {
      id: nm!.id,
      assigned_from: nextStart,
      pages_per_period: m.pages_per_period,
    })
  }

  return c.json({ ok: true, group_code: created.group_code, plan_id: created.id, members: members.length, total_periods: total })
})

// Everyone's read-days for the group calendar.
app.get('/api/plans/:code/reads', async (c) => {
  const code = c.req.param('code').toUpperCase()
  const plan = await c.env.DB.prepare(`SELECT id FROM reading_plans WHERE group_code = ?1`)
    .bind(code)
    .first<{ id: number }>()
  if (!plan) return c.json({ error: 'Plan not found' }, 404)

  const { results: members } = await c.env.DB.prepare(
    `SELECT m.id AS membership_id, u.name
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.plan_id = ?1 ORDER BY u.name`,
  )
    .bind(plan.id)
    .all()
  const { results: reads } = await c.env.DB.prepare(
    `SELECT rl.membership_id, rl.log_date
     FROM reading_logs rl JOIN memberships m ON m.id = rl.membership_id
     WHERE m.plan_id = ?1`,
  )
    .bind(plan.id)
    .all()
  return c.json({ members, reads })
})

// Manually fire the nightly reminder job (testing / admin "nudge now").
app.post('/api/run-reminders', async (c) => c.json(await runDailyReminders(c.env)))

// Safety net: if the Worker is ever hit for a non-API path, serve the SPA.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

// ---- Push helper ----------------------------------------------------------

type PushPayload = { title: string; body: string; url?: string; tag?: string }

function vapidFrom(env: Env): VapidKeys {
  return { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE }
}

// Deliver one notification. 'stale' = the subscription is gone (404/410).
async function deliver(
  vapid: VapidKeys,
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<'sent' | 'stale' | 'failed'> {
  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    expirationTime: null,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  }
  const message: PushMessage = { data: payload, options: { ttl: 60, urgency: 'normal' } }
  try {
    const { headers, body } = await buildPushPayload(message, subscription, vapid)
    const { 'content-length': _cl, ...sendHeaders } = headers
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: sendHeaders,
      body: body as BodyInit,
    })
    if (res.status === 404 || res.status === 410) return 'stale'
    return res.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

async function pruneSubscriptions(env: Env, endpoints: string[]): Promise<void> {
  if (!endpoints.length) return
  const placeholders = endpoints.map((_, i) => `?${i + 1}`).join(',')
  await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint IN (${placeholders})`)
    .bind(...endpoints)
    .run()
}

async function pushToAll(env: Env, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const vapid = vapidFrom(env)
  const { results } = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions',
  ).all<StoredSub>()

  let sent = 0
  let failed = 0
  const stale: string[] = []
  await Promise.all(
    results.map(async (row) => {
      const r = await deliver(vapid, row, payload)
      if (r === 'stale') {
        stale.push(row.endpoint)
        failed++
      } else if (r === 'sent') sent++
      else failed++
    }),
  )
  await pruneSubscriptions(env, stale)
  return { sent, failed }
}

// ---- Cron: nightly reminder to whoever is behind --------------------------

type BehindRow = {
  endpoint: string
  p256dh: string
  auth: string
  book: string
  period_count: number
  due_from: number | null
  due_to: number | null
  read_today: number | null
}

// Push only to members who are behind, and only to user-linked subscriptions.
// "Behind" = has a due period not marked done (schedule set), or no reading log
// today (no schedule). Returns counts for observability.
async function runDailyReminders(env: Env): Promise<{ sent: number; skipped: number }> {
  const vapid = vapidFrom(env)
  const today = localDate()

  const { results } = await env.DB.prepare(
    `SELECT ps.endpoint, ps.p256dh, ps.auth, b.title AS book,
            (SELECT COUNT(*) FROM reading_periods rp WHERE rp.membership_id = m.id) AS period_count,
            (SELECT rp.from_page FROM reading_periods rp
               WHERE rp.membership_id = m.id AND rp.due_date <= ?1 AND rp.done_date IS NULL
               ORDER BY rp.due_date LIMIT 1) AS due_from,
            (SELECT rp.to_page FROM reading_periods rp
               WHERE rp.membership_id = m.id AND rp.due_date <= ?1 AND rp.done_date IS NULL
               ORDER BY rp.due_date LIMIT 1) AS due_to,
            (SELECT 1 FROM reading_logs rl WHERE rl.membership_id = m.id AND rl.log_date = ?1) AS read_today
     FROM memberships m
     JOIN reading_plans p ON p.id = m.plan_id AND p.active = 1
     JOIN users u ON u.id = m.user_id
     JOIN books b ON b.id = p.book_id
     JOIN push_subscriptions ps ON ps.user_id = m.user_id`,
  )
    .bind(today)
    .all<BehindRow>()

  let sent = 0
  let skipped = 0
  const stale: string[] = []

  await Promise.all(
    results.map(async (r) => {
      const behind = r.period_count > 0 ? r.due_from != null : r.read_today == null
      if (!behind) {
        skipped++
        return
      }
      const body =
        r.due_from != null
          ? `${r.book}: time to read pages ${r.due_from}–${r.due_to} 📖`
          : `Don't forget to read ${r.book} today 📖`

      const res = await deliver(vapid, r, {
        title: env.APP_NAME ?? 'Reading Tracker',
        body,
        url: '/',
        tag: 'daily-reminder',
      })
      if (res === 'stale') stale.push(r.endpoint)
      else if (res === 'sent') sent++
    }),
  )
  await pruneSubscriptions(env, stale)
  return { sent, skipped }
}

export default {
  fetch: app.fetch,
  scheduled(_event, env, ctx) {
    ctx.waitUntil(runDailyReminders(env))
  },
} satisfies ExportedHandler<Env>
