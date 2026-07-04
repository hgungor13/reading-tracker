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
const IDENTITY_KEY = 'reading-tracker.identity'

// Who the reader is, independent of which plan is open. Persists across leaving
// a plan so the home screen can list every plan they've joined.
export type Identity = { userId: number; userName: string }

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
  setIdentity({ userId: s.userId, userName: s.userName })
}

export function clearSession(): void {
  localStorage.removeItem(KEY)
}

export function getIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    return raw ? (JSON.parse(raw) as Identity) : null
  } catch {
    return null
  }
}

export function setIdentity(i: Identity): void {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(i))
}

export function clearIdentity(): void {
  localStorage.removeItem(IDENTITY_KEY)
}
