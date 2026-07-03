import { useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Layout } from '@/components/Layout'
import { createPlan } from '@/lib/api'

export function CreatePlan({
  onCreated,
  onBack,
}: {
  onCreated: (groupCode: string) => void
  onBack: () => void
}) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!title.trim()) {
      setError('Please enter the book title.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { group_code } = await createPlan({ title: title.trim() })
      onCreated(group_code)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Layout
      subtitle="New plan"
      right={
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back">
          <ArrowLeft className="size-5" />
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a reading plan</CardTitle>
          <CardDescription>You'll get a code to share with your group.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Book title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Atomic Habits"
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={submit} disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create plan'}
          </Button>
        </CardContent>
      </Card>
    </Layout>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  )
}
