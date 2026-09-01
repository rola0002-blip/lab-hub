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
    await fetch('/api/push/subscription', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
    })
    return true
  } catch (e) {
    console.warn('Push opt-in failed:', e)
    return false
  }
}
