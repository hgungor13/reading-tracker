// Client-side Web Push helpers: feature detection, the iOS "installed?" check,
// permission + subscription, and talking to our Worker's /api endpoints.

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: string; iosNeedsInstall?: boolean }

// iOS only allows Web Push when the PWA is launched from the Home Screen
// (display-mode: standalone), not in a normal Safari tab.
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari-specific legacy flag
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; detect touch to disambiguate
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function checkPushSupport(): PushSupport {
  if (!('serviceWorker' in navigator)) {
    return { ok: false, reason: 'This browser has no service worker support.' }
  }
  if (!('PushManager' in window) || !('Notification' in window)) {
    if (isIOS() && !isStandalone()) {
      return {
        ok: false,
        iosNeedsInstall: true,
        reason:
          'On iPhone, add this app to your Home Screen and open it from there to enable notifications.',
      }
    }
    return { ok: false, reason: 'Push notifications are not supported here.' }
  }
  return { ok: true }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function getVapidPublicKey(): Promise<string> {
  const res = await fetch('/api/vapid-public-key')
  if (!res.ok) throw new Error('Could not fetch VAPID public key from server.')
  const { publicKey } = (await res.json()) as { publicKey: string }
  if (!publicKey) throw new Error('Server returned no VAPID public key.')
  return publicKey
}

export async function getSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

// Ask permission, subscribe with the server VAPID key, and register the
// subscription with the Worker. `label` identifies the device; `userId` ties
// the subscription to a person so the nightly cron can target non-readers.
export async function subscribeToPush(label: string, userId?: number): Promise<void> {
  const support = checkPushSupport()
  if (!support.ok) throw new Error(support.reason)

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.')
  }

  const reg = await navigator.serviceWorker.ready
  const publicKey = await getVapidPublicKey()

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    })
  }

  const res = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), label, user_id: userId }),
  })
  if (!res.ok) throw new Error('Failed to register subscription with the server.')
}

// Spike helper: ask the server to push a test notification to all devices.
export async function sendTestPush(): Promise<{ sent: number; failed: number }> {
  const res = await fetch('/api/test-push', { method: 'POST' })
  if (!res.ok) throw new Error('Test push request failed.')
  return (await res.json()) as { sent: number; failed: number }
}
