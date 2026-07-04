import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Layout } from '@/components/Layout'
import { getPlanMembers, joinPlan } from '@/lib/api'
import { getIdentity, setSession, type Session } from '@/lib/session'

const NEW_READER = '__new__'

export function Join({
  prefillCode = '',
  onJoined,
  onBack,
}: {
  prefillCode?: string
  onJoined: (s: Session) => void
  onBack: () => void
}) {
  const [code, setCode] = useState(prefillCode)
  const [members, setMembers] = useState<{ name: string }[] | null>(null)
  const [picked, setPicked] = useState('')
  const [name, setName] = useState(() => getIdentity()?.userName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Once a full code is entered, load the plan's members so the reader can pick
  // their name instead of retyping it (which would create a duplicate reader).
  useEffect(() => {
    const c = code.trim().toUpperCase()
    if (c.length !== 6) {
      setMembers(null)
      return
    }
    let cancelled = false
    void getPlanMembers(c).then((res) => {
      if (cancelled) return
      setMembers(res?.members ?? null)
      const mine = getIdentity()?.userName
      setPicked(res?.members?.some((m) => m.name === mine) ? mine! : '')
    })
    return () => {
      cancelled = true
    }
  }, [code])

  const hasMembers = !!members && members.length > 0
  const typing = !hasMembers || picked === NEW_READER
  const resolvedName = (typing ? name : picked).trim()

  async function submit() {
    if (code.trim().length !== 6) return setError('Enter the 6-character group code.')
    if (!resolvedName) return setError(hasMembers ? 'Pick your name or add a new one.' : 'Enter your name.')
    setBusy(true)
    setError(null)
    try {
      const { membership, user, plan } = await joinPlan(code.trim().toUpperCase(), resolvedName)
      const session: Session = {
        membershipId: membership.id,
        userId: user.id,
        userName: user.name,
        groupCode: plan.group_code,
        planName: plan.name,
      }
      setSession(session)
      onJoined(session)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Layout
      subtitle="Join a group"
      right={
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back">
          <ArrowLeft className="size-5" />
        </Button>
      }
    >
      {prefillCode && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">Plan created 🎉</CardTitle>
            <CardDescription>
              Share code <span className="font-mono font-semibold">{prefillCode}</span>. Enter your
              name below to join as the first reader.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your details</CardTitle>
          <CardDescription>
            No password — enter the group code, then pick or add your name.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Group code</span>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="6PMEPW"
              autoCapitalize="characters"
              className="font-mono tracking-widest"
            />
          </label>

          {hasMembers ? (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Who are you?</span>
                <select
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="" disabled>
                    Select your name…
                  </option>
                  {members!.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                  <option value={NEW_READER}>＋ I'm new here</option>
                </select>
                <span className="text-xs text-muted-foreground">
                  Pick your existing name so you don't create a duplicate reader.
                </span>
              </label>
              {picked === NEW_READER && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Your name</span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    autoFocus
                  />
                </label>
              )}
            </div>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Your name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </label>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={submit} disabled={busy} className="w-full">
            {busy ? 'Joining…' : 'Join'}
          </Button>
        </CardContent>
      </Card>
    </Layout>
  )
}
