import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Layout } from '@/components/Layout'
import { joinPlan } from '@/lib/api'
import { setSession, type Session } from '@/lib/session'

export function Join({
  prefillCode = '',
  onJoined,
  onBack,
}: {
  prefillCode?: string
  onJoined: (s: Session) => void
  onBack: () => void
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState(prefillCode)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim() || !code.trim()) {
      setError('Enter both your name and the group code.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { membership, user, plan } = await joinPlan(code.trim().toUpperCase(), name.trim())
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
          <CardDescription>No password — just your name and the group code.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Your name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hüseyin" />
          </label>
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

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={submit} disabled={busy} className="w-full">
            {busy ? 'Joining…' : 'Join'}
          </Button>
        </CardContent>
      </Card>
    </Layout>
  )
}
