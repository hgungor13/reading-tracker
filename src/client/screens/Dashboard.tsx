import { useCallback, useEffect, useState } from 'react'
import { BellRing, Check, Copy, LogOut, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Layout } from '@/components/Layout'
import { assignSlice, getStatus, markRead, type StatusResponse, type StatusMember } from '@/lib/api'
import { checkPushSupport, getSubscription, subscribeToPush } from '@/lib/push'
import type { Session } from '@/lib/session'

export function Dashboard({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await getStatus(session.groupCode))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [session.groupCode])

  useEffect(() => {
    void load()
  }, [load])

  const me = status?.members.find((m) => m.membership_id === session.membershipId)

  return (
    <Layout
      subtitle={session.planName}
      right={
        <Button variant="ghost" size="icon" onClick={onLeave} aria-label="Leave group">
          <LogOut className="size-5" />
        </Button>
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!status ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <PlanCard status={status} />
          {me && <TodayCard me={me} session={session} onChanged={load} />}
          <MembersCard members={status.members} meId={session.membershipId} />
          {me && <SliceCard me={me} onChanged={load} />}
        </>
      )}
    </Layout>
  )
}

function PlanCard({ status }: { status: StatusResponse }) {
  const [copied, setCopied] = useState(false)
  const { plan } = status
  async function copy() {
    await navigator.clipboard?.writeText(plan.group_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{plan.title}</CardTitle>
        <CardDescription>
          {plan.author ? `${plan.author} · ` : ''}
          {plan.pages_per_day} pages/day · today {status.date}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
          <div>
            <p className="text-xs text-muted-foreground">Share code</p>
            <p className="font-mono text-lg font-semibold tracking-widest">{plan.group_code}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function TodayCard({
  me,
  session,
  onChanged,
}: {
  me: StatusMember
  session: Session
  onChanged: () => void
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const read = me.read_today === 1

  async function mark() {
    setBusy(true)
    try {
      await markRead(
        session.membershipId,
        from ? Number(from) : undefined,
        to ? Number(to) : undefined,
      )
      setFrom('')
      setTo('')
      onChanged()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={read ? 'border-success/40' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {read ? (
            <>
              <span className="flex size-5 items-center justify-center rounded-full bg-success text-white">
                <Check className="size-3.5" />
              </span>
              You've read today
            </>
          ) : (
            "Haven't read today"
          )}
        </CardTitle>
        <CardDescription>
          {read
            ? me.today_from || me.today_to
              ? `Logged pages ${me.today_from ?? '?'}–${me.today_to ?? '?'}.`
              : 'Marked as read. Tap again to update the pages.'
            : 'Mark your reading for today. Pages are optional.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            inputMode="numeric"
            placeholder="from page"
            value={from}
            onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))}
          />
          <Input
            inputMode="numeric"
            placeholder="to page"
            value={to}
            onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <Button onClick={mark} disabled={busy} className="w-full">
          {busy ? 'Saving…' : read ? 'Update today' : 'I read today'}
        </Button>
        <NotificationsButton userId={session.userId} deviceLabel={`${session.userName}'s device`} />
        {msg && <p className="text-sm text-destructive">{msg}</p>}
      </CardContent>
    </Card>
  )
}

function NotificationsButton({ userId, deviceLabel }: { userId: number; deviceLabel: string }) {
  const [support] = useState(() => checkPushSupport())
  const [subscribed, setSubscribed] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (support.ok) void getSubscription().then((s) => setSubscribed(!!s))
  }, [support.ok])

  if (support.ok === false) {
    return (
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Smartphone className="mt-0.5 size-4 shrink-0" />
        {support.reason}
      </p>
    )
  }

  async function enable() {
    try {
      await subscribeToPush(deviceLabel, userId)
      setSubscribed(true)
      setMsg(null)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <>
      <Button variant="outline" className="w-full" onClick={enable} disabled={subscribed}>
        <BellRing className="size-4" />
        {subscribed ? 'Reminders on' : 'Enable reminders'}
      </Button>
      {msg && <p className="text-sm text-destructive">{msg}</p>}
    </>
  )
}

function MembersCard({ members, meId }: { members: StatusMember[]; meId: number }) {
  const readCount = members.filter((m) => m.read_today === 1).length
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Today's readers</CardTitle>
        <CardDescription>
          {readCount} of {members.length} have read today.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {members.map((m) => (
          <div key={m.membership_id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <span
              className={
                m.read_today
                  ? 'flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-white'
                  : 'size-6 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/40'
              }
            >
              {m.read_today ? <Check className="size-4" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {m.name}
                {m.membership_id === meId && (
                  <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">{sliceLabel(m)}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function sliceLabel(m: StatusMember): string {
  if (m.slice_note) return m.slice_note
  if (m.assigned_from != null || m.assigned_to != null) {
    return `pages ${m.assigned_from ?? '?'}–${m.assigned_to ?? '?'}`
  }
  return 'no slice assigned yet'
}

function SliceCard({ me, onChanged }: { me: StatusMember; onChanged: () => void }) {
  const [from, setFrom] = useState(me.assigned_from?.toString() ?? '')
  const [to, setTo] = useState(me.assigned_to?.toString() ?? '')
  const [note, setNote] = useState(me.slice_note ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      await assignSlice(me.membership_id, {
        assigned_from: from ? Number(from) : undefined,
        assigned_to: to ? Number(to) : undefined,
        slice_note: note.trim() || undefined,
      })
      setMsg('Saved.')
      onChanged()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your slice</CardTitle>
        <CardDescription>The page range you're responsible for. Can be loose.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            inputMode="numeric"
            placeholder="from page"
            value={from}
            onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))}
          />
          <Input
            inputMode="numeric"
            placeholder="to page"
            value={to}
            onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <Input
          placeholder='note, e.g. "Temmuz: 30-60"'
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button variant="secondary" onClick={save} disabled={busy} className="w-full">
          {busy ? 'Saving…' : 'Save slice'}
        </Button>
        {msg && (
          <p
            className={
              msg === 'Saved.' ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'
            }
          >
            {msg}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
