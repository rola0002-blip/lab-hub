// Web Push endpoint validation (SP7 F6). The subscription `endpoint` is a member-supplied URL
// that the server later POSTs to (src/lib/push.ts sendPush → webpush.sendNotification), so an
// unvalidated value is a blind SSRF sink reachable by any invited member. We allowlist the known
// browser push services — the tightest control and exactly how Web Push actually works — which
// inherently rejects http://, loopback, private/link-local hosts, and host.docker.internal.

// Host must equal, or be a subdomain of, one of these. Covers Chrome/Edge (FCM), Firefox
// (Mozilla autopush), Safari/iOS (Apple), and Windows/Edge (WNS).
const ALLOWED_HOST_SUFFIXES = [
  'fcm.googleapis.com', // Chrome / FCM
  'android.googleapis.com', // legacy GCM/FCM
  'push.services.mozilla.com', // Firefox autopush (updates.push.services.mozilla.com)
  'push.apple.com', // Apple Web Push (web.push.apple.com)
  'notify.windows.com', // Microsoft WNS (*.notify.windows.com)
]

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return ALLOWED_HOST_SUFFIXES.some((s) => h === s || h.endsWith('.' + s))
}

/**
 * True only for an https URL whose host is a known push service. Everything else — http,
 * internal/loopback/private hosts, host.docker.internal, arbitrary internet targets, or an
 * unparseable string — is rejected.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return hostAllowed(url.hostname)
}
