import type { ReactNode } from 'react'

// iOS "inset grouped" section: a muted header label sits ABOVE the card, and an
// optional action (e.g. a picker) sits to its right. The card passed as children
// then holds only content, so its rows can run the card's full width on mobile.
export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground/70">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
