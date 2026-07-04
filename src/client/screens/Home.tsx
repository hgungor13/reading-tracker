import { useEffect, useState } from 'react'
import { PlusCircle, LogIn, BookOpen, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Layout } from '@/components/Layout'
import { getUserMemberships, type JoinedPlan } from '@/lib/api'
import { getIdentity, type Session } from '@/lib/session'

export function Home({
  onCreate,
  onJoin,
  onOpenPlan,
}: {
  onCreate: () => void
  onJoin: () => void
  onOpenPlan: (s: Session) => void
}) {
  const [identity] = useState(() => getIdentity())
  const [plans, setPlans] = useState<JoinedPlan[] | null>(null)

  useEffect(() => {
    if (!identity) {
      setPlans([])
      return
    }
    getUserMemberships(identity.userId)
      .then(setPlans)
      .catch(() => setPlans([]))
  }, [identity])

  const hasPlans = !!plans && plans.length > 0

  return (
    <Layout subtitle="Read together, every day">
      {hasPlans && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold text-muted-foreground">Your plans</h2>
          <Card className="py-0">
            <CardContent className="flex flex-col divide-y p-0">
              {plans!.map((p) => (
                <button
                  key={p.membership_id}
                  type="button"
                  onClick={() =>
                    onOpenPlan({
                      membershipId: p.membership_id,
                      userId: p.user_id,
                      userName: p.user_name,
                      groupCode: p.group_code,
                      planName: p.plan_name,
                    })
                  }
                  className="flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
                >
                  <BookOpen className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.plan_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.book_title} · {p.group_code}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LogIn className="size-5" /> {hasPlans ? 'Join another group' : 'Join a group'}
          </CardTitle>
          <CardDescription>
            {identity
              ? `Have a code? Join as ${identity.userName}.`
              : 'Have a code? Enter your name and start reading.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant={hasPlans ? 'secondary' : 'default'} className="w-full" onClick={onJoin}>
            Join with a code
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PlusCircle className="size-5" /> Start a reading group
          </CardTitle>
          <CardDescription>
            Create a plan for a book and get a code to share with your group.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" className="w-full" onClick={onCreate}>
            Create a plan
          </Button>
        </CardContent>
      </Card>
    </Layout>
  )
}
