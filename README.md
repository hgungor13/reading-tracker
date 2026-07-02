# Reading Tracker

A group **daily book-reading tracker**: multiple books read at the same time by
multiple people, each at their own page — track who read / who didn't each day
and **push a reminder to those who didn't**.

Built as an installable **PWA** so it works on Android *and* iPhone with **no app
store**, on an all-free Cloudflare stack.

## Stack

| Layer | Choice |
|---|---|
| UI | React + Vite + TypeScript + Tailwind v4 + **shadcn/ui** |
| PWA | `vite-plugin-pwa` (manifest + custom service worker) |
| Backend | **Hono** on a Cloudflare **Worker** (API + cron) |
| Hosting | Workers Static Assets (same Worker serves the PWA) |
| Database | Cloudflare **D1** (SQLite) |
| Reminders | Cloudflare **Cron Triggers** + **Web Push** (VAPID) |

Everything runs on Cloudflare's free tier; the only paid ceiling is Workers Paid
($5/mo) if you outgrow it.

## Status

**Milestone 1 — Web Push spike (done).** Proves the hardest part first: a real
push notification reaching a phone. UI to subscribe a device + send a test push;
Worker endpoints; nightly cron stub. Reading features come next.

## Requirements

- **Node 22** (`.nvmrc` pins it — run `nvm use`). Node 18 will not work.
- A Cloudflare account (`npx wrangler login`).

## Local development

```bash
nvm use
npm install
npm run gen:icons          # placeholder app icons -> public/icons
npm run gen:vapid          # prints VAPID keys -> paste into .dev.vars (once)
npm run db:migrate:local   # create + migrate the local D1 database
npm run dev                # http://localhost:5173
```

`.dev.vars` holds the three VAPID values locally (git-ignored). See
`.dev.vars.example`.

> Web Push works on `http://localhost` in Chrome/Android for testing. On iPhone
> you must deploy (HTTPS) **and** install to the Home Screen — see below.

## Deploying to Cloudflare

```bash
# 1. Create the D1 database, then paste the printed database_id into wrangler.jsonc
npx wrangler d1 create reading_tracker_db

# 2. Apply migrations to the remote DB
npm run db:migrate:remote

# 3. Set the VAPID secrets in production (values from `npm run gen:vapid`)
npx wrangler secret put VAPID_SUBJECT
npx wrangler secret put VAPID_PUBLIC
npx wrangler secret put VAPID_PRIVATE

# 4. Build + deploy (one Worker: PWA + API + cron)
npm run deploy
```

The cron in `wrangler.jsonc` (`0 18 * * *` = 21:00 Istanbul) fires the nightly
reminder handler.

## 📱 iPhone: the make-or-break step

iOS only delivers Web Push to a PWA that was **added to the Home Screen** (iOS
16.4+). In a normal Safari tab, push silently does nothing.

1. Open the deployed URL in **Safari**.
2. **Share → Add to Home Screen**.
3. Open the app **from its new icon** (not the Safari tab).
4. Tap **Enable notifications** and allow.

Android/Chrome has no such restriction — push works in the browser tab.

## Project layout

```
src/
  client/          React PWA (Vite)
    components/ui/  shadcn components
    lib/push.ts     subscribe + feature detection (incl. iOS install check)
    sw.ts           service worker: push + notificationclick handlers
    App.tsx         spike UI
  worker/index.ts   Hono Worker: /api/* + scheduled() cron
migrations/         D1 schema
scripts/            gen:icons, gen:vapid (zero-dep helpers)
wrangler.jsonc      Worker + assets + D1 + cron config
```

## Data model (D1)

`users` · `books` · `reading_plans` (book + join **group_code** + daily target) ·
`memberships` (per-user current page) · `reading_logs` (one row per user/plan/day
= "read today", unique so it's idempotent) · `push_subscriptions` (a user can
have several devices).

## Next milestones

1. Join flow (name + group code) → create user + membership.
2. "I read today" → idempotent `reading_logs` insert; per-user page advance.
3. Status dashboard (green/red grid).
4. Cron: push only users with **no** log today (replace the spike's push-to-all).
