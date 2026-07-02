import { useEffect, useState } from 'react'
import { BookOpen, BellRing, CheckCircle2, Send, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  checkPushSupport,
  getSubscription,
  isStandalone,
  sendTestPush,
  subscribeToPush,
} from '@/lib/push'

type Status = { kind: 'idle' | 'ok' | 'error' | 'busy'; msg?: string }

export function App() {
  const [support] = useState(() => checkPushSupport())
  const [subscribed, setSubscribed] = useState(false)
  const [label, setLabel] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  useEffect(() => {
    if (support.ok) getSubscription().then((s) => setSubscribed(!!s))
  }, [support.ok])

  async function onSubscribe() {
    setStatus({ kind: 'busy', msg: 'Requesting permission…' })
    try {
      await subscribeToPush(label.trim() || 'My device')
      setSubscribed(true)
      setStatus({ kind: 'ok', msg: 'Subscribed! This device will receive pushes.' })
    } catch (e) {
      setStatus({ kind: 'error', msg: (e as Error).message })
    }
  }

  async function onTestPush() {
    setStatus({ kind: 'busy', msg: 'Sending test push…' })
    try {
      const { sent, failed } = await sendTestPush()
      setStatus({
        kind: 'ok',
        msg: `Test push sent to ${sent} device(s)${failed ? `, ${failed} failed` : ''}.`,
      })
    } catch (e) {
      setStatus({ kind: 'error', msg: (e as Error).message })
    }
  }

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
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reading Tracker</h1>
          <p className="text-sm text-muted-foreground">Push notification spike</p>
        </div>
      </header>

      {/* iOS Add-to-Home-Screen guidance — the make-or-break step on iPhone */}
      {support.ok === false && support.iosNeedsInstall && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="size-5" /> Install on your iPhone first
            </CardTitle>
            <CardDescription>
              iOS only delivers push notifications to installed web apps.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Tap the <strong>Share</strong> button in Safari.</li>
              <li>Choose <strong>Add to Home Screen</strong>.</li>
              <li>Open the app from its new icon, then come back here.</li>
            </ol>
          </CardContent>
        </Card>
      )}

      {support.ok === false && !support.iosNeedsInstall && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Not supported</CardTitle>
            <CardDescription>{support.reason}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {support.ok && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="size-5" /> Notifications
            </CardTitle>
            <CardDescription>
              {subscribed
                ? 'This device is subscribed.'
                : 'Enable notifications to test the push path.'}
              {isStandalone() ? '' : ' (Tip: works best when installed to Home Screen.)'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Input
              placeholder="Device label (e.g. Hüseyin's iPhone)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={subscribed}
            />
            <div className="flex gap-2">
              <Button
                onClick={onSubscribe}
                disabled={subscribed || status.kind === 'busy'}
                className="flex-1"
              >
                {subscribed ? (
                  <>
                    <CheckCircle2 className="size-4" /> Subscribed
                  </>
                ) : (
                  <>
                    <BellRing className="size-4" /> Enable notifications
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                onClick={onTestPush}
                disabled={status.kind === 'busy'}
              >
                <Send className="size-4" /> Test push
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {status.msg && (
        <p
          className={
            status.kind === 'error'
              ? 'text-sm text-destructive'
              : 'text-sm text-muted-foreground'
          }
        >
          {status.msg}
        </p>
      )}

      <footer className="mt-auto pt-6 text-center text-xs text-muted-foreground">
        Step 1 of the build — proving Web Push before features.
      </footer>
    </main>
  )
}
