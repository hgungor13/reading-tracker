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
  const body = await c.req.json<{
    assigned_from?: number
    assigned_to?: number
    pages_per_day?: number
    slice_note?: string
  }>()
  const res = await c.env.DB.prepare(
    `UPDATE memberships
       SET assigned_from = ?2, assigned_to = ?3, pages_per_day = ?4, slice_note = ?5
     WHERE id = ?1`,
  )
    .bind(
      id,
      body.assigned_from ?? null,
      body.assigned_to ?? null,
      body.pages_per_day ?? null,
      body.slice_note?.trim() ?? null,
    )
    .run()
  if (!res.meta.changes) return c.json({ error: 'Membership not found' }, 404)
  return c.json({ ok: true })
})

// "I read today" — idempotent per member per day; advances current_page.
app.post('/api/read', async (c) => {
  const { membership_id, from_page, to_page } = await c.req.json<{
    membership_id: number
    from_page?: number
    to_page?: number
  }>()
  if (!membership_id) return c.json({ error: 'membership_id is required' }, 400)
  const date = localDate()

  await c.env.DB.prepare(
    `INSERT INTO reading_logs (membership_id, log_date, from_page, to_page)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(membership_id, log_date) DO UPDATE SET
       from_page = excluded.from_page, to_page = excluded.to_page`,
  )
    .bind(membership_id, date, from_page ?? null, to_page ?? null)
    .run()

  if (to_page) {
    await c.env.DB.prepare(
      `UPDATE memberships SET current_page = ?2 WHERE id = ?1 AND ?2 > current_page`,
    )
      .bind(membership_id, to_page)
      .run()
  }
  return c.json({ ok: true, log_date: date })
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
            m.assigned_from, m.assigned_to, m.slice_note,
            CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS read_today,
            r.from_page AS today_from, r.to_page AS today_to
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
}): PeriodRow[] {
  const step = opts.pageStep > 0 ? opts.pageStep : opts.pagesPerPeriod
  const rows: PeriodRow[] = []
  for (let i = 0; i < 5000; i++) {
    const due = addInterval(opts.startDate, opts.unit, opts.every, i)
    if (due > opts.endDate) break
    const from = opts.startPage + i * step
    rows.push({
      seq: i + 1,
      due_date: due,
      from_page: from,
      to_page: from + opts.pagesPerPeriod - 1,
      page_count: opts.pagesPerPeriod,
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
}

function planByCode(env: Env, code: string) {
  return env.DB.prepare(`SELECT * FROM reading_plans WHERE group_code = ?1`)
    .bind(code.toUpperCase())
    .first<PlanRow>()
}

// Regenerate a single member's periods from their own start page.
async function regenerateForMember(
  env: Env,
  plan: PlanRow,
  member: { id: number; assigned_from: number | null },
): Promise<number> {
  if (!plan.end_date) return 0
  const rows = generatePeriods({
    startDate: plan.start_date,
    endDate: plan.end_date,
    startPage: member.assigned_from ?? plan.start_page,
    pagesPerPeriod: plan.pages_per_period,
    pageStep: plan.page_step,
    unit: plan.period_unit,
    every: plan.period_every,
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
  return rows.length
}

// Set the plan's cadence, then regenerate every member's schedule.
app.post('/api/plans/:code/schedule', async (c) => {
  const plan = await planByCode(c.env, c.req.param('code'))
  if (!plan) return c.json({ error: 'Plan not found' }, 404)

  const b = await c.req.json<{
    end_date: string
    start_page?: number
    pages_per_period: number
    page_step?: number
    period_unit: PeriodUnit
    period_every?: number
    reader_count?: number
  }>()

  if (!b.end_date || !b.pages_per_period || !b.period_unit) {
    return c.json({ error: 'end_date, pages_per_period and period_unit are required' }, 400)
  }
  if (!['day', 'week', 'month'].includes(b.period_unit)) {
    return c.json({ error: 'period_unit must be day, week or month' }, 400)
  }
  if (b.end_date < plan.start_date) {
    return c.json({ error: 'end_date must be on or after the start date' }, 400)
  }

  const startPage = b.start_page ?? plan.start_page
  await c.env.DB.prepare(
    `UPDATE reading_plans SET
       end_date = ?2, start_page = ?3, pages_per_period = ?4, page_step = ?5,
       period_unit = ?6, period_every = ?7, reader_count = ?8
     WHERE id = ?1`,
  )
    .bind(
      plan.id,
      b.end_date,
      startPage,
      b.pages_per_period,
      b.page_step ?? 0,
      b.period_unit,
      b.period_every ?? 1,
      b.reader_count ?? null,
    )
    .run()

  const updated = { ...plan, ...b, start_page: startPage, page_step: b.page_step ?? 0 } as PlanRow
  const { results: members } = await c.env.DB.prepare(
    `SELECT id, assigned_from FROM memberships WHERE plan_id = ?1`,
  )
    .bind(plan.id)
    .all<{ id: number; assigned_from: number | null }>()

  let total = 0
  for (const m of members) total += await regenerateForMember(c.env, updated, m)

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
    `SELECT m.id, m.user_id, m.assigned_from, m.assigned_to,
            (SELECT MAX(to_page) FROM reading_periods p WHERE p.membership_id = m.id) AS last_page
     FROM memberships m WHERE m.plan_id = ?1`,
  )
    .bind(plan.id)
    .all<{ id: number; user_id: number; assigned_from: number | null; assigned_to: number | null; last_page: number | null }>()

  const newPlan = { ...plan, id: created.id, group_code: created.group_code, start_date: newStart, end_date: newEnd } as PlanRow

  let total = 0
  for (const m of members) {
    const nextStart = m.last_page != null ? m.last_page + 1 : (m.assigned_from ?? plan.start_page)
    const nm = await c.env.DB.prepare(
      `INSERT INTO memberships (plan_id, user_id, assigned_from, assigned_to)
       VALUES (?1, ?2, ?3, ?4) RETURNING id`,
    )
      .bind(created.id, m.user_id, nextStart, m.assigned_to)
      .first<{ id: number }>()
    total += await regenerateForMember(c.env, newPlan, { id: nm!.id, assigned_from: nextStart })
  }

  return c.json({ ok: true, group_code: created.group_code, plan_id: created.id, members: members.length, total_periods: total })
})

// Safety net: if the Worker is ever hit for a non-API path, serve the SPA.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

// ---- Push helper ----------------------------------------------------------

async function pushToAll(
  env: Env,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<{ sent: number; failed: number }> {
  const vapid: VapidKeys = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC,
    privateKey: env.VAPID_PRIVATE,
  }

  const { results } = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions',
  ).all<StoredSub>()

  const message: PushMessage = { data: payload, options: { ttl: 60, urgency: 'normal' } }

  let sent = 0
  let failed = 0
  const staleEndpoints: string[] = []

  await Promise.all(
    results.map(async (row) => {
      const subscription: PushSubscription = {
        endpoint: row.endpoint,
        expirationTime: null,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }
      try {
        const { headers, body } = await buildPushPayload(message, subscription, vapid)
        // Let fetch compute content-length itself.
        const { 'content-length': _cl, ...sendHeaders } = headers
        const res = await fetch(row.endpoint, {
          method: 'POST',
          headers: sendHeaders,
          body: body as BodyInit,
        })
        if (res.status === 404 || res.status === 410) {
          staleEndpoints.push(row.endpoint) // subscription gone — prune it
          failed++
        } else if (res.ok) {
          sent++
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }),
  )

  if (staleEndpoints.length) {
    const placeholders = staleEndpoints.map((_, i) => `?${i + 1}`).join(',')
    await env.DB.prepare(
      `DELETE FROM push_subscriptions WHERE endpoint IN (${placeholders})`,
    )
      .bind(...staleEndpoints)
      .run()
  }

  return { sent, failed }
}

// ---- Cron: nightly "who didn't read today?" -------------------------------

async function runDailyReminders(env: Env): Promise<void> {
  // TODO (next milestone): join memberships against today's reading_logs,
  // find users with no log, and push only to those users' subscriptions.
  // For now the spike just proves the scheduled trigger fires and can push.
  await pushToAll(env, {
    title: env.APP_NAME ?? 'Reading Tracker',
    body: "Daily reminder: don't forget to read today 📖",
    url: '/',
    tag: 'daily-reminder',
  })
}

export default {
  fetch: app.fetch,
  scheduled(_event, env, ctx) {
    ctx.waitUntil(runDailyReminders(env))
  },
} satisfies ExportedHandler<Env>
