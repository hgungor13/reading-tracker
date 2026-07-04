// Typed wrappers around the Worker's /api endpoints.

export type PeriodUnit = 'day' | 'week' | 'month'

export type Plan = {
  id: number
  name: string
  group_code: string
  pages_per_day: number
  start_date: string
  end_date: string | null
  start_page: number
  pages_per_period: number
  page_step: number
  period_unit: PeriodUnit
  period_every: number
  reader_count: number | null
  title: string
  author: string | null
  total_pages: number | null
}

export type Period = {
  seq: number
  due_date: string
  from_page: number
  to_page: number
  page_count: number
  done_date: string | null
}

export type Membership = {
  id: number
  current_page: number
  pages_per_day: number | null
  assigned_from: number | null
  assigned_to: number | null
  slice_note: string | null
}

export type StatusMember = {
  membership_id: number
  name: string
  current_page: number
  pages_per_day: number | null
  assigned_from: number | null
  assigned_to: number | null
  pages_per_period: number | null
  slice_note: string | null
  read_today: number
  today_from: number | null
  today_to: number | null
  read_days: number
}

export type StatusResponse = { plan: Plan; date: string; members: StatusMember[] }

export type PlanReads = {
  members: { membership_id: number; name: string }[]
  reads: { membership_id: number; log_date: string }[]
}

export async function getPlanReads(groupCode: string): Promise<PlanReads> {
  const res = await fetch(`/api/plans/${encodeURIComponent(groupCode)}/reads`)
  const data = (await res.json().catch(() => ({}))) as PlanReads & { error?: string }
  if (!res.ok) throw new Error(data.error || 'Could not load group calendar')
  return { members: data.members ?? [], reads: data.reads ?? [] }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export function createPlan(input: {
  title: string
  author?: string
  total_pages?: number
  plan_name?: string
  pages_per_day?: number
  start_date?: string
}) {
  return post<{ plan_id: number; group_code: string; book_id: number }>('/api/plans', input)
}

export function joinPlan(group_code: string, name: string) {
  return post<{ membership: Membership; user: { id: number; name: string }; plan: Plan }>(
    '/api/join',
    { group_code, name },
  )
}

export function assignSlice(
  membershipId: number,
  input: { assigned_from?: number; pages_per_period?: number },
) {
  return post<{ ok: true; periods: number; assigned_to: number | null }>(
    `/api/memberships/${membershipId}/assign`,
    input,
  )
}

// Calendar: mark (done=true) or unmark (done=false) a reading day.
export function toggleReadDay(membershipId: number, date: string, done: boolean) {
  return post<{ ok: true; date: string; read: boolean }>(
    `/api/memberships/${membershipId}/read`,
    { date, done },
  )
}

export async function getLogs(membershipId: number): Promise<string[]> {
  const res = await fetch(`/api/memberships/${membershipId}/logs`)
  const data = (await res.json().catch(() => ({}))) as { dates?: string[]; error?: string }
  if (!res.ok) throw new Error(data.error || 'Could not load reading days')
  return data.dates ?? []
}

export function setSchedule(
  groupCode: string,
  input: {
    title?: string
    author?: string
    total_pages?: number
    name?: string
    start_date?: string
    end_date?: string
    pages_per_period?: number
    page_step?: number
    period_unit: PeriodUnit
    period_every?: number
    reader_count?: number
  },
) {
  return post<{ ok: true; members: number; total_periods: number }>(
    `/api/plans/${encodeURIComponent(groupCode)}/schedule`,
    input,
  )
}

export function clonePlan(groupCode: string, input: { start_date?: string; name?: string } = {}) {
  return post<{ ok: true; group_code: string; plan_id: number; members: number }>(
    `/api/plans/${encodeURIComponent(groupCode)}/clone`,
    input,
  )
}

export async function getPeriods(membershipId: number): Promise<Period[]> {
  const res = await fetch(`/api/memberships/${membershipId}/periods`)
  const data = (await res.json().catch(() => ({}))) as { periods?: Period[]; error?: string }
  if (!res.ok) throw new Error(data.error || 'Could not load schedule')
  return data.periods ?? []
}

export async function getStatus(groupCode: string): Promise<StatusResponse> {
  const res = await fetch(`/api/plans/${encodeURIComponent(groupCode)}/status`)
  const data = (await res.json().catch(() => ({}))) as StatusResponse & { error?: string }
  if (!res.ok) throw new Error(data.error || 'Could not load plan status')
  return data
}
