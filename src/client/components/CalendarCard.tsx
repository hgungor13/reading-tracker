import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getLogs, toggleReadDay } from '@/lib/api'

function iso(y: number, mZero: number, d: number) {
  return `${y}-${String(mZero + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export function CalendarCard({
  membershipId,
  today,
  planStart,
  planEnd,
  refresh,
  onChanged,
  footer,
}: {
  membershipId: number
  today: string
  planStart: string
  planEnd: string | null
  refresh?: number
  onChanged: () => void
  footer?: ReactNode
}) {
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split('-').map(Number)
    return { y, m: m - 1 }
  })
  const [logs, setLogs] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLogs(new Set(await getLogs(membershipId)))
  }, [membershipId])
  useEffect(() => {
    void load()
  }, [load, refresh])

  async function toggle(date: string, next: boolean) {
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
  const firstWeekday = (new Date(Date.UTC(cursor.y, cursor.m, 1)).getUTCDay() + 6) % 7 // Mon=0
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  // Bound month nav to [plan start month, current month].
  const ym = cursor.y * 12 + cursor.m
  const [sy, sm] = planStart.split('-').map(Number)
  const startYm = sy * 12 + (sm - 1)
  const [ty, tm] = today.split('-').map(Number)
  const todayYm = ty * 12 + (tm - 1)
  const canPrev = ym > startYm
  const canNext = ym < todayYm

  function shift(delta: number) {
    setCursor((c) => {
      const n = c.y * 12 + c.m + delta
      return { y: Math.floor(n / 12), m: ((n % 12) + 12) % 12 }
    })
  }

  const readTodayInWindow = today >= planStart && (!planEnd || today <= planEnd)
  const readToday = logs.has(today)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reading calendar</CardTitle>
        <CardDescription>Tap a day to mark it read. Green = read.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} disabled={!canPrev}>
            <ChevronLeft className="size-5" />
          </Button>
          <span className="text-sm font-medium">
            {MONTHS[cursor.m]} {cursor.y}
          </span>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} disabled={!canNext}>
            <ChevronRight className="size-5" />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {WEEKDAYS.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day == null) return <div key={`e${i}`} />
            const date = iso(cursor.y, cursor.m, day)
            const enabled = date >= planStart && (!planEnd || date <= planEnd) && date <= today
            const read = logs.has(date)
            const isToday = date === today
            return (
              <button
                key={date}
                type="button"
                disabled={!enabled || busy}
                onClick={() => toggle(date, !read)}
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
          })}
        </div>

        {readTodayInWindow && (
          <Button
            variant={readToday ? 'secondary' : 'default'}
            className="w-full"
            disabled={busy}
            onClick={() => toggle(today, !readToday)}
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
        {footer}
      </CardContent>
    </Card>
  )
}
