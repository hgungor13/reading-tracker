// The "who am I" state for name + group-code auth, kept in localStorage.
// No passwords: joining a plan stores the membership so we can return to it.

export type Session = {
  membershipId: number
  userId: number
  userName: string
  groupCode: string
  planName: string
}

const KEY = 'reading-tracker.session'

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function setSession(s: Session): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function clearSession(): void {
  localStorage.removeItem(KEY)
}
