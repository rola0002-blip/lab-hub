import { healPlan, PUSH_ENDPOINT_KEY } from './push-heal'

// VAPID public keys are base64url; the Push API wants the raw bytes as a BufferSource.
// Back the view with a concrete ArrayBuffer so it satisfies applicationServerKey's type.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// The subscribe flow used by the notification wizard: register SW → VAPID key
// → subscribe → POST. Failures are swallowed with console.warn (returns false)
// so no caller's surface breaks.
export async function subscribeToPush(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    const vr = await fetch('/api/push/vapid')
    const { publicKey } = await vr.json()
    if (!publicKey) return false // push disabled server-side (no VAPID keys)
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
    const j = sub.toJSON()
    const res = await fetch('/api/push/subscription', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
    })
    // Remember the endpoint so the launch-time heal (below) can detect
    // rotation with zero network calls in the steady state. fetch doesn't
    // throw on 4xx/5xx — only record the marker once the server accepted it.
    if (res.ok && typeof window !== 'undefined' && j.endpoint) window.localStorage.setItem(PUSH_ENDPOINT_KEY, j.endpoint)
    return true
  } catch (e) {
    console.warn('Push opt-in failed:', e)
    return false
  }
}

// Best-effort launch-time heal (wired from SwRegister): re-POST a rotated
// endpoint the server may not know, or re-mint a subscription that vanished
// despite the stored marker's proof of prior opt-in (iOS silent revocation).
// Never throws; every failure is swallowed — the wizard remains the explicit
// recovery path.
export async function healPushSubscription(): Promise<void> {
  try {
    if (typeof window === 'undefined' || '__TAURI__' in window) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    const current = sub?.toJSON().endpoint ?? null
    const plan = healPlan({
      permissionGranted: true,
      storedEndpoint: window.localStorage.getItem(PUSH_ENDPOINT_KEY),
      currentEndpoint: current,
    })
    if (plan === 'skip') return
    if (plan === 'resubscribe') {
      // subscribeToPush records the marker itself — and only after a POST the
      // server accepted — so there is nothing to persist here.
      await subscribeToPush()
      return
    }
    const j = sub!.toJSON()
    const res = await fetch('/api/push/subscription', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
    })
    // Same guard as subscribeToPush: fetch doesn't throw on 4xx/5xx, so the
    // marker must only be recorded once the POST actually succeeded.
    if (res.ok && j.endpoint) window.localStorage.setItem(PUSH_ENDPOINT_KEY, j.endpoint)
  } catch (e) {
    console.warn('Push heal failed:', e)
  }
}
