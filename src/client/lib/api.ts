// Typed wrappers around the Worker's /api endpoints.

export type Plan = {
  id: number
  name: string
  group_code: string
  pages_per_day: number
  start_date: string
  title: string
  author: string | null
  total_pages: number | null
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
  slice_note: string | null
  read_today: number
  today_from: number | null
  today_to: number | null
}

export type StatusResponse = { plan: Plan; date: string; members: StatusMember[] }

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
  input: {
    assigned_from?: number
    assigned_to?: number
    pages_per_day?: number
    slice_note?: string
  },
) {
  return post<{ ok: true }>(`/api/memberships/${membershipId}/assign`, input)
}

export function markRead(membershipId: number, from_page?: number, to_page?: number) {
  return post<{ ok: true; log_date: string }>('/api/read', {
    membership_id: membershipId,
    from_page,
    to_page,
  })
}

export async function getStatus(groupCode: string): Promise<StatusResponse> {
  const res = await fetch(`/api/plans/${encodeURIComponent(groupCode)}/status`)
  const data = (await res.json().catch(() => ({}))) as StatusResponse & { error?: string }
  if (!res.ok) throw new Error(data.error || 'Could not load plan status')
  return data
}
