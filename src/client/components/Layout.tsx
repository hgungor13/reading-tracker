import type { ReactNode } from 'react'
import { BookOpen } from 'lucide-react'

// App shell with safe-area padding (clears the iPhone notch when installed).
export function Layout({
  children,
  subtitle,
  right,
}: {
  children: ReactNode
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <main
      className="mx-auto flex min-h-dvh max-w-md flex-col gap-6
        pt-[calc(env(safe-area-inset-top)+3rem)]
        pb-[calc(env(safe-area-inset-bottom)+2rem)]
        pl-[calc(env(safe-area-inset-left)+1.25rem)]
        pr-[calc(env(safe-area-inset-right)+1.25rem)]"
    >
      <header className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <BookOpen className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">Reading Tracker</h1>
          {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </main>
  )
}
