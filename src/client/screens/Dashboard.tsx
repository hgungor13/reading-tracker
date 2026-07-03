import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { BellRing, Check, Copy, LogOut, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Layout } from '@/components/Layout'
import { CalendarCard } from '@/components/CalendarCard'
import { MyScheduleCard, PlanSettingsCard } from '@/components/ScheduleCard'
import { assignSlice, getStatus, type StatusResponse, type StatusMember } from '@/lib/api'
import { checkPushSupport, getSubscription, subscribeToPush } from '@/lib/push'
import type { Session } from '@/lib/session'

export function Dashboard({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const load = useCallback(async () => {
    try {
      setStatus(await getStatus(session.groupCode))
      setVersion((v) => v + 1)
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
          {me && (
            <CalendarCard
              membershipId={session.membershipId}
              today={status.date}
              planStart={status.plan.start_date}
              planEnd={status.plan.end_date}
              refresh={version}
              onChanged={load}
              footer={
                <NotificationsButton
                  userId={session.userId}
                  deviceLabel={`${session.userName}'s device`}
                />
              }
            />
          )}
          {me && <SliceCard me={me} totalPages={status.plan.total_pages} onChanged={load} />}
          {me && (
            <MyScheduleCard
              plan={status.plan}
              membershipId={session.membershipId}
              today={status.date}
              refresh={version}
              hasSlice={me.assigned_from != null}
            />
          )}
          <MembersCard members={status.members} meId={session.membershipId} />
          <PlanSettingsCard plan={status.plan} onChanged={load} />
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
          {plan.author ? `${plan.author} · ` : ''}today {status.date}
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

function SliceCard({
  me,
  totalPages,
  onChanged,
}: {
  me: StatusMember
  totalPages: number | null
  onChanged: () => void
}) {
  const [from, setFrom] = useState(me.assigned_from?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function save() {
    const f = from ? Number(from) : undefined
    if (totalPages != null && f && f > totalPages) {
      setMsg(`Start must be within the book (1–${totalPages}).`)
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await assignSlice(me.membership_id, { assigned_from: f })
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
        <CardTitle className="text-base">Initial page slice</CardTitle>
        <CardDescription>
          Set where you start{totalPages ? ` (1–${totalPages})` : ''}. The end is set automatically
          by the plan's schedule.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Start page">
            <Input
              inputMode="numeric"
              placeholder="e.g. 53"
              value={from}
              onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))}
            />
          </Labeled>
          <Labeled label="Ends at (auto)">
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
              {me.assigned_to ?? '—'}
            </div>
          </Labeled>
        </div>
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
  if (m.assigned_from != null || m.assigned_to != null) {
    return `pages ${m.assigned_from ?? '?'}–${m.assigned_to ?? '?'}`
  }
  return 'no slice yet'
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}
