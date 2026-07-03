import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronDown, Copy, CopyPlus, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatTR } from '@/lib/date'
import {
  clonePlan,
  getPeriods,
  setSchedule,
  type Period,
  type PeriodUnit,
  type Plan,
} from '@/lib/api'

function currentSeq(periods: Period[], today: string): number | null {
  if (!periods.length) return null
  const past = periods.filter((p) => p.due_date <= today)
  return (past.length ? past[past.length - 1] : periods[0]).seq
}

function everyLabel(unit: PeriodUnit, every: number): string {
  const u = unit === 'day' ? 'day' : unit === 'week' ? 'week' : 'month'
  return every > 1 ? `${every} ${u}s` : u
}

// A collapsible card (accordion).
function AccordionCard({
  title,
  subtitle,
  defaultOpen,
  className,
  children,
}: {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <Card className={cn('gap-0 py-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
      >
        <div className="min-w-0">
          <div className="text-base font-semibold">{title}</div>
          {subtitle && !open && (
            <div className="truncate text-sm text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <ChevronDown
          className={cn(
            'size-5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </Card>
  )
}

// ---- My schedule (generated output) ---------------------------------------

export function MyScheduleCard({
  plan,
  membershipId,
  today,
  refresh,
  hasSlice,
}: {
  plan: Plan
  membershipId: number
  today: string
  refresh?: number
  hasSlice: boolean
}) {
  const [periods, setPeriods] = useState<Period[] | null>(null)

  const loadPeriods = useCallback(async () => {
    setPeriods(await getPeriods(membershipId))
  }, [membershipId])
  useEffect(() => {
    void loadPeriods()
  }, [loadPeriods, plan.end_date, plan.page_step, plan.pages_per_period, plan.period_unit, refresh])

  const hasSchedule = !!plan.end_date && !!periods?.length
  const curSeq = periods ? currentSeq(periods, today) : null
  const current = periods?.find((p) => p.seq === curSeq) ?? null
  const title = hasSlice ? 'My schedule' : 'Example schedule'
  const subtitle = !hasSchedule
    ? 'Not set up yet'
    : hasSlice
      ? `${plan.pages_per_period} pages every ${everyLabel(plan.period_unit, plan.period_every)}`
      : 'Example from page 1'

  return (
    <AccordionCard title={title} subtitle={subtitle} defaultOpen>
      {!hasSchedule ? (
        <p className="text-sm text-muted-foreground">
          No schedule yet — the organizer sets it in Plan settings.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {!hasSlice && (
            <p className="text-sm text-muted-foreground">
              Example from page 1 — set your Initial page slice for your own schedule.
            </p>
          )}
          {current && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5">
              <p className="text-xs font-medium text-primary">
                This period · due {formatTR(current.due_date)}
              </p>
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
                <span className="w-24 shrink-0 text-xs text-muted-foreground">
                  {formatTR(p.due_date)}
                </span>
                <span className="flex-1 font-medium">
                  {p.from_page}–{p.to_page}
                </span>
                {p.done_date && <Check className="size-4 text-success" />}
              </li>
            ))}
          </ol>
        </div>
      )}
    </AccordionCard>
  )
}

// ---- Plan settings (inputs) with clone + danger zone ----------------------

export function PlanSettingsCard({ plan, onChanged }: { plan: Plan; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const notSetUp = !plan.end_date

  return (
    <AccordionCard
      title="Plan settings"
      subtitle={notSetUp ? 'Set up the schedule' : `${plan.title} · ${everyLabel(plan.period_unit, plan.period_every)}`}
      defaultOpen={notSetUp}
      className={notSetUp ? undefined : 'border-destructive/30'}
    >
      {notSetUp ? (
        <ScheduleForm plan={plan} onSaved={onChanged} />
      ) : editing ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4" /> This changes everyone's schedule.
          </p>
          <ScheduleForm
            plan={plan}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false)
              onChanged()
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <Summary
              label="Book"
              value={`${plan.title}${plan.total_pages ? ` · ${plan.total_pages} pp` : ''}`}
              wide
            />
            <Summary
              label="Rhythm"
              value={`read ${plan.pages_per_period}, jump ${plan.page_step || plan.pages_per_period}`}
            />
            <Summary label="Every" value={everyLabel(plan.period_unit, plan.period_every)} />
            <Summary label="Start" value={formatTR(plan.start_date)} />
            <Summary label="End" value={formatTR(plan.end_date)} />
          </dl>

          <CloneButton groupCode={plan.group_code} />

          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">Danger zone</p>
            <p className="mb-2 text-xs text-muted-foreground">
              Editing regenerates every reader's schedule.
            </p>
            <Button variant="destructive" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit plan settings
            </Button>
          </div>
        </div>
      )}
    </AccordionCard>
  )
}

function Summary({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

// ---- Shared form + clone --------------------------------------------------

function ScheduleForm({
  plan,
  onSaved,
  onCancel,
}: {
  plan: Plan
  onSaved: () => void
  onCancel?: () => void
}) {
  const [title, setTitle] = useState(plan.title ?? '')
  const [totalPages, setTotalPages] = useState(plan.total_pages ? String(plan.total_pages) : '')
  const [startDate, setStartDate] = useState(plan.start_date ?? '')
  const [endDate, setEndDate] = useState(plan.end_date ?? '')
  const [readCount, setReadCount] = useState(String(plan.pages_per_period || 2))
  const [pageStep, setPageStep] = useState(plan.page_step ? String(plan.page_step) : '')
  const [unit, setUnit] = useState<PeriodUnit>(plan.period_unit ?? 'day')
  const [every, setEvery] = useState(String(plan.period_every || 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!title.trim()) return setError('Please enter the book title.')
    if (!startDate) return setError('Please choose a start date.')
    if (!endDate) return setError('Please choose an end date.')
    if (endDate < startDate) return setError('End date must be on or after the start date.')
    setBusy(true)
    setError(null)
    try {
      await setSchedule(plan.group_code, {
        title: title.trim(),
        total_pages: totalPages ? Number(totalPages) : undefined,
        start_date: startDate,
        end_date: endDate,
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

  const unitNoun = unit === 'day' ? 'day' : unit === 'week' ? 'week' : 'month'

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Book title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sapiens" />
        </Labeled>
        <Labeled label="Total pages">
          <Input
            inputMode="numeric"
            value={totalPages}
            onChange={(e) => setTotalPages(e.target.value.replace(/\D/g, ''))}
            placeholder="440"
          />
        </Labeled>
      </div>

      <Labeled label="Repeat every">
        <div className="flex gap-2">
          <Input
            inputMode="numeric"
            className="w-16"
            value={every}
            onChange={(e) => setEvery(e.target.value.replace(/\D/g, ''))}
            placeholder="1"
          />
          <div className="grid flex-1 grid-cols-3 gap-2">
            {(['day', 'week', 'month'] as PeriodUnit[]).map((u) => (
              <Button
                key={u}
                type="button"
                variant={unit === u ? 'default' : 'outline'}
                size="sm"
                onClick={() => setUnit(u)}
              >
                {u === 'day' ? 'Day' : u === 'week' ? 'Week' : 'Month'}
              </Button>
            ))}
          </div>
        </div>
      </Labeled>
      <p className="-mt-1 text-xs text-muted-foreground">
        = every {Number(every) > 1 ? `${every} ${unitNoun}s` : unitNoun}.
      </p>

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
        <Labeled label="Start date">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Labeled>
        <Labeled label="End date (goal)">
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Labeled>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={save} disabled={busy} className="flex-1">
          {busy ? 'Generating…' : 'Save & generate'}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Each reader's start page comes from their own slice. "Start-page jump" blank = read
        contiguous pages.
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
        className="w-full"
        onClick={async () => {
          await navigator.clipboard?.writeText(newCode)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        Next window created: {newCode}
      </Button>
    )
  }

  return (
    <Button variant="outline" className="w-full" onClick={clone} disabled={busy}>
      <CopyPlus className="size-4" /> {busy ? 'Cloning…' : 'Clone for next window'}
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
