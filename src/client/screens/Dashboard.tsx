import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { BellRing, Check, Copy, LayoutGrid, Settings, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Section } from '@/components/Section'
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
  const [showSettings, setShowSettings] = useState(false)

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
  // A schedule is set up once it has a terminator: an end date OR a page count.
  const hasSchedule = !!status && (!!status.plan.end_date || status.plan.total_pages != null)
  // Plan settings stays tucked behind the gear so the focus is slice + schedule.
  // It opens automatically while there's no schedule yet (setup is required).
  const notSetUp = !!status && !hasSchedule
  const settingsOpen = showSettings || notSetUp

  return (
    <Layout
      subtitle={session.planName}
      right={
        <div className="flex items-center gap-0.5">
          {status && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings((s) => !s)}
              aria-label="Plan settings"
              aria-pressed={settingsOpen}
            >
              <Settings className={`size-5 ${settingsOpen ? 'text-primary' : ''}`} />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onLeave} aria-label="My plans">
            <LayoutGrid className="size-5" />
          </Button>
        </div>
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!status ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {settingsOpen && <PlanSettingsCard plan={status.plan} onChanged={load} />}
          {me && hasSchedule && (
            <CalendarCard
              membershipId={session.membershipId}
              groupCode={session.groupCode}
              today={status.date}
              planStart={status.plan.start_date}
              planEnd={status.plan.end_date}
              hasSlice={me.assigned_from != null}
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
          {me && (
            <SliceCard
              me={me}
              totalPages={status.plan.total_pages}
              planReadCount={status.plan.pages_per_period}
              onChanged={load}
            />
          )}
          {me && (
            <MyScheduleCard
              plan={status.plan}
              membershipId={session.membershipId}
              refresh={version}
              hasSlice={me.assigned_from != null}
              pagesPerPeriod={me.pages_per_period ?? status.plan.pages_per_period}
            />
          )}
          <ShareCodeCard groupCode={status.plan.group_code} />
        </>
      )}
    </Layout>
  )
}

function ShareCodeCard({ groupCode }: { groupCode: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard?.writeText(groupCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Section title="Share code">
      <Card className="py-0">
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <p className="font-mono text-lg font-semibold tracking-widest">{groupCode}</p>
          <Button variant="secondary" size="sm" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </CardContent>
      </Card>
    </Section>
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
  planReadCount,
  onChanged,
}: {
  me: StatusMember
  totalPages: number | null
  planReadCount: number
  onChanged: () => void
}) {
  const [from, setFrom] = useState(me.assigned_from?.toString() ?? '')
  const [read, setRead] = useState(me.pages_per_period?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const locked = me.read_days > 0

  // Live preview of the slice's first-period end as the reader types.
  // Mirrors the backend: end = min(start + pagesToRead - 1, totalPages). Not stored.
  // Pages-to-read falls back to the plan's default until the reader sets their own.
  const startNum = from ? Number(from) : null
  const readNum = read ? Number(read) : planReadCount
  const previewEnd =
    startNum != null && readNum > 0
      ? Math.min(startNum + readNum - 1, totalPages ?? Number.MAX_SAFE_INTEGER)
      : (me.assigned_to ?? null)

  async function save() {
    const f = from ? Number(from) : undefined
    const r = read ? Number(read) : undefined
    if (totalPages != null && f && f > totalPages) {
      setMsg(`Start must be within the book (1–${totalPages}).`)
      return
    }
    if (r != null && r < 1) {
      setMsg('Pages to read must be at least 1.')
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await assignSlice(me.membership_id, { assigned_from: f, pages_per_period: r })
      setMsg('Saved.')
      onChanged()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Initial page slice">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {locked
              ? "Locked — you've started reading, so your slice is fixed."
              : `Set where you start${totalPages ? ` (1–${totalPages})` : ''} and how many pages you read each period. The end is worked out for you.`}
          </p>
          {locked ? (
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Start page</p>
              <p className="font-medium">{me.assigned_from ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pages / period</p>
              <p className="font-medium">{me.pages_per_period ?? planReadCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ends at</p>
              <p className="font-medium">{me.assigned_to ?? '—'}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Start page">
                <Input
                  inputMode="numeric"
                  placeholder="e.g. 53"
                  value={from}
                  onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))}
                />
              </Labeled>
              <Labeled label="Pages to read">
                <Input
                  inputMode="numeric"
                  placeholder={String(planReadCount)}
                  value={read}
                  onChange={(e) => setRead(e.target.value.replace(/\D/g, ''))}
                />
              </Labeled>
            </div>
            <Labeled label="Ends at (auto)">
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                {previewEnd ?? '—'}
              </div>
            </Labeled>
            <Button onClick={save} disabled={busy} className="w-full">
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
            </>
          )}
        </CardContent>
      </Card>
    </Section>
  )
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}
