import { PlusCircle, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Layout } from '@/components/Layout'

export function Home({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <Layout subtitle="Read together, every day">
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
          <Button className="w-full" onClick={onCreate}>
            Create a plan
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LogIn className="size-5" /> Join a group
          </CardTitle>
          <CardDescription>Have a code? Enter your name and start reading.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" className="w-full" onClick={onJoin}>
            Join with a code
          </Button>
        </CardContent>
      </Card>
    </Layout>
  )
}
