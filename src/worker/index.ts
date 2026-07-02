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
  }>()
  const sub = body.subscription
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return c.json({ error: 'Invalid subscription' }, 400)
  }

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at)
     VALUES (?1, ?2, ?3, ?4, unixepoch())
     ON CONFLICT(endpoint) DO UPDATE SET
       p256dh = excluded.p256dh,
       auth   = excluded.auth,
       label  = excluded.label`,
  )
    .bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth, body.label ?? null)
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
    `SELECT p.id, p.name, p.group_code, p.pages_per_day, p.start_date,
            b.title, b.author, b.total_pages
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
