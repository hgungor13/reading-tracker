import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CalendarClock, Check, Copy, Pencil, CopyPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  clonePlan,
  getPeriods,
  setSchedule,
  type Period,
  type PeriodUnit,
  type Plan,
} from '@/lib/api'

function todayISO() {
  return new Date().toLocaleDateString('en-CA')
}

// The period the reader should be on now: latest due on/before today, else the first.
function currentSeq(periods: Period[]): number | null {
  if (!periods.length) return null
  const today = todayISO()
  const past = periods.filter((p) => p.due_date <= today)
  return (past.length ? past[past.length - 1] : periods[0]).seq
}

export function ScheduleCard({
  plan,
  membershipId,
  onChanged,
}: {
  plan: Plan
  membershipId: number
  onChanged: () => void
}) {
  const [periods, setPeriods] = useState<Period[] | null>(null)
  const [editing, setEditing] = useState(false)

  const loadPeriods = useCallback(async () => {
    setPeriods(await getPeriods(membershipId))
  }, [membershipId])

  useEffect(() => {
    void loadPeriods()
  }, [loadPeriods, plan.end_date, plan.page_step, plan.pages_per_period, plan.period_unit])

  const hasSchedule = !!plan.end_date && !!periods?.length
  const curSeq = periods ? currentSeq(periods) : null
  const current = periods?.find((p) => p.seq === curSeq) ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-5" /> Schedule
        </CardTitle>
        <CardDescription>
          {hasSchedule
            ? `${plan.pages_per_period} pages every ${everyLabel(plan.period_unit, plan.period_every)}`
            : 'No schedule yet — set the cadence to generate your reading plan.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editing || !hasSchedule ? (
          <ScheduleForm
            plan={plan}
            onCancel={hasSchedule ? () => setEditing(false) : undefined}
            onSaved={async () => {
              setEditing(false)
              await loadPeriods()
              onChanged()
            }}
          />
        ) : (
          <>
            {current && (
              <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5">
                <p className="text-xs font-medium text-primary">This period · due {current.due_date}</p>
                <p className="text-sm">
                  Read pages{' '}
                  <span className="font-semibold">
                    {current.from_page}–{current.to_page}
                  </span>{' '}
                  ({current.page_count} pp)
                </p>
              </div>
            )}

            <ol className="flex flex-col divide-y rounded-lg border">
              {periods!.map((p) => (
                <li
                  key={p.seq}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 text-sm',
                    p.seq === curSeq && 'bg-primary/5',
                  )}
                >
                  <span className="w-5 shrink-0 text-xs text-muted-foreground">{p.seq}</span>
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">{p.due_date}</span>
                  <span className="flex-1 font-medium">
                    {p.from_page}–{p.to_page}
                  </span>
                  {p.done_date && <Check className="size-4 text-success" />}
                </li>
              ))}
            </ol>

            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit schedule
              </Button>
              <CloneButton groupCode={plan.group_code} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ScheduleForm({
  plan,
  onSaved,
  onCancel,
}: {
  plan: Plan
  onSaved: () => void
  onCancel?: () => void
}) {
  const [endDate, setEndDate] = useState(plan.end_date ?? '')
  const [readCount, setReadCount] = useState(String(plan.pages_per_period || 2))
  const [pageStep, setPageStep] = useState(plan.page_step ? String(plan.page_step) : '')
  const [unit, setUnit] = useState<PeriodUnit>(plan.period_unit ?? 'day')
  const [every, setEvery] = useState(String(plan.period_every || 1))
  const [startPage, setStartPage] = useState(String(plan.start_page || 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!endDate) {
      setError('Please choose an end date.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setSchedule(plan.group_code, {
        end_date: endDate,
        start_page: startPage ? Number(startPage) : undefined,
        pages_per_period: Number(readCount) || 1,
        page_step: pageStep ? Number(pageStep) : undefined,
        period_unit: unit,
        period_every: every ? Number(every) : 1,
      })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Labeled label="Frequency">
        <div className="grid grid-cols-3 gap-2">
          {(['day', 'week', 'month'] as PeriodUnit[]).map((u) => (
            <Button
              key={u}
              type="button"
              variant={unit === u ? 'default' : 'outline'}
              size="sm"
              onClick={() => setUnit(u)}
            >
              {u === 'day' ? 'Daily' : u === 'week' ? 'Weekly' : 'Monthly'}
            </Button>
          ))}
        </div>
      </Labeled>

      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Pages to read">
          <Input
            inputMode="numeric"
            value={readCount}
            onChange={(e) => setReadCount(e.target.value.replace(/\D/g, ''))}
            placeholder="2"
          />
        </Labeled>
        <Labeled label="Start-page jump">
          <Input
            inputMode="numeric"
            value={pageStep}
            onChange={(e) => setPageStep(e.target.value.replace(/\D/g, ''))}
            placeholder="= pages read"
          />
        </Labeled>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Start page">
          <Input
            inputMode="numeric"
            value={startPage}
            onChange={(e) => setStartPage(e.target.value.replace(/\D/g, ''))}
            placeholder="1"
          />
        </Labeled>
        <Labeled label={`Every N ${unit}s`}>
          <Input
            inputMode="numeric"
            value={every}
            onChange={(e) => setEvery(e.target.value.replace(/\D/g, ''))}
            placeholder="1"
          />
        </Labeled>
      </div>

      <Labeled label="End date (goal)">
        <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </Labeled>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={save} disabled={busy} className="flex-1">
          {busy ? 'Generating…' : 'Generate schedule'}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Note: your own start page comes from your slice if you set one; this default is used
        otherwise. "Start-page jump" blank = read contiguous pages.
      </p>
    </div>
  )
}

function CloneButton({ groupCode }: { groupCode: string }) {
  const [busy, setBusy] = useState(false)
  const [newCode, setNewCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function clone() {
    setBusy(true)
    try {
      const { group_code } = await clonePlan(groupCode)
      setNewCode(group_code)
    } finally {
      setBusy(false)
    }
  }

  if (newCode) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="flex-1"
        onClick={async () => {
          await navigator.clipboard?.writeText(newCode)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        Next: {newCode}
      </Button>
    )
  }

  return (
    <Button variant="outline" size="sm" className="flex-1" onClick={clone} disabled={busy}>
      <CopyPlus className="size-4" /> {busy ? 'Cloning…' : 'Clone next'}
    </Button>
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

function everyLabel(unit: PeriodUnit, every: number): string {
  const u = unit === 'day' ? 'day' : unit === 'week' ? 'week' : 'month'
  return every > 1 ? `${every} ${u}s` : u
}
