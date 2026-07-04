import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Section } from '@/components/Section'
import { cn } from '@/lib/utils'
import { getLogs, getPlanReads, toggleReadDay, type PlanReads } from '@/lib/api'
import { formatTR, TR_MONTHS, TR_WEEKDAYS } from '@/lib/date'

function iso(y: number, mZero: number, d: number) {
  return `${y}-${String(mZero + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

type Mode = 'mine' | 'everyone'

export function CalendarCard({
  membershipId,
  groupCode,
  today,
  planStart,
  planEnd,
  hasSlice,
  refresh,
  onChanged,
  footer,
}: {
  membershipId: number
  groupCode: string
  today: string
  planStart: string
  planEnd: string | null
  hasSlice: boolean
  refresh?: number
  onChanged: () => void
  footer?: ReactNode
}) {
  const [mode, setMode] = useState<Mode>(hasSlice ? 'mine' : 'everyone')
  // Without a saved slice the reader has no personal schedule to track, so the
  // "Me" calendar (and its "I read today" button) is unavailable — only the
  // group view makes sense.
  const activeMode: Mode = hasSlice ? mode : 'everyone'
  // Open on the plan's start month, not today, so the beginning of the plan is
  // where the reader lands.
  const [cursor, setCursor] = useState(() => {
    const [y, m] = planStart.split('-').map(Number)
    return { y, m: m - 1 }
  })
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<Set<string>>(new Set())
  const [group, setGroup] = useState<PlanReads | null>(null)
  const [selected, setSelected] = useState(today)

  const loadMine = useCallback(async () => {
    setLogs(new Set(await getLogs(membershipId)))
  }, [membershipId])
  const loadGroup = useCallback(async () => {
    setGroup(await getPlanReads(groupCode))
  }, [groupCode])

  useEffect(() => {
    void loadMine()
  }, [loadMine, refresh])
  useEffect(() => {
    if (activeMode === 'everyone') void loadGroup()
  }, [activeMode, loadGroup, refresh])

  const byDate = useMemo(() => {
    const map = new Map<string, Set<number>>()
    for (const r of group?.reads ?? []) {
      if (!map.has(r.log_date)) map.set(r.log_date, new Set())
      map.get(r.log_date)!.add(r.membership_id)
    }
    return map
  }, [group])

  async function toggleMine(date: string, next: boolean) {
    setBusy(true)
    setLogs((prev) => {
      const s = new Set(prev)
      if (next) s.add(date)
      else s.delete(date)
      return s
    })
    try {
      await toggleReadDay(membershipId, date, next)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate()
  const firstWeekday = (new Date(Date.UTC(cursor.y, cursor.m, 1)).getUTCDay() + 6) % 7
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const ym = cursor.y * 12 + cursor.m
  const [sy, sm] = planStart.split('-').map(Number)
  const startYm = sy * 12 + (sm - 1)
  const [ty, tm] = today.split('-').map(Number)
  const todayYm = ty * 12 + (tm - 1)
  const [ey, em] = (planEnd ?? today).split('-').map(Number)
  const endYm = ey * 12 + (em - 1)
  const canPrev = ym > startYm
  const canNext = ym < (activeMode === 'everyone' ? endYm : todayYm)

  function shift(delta: number) {
    setCursor((c) => {
      const n = c.y * 12 + c.m + delta
      return { y: Math.floor(n / 12), m: ((n % 12) + 12) % 12 }
    })
  }

  const total = group?.members.length ?? 0
  const selectedReaders = byDate.get(selected) ?? new Set<number>()
  const readTodayInWindow = today >= planStart && (!planEnd || today <= planEnd)
  const readToday = logs.has(today)

  return (
    <Section
      title="Reading calendar"
      action={
        hasSlice ? (
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value="mine">Me</option>
            <option value="everyone">Everyone</option>
          </select>
        ) : undefined
      }
    >
      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {activeMode === 'mine'
              ? 'Tap a day to mark it read. Green = read.'
              : 'Tap a day to see who read. Greener = more readers.'}
          </p>
          <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} disabled={!canPrev}>
            <ChevronLeft className="size-5" />
          </Button>
          <span className="text-sm font-medium">
            {TR_MONTHS[cursor.m]} {cursor.y}
          </span>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} disabled={!canNext}>
            <ChevronRight className="size-5" />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {TR_WEEKDAYS.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day == null) return <div key={`e${i}`} />
            const date = iso(cursor.y, cursor.m, day)
            const inWindow = date >= planStart && (!planEnd || date <= planEnd)
            const isToday = date === today

            if (activeMode === 'mine') {
              const enabled = inWindow && date <= today
              const read = logs.has(date)
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!enabled || busy}
                  onClick={() => toggleMine(date, !read)}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-md text-sm',
                    enabled ? 'cursor-pointer' : 'cursor-default text-muted-foreground/30',
                    read && 'bg-success font-medium text-white',
                    !read && enabled && 'hover:bg-accent',
                    isToday && !read && 'ring-2 ring-primary ring-inset',
                  )}
                >
                  {read ? <Check className="size-4" /> : day}
                </button>
              )
            }

            // everyone mode
            const count = byDate.get(date)?.size ?? 0
            const ratio = total ? count / total : 0
            const isSel = date === selected
            return (
              <button
                key={date}
                type="button"
                disabled={!inWindow}
                onClick={() => setSelected(date)}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-md text-sm',
                  !inWindow && 'text-muted-foreground/30',
                  ratio === 0 && inWindow && 'bg-muted/40',
                  ratio > 0 && ratio < 1 && 'bg-success/30',
                  ratio >= 1 && 'bg-success font-medium text-white',
                  isSel && 'ring-2 ring-primary ring-inset',
                )}
              >
                {day}
              </button>
            )
          })}
        </div>

        {activeMode === 'mine' && readTodayInWindow && (
          <Button
            variant={readToday ? 'secondary' : 'default'}
            className="w-full"
            disabled={busy}
            onClick={() => toggleMine(today, !readToday)}
          >
            {readToday ? (
              <>
                <Check className="size-4" /> Read today
              </>
            ) : (
              'I read today'
            )}
          </Button>
        )}

        {activeMode === 'everyone' && group && (
          <div className="rounded-lg border">
            <div className="border-b px-3 py-2 text-sm font-medium">
              {formatTR(selected)} — {selectedReaders.size} of {total} read
            </div>
            <ul className="flex flex-col divide-y">
              {group.members.map((m) => {
                const read = selectedReaders.has(m.membership_id)
                return (
                  <li key={m.membership_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full',
                        read
                          ? 'bg-success text-white'
                          : 'border-2 border-dashed border-muted-foreground/40',
                      )}
                    >
                      {read && <Check className="size-3" />}
                    </span>
                    <span className={cn('flex-1', !read && 'text-muted-foreground')}>{m.name}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

          {footer}
        </CardContent>
      </Card>
    </Section>
  )
}
