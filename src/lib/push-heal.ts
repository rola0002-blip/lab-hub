// Launch-time push-subscription self-heal decision (pure). iOS can silently
// revoke an installed PWA's subscription and push services rotate endpoints;
// pushsubscriptionchange (sw.js) covers SW-side rotation, this covers "the
// app opened — does the server still know this endpoint?". The stored
// endpoint keeps the steady state at zero network calls.
export const PUSH_ENDPOINT_KEY = 'labhub.push-endpoint'

export function healPlan(state: {
  permissionGranted: boolean
  storedEndpoint: string | null
  currentEndpoint: string | null
}): 'skip' | 'repost' | 'resubscribe' {
  if (!state.permissionGranted) return 'skip'
  if (state.currentEndpoint === null) return 'resubscribe'
  if (state.storedEndpoint !== state.currentEndpoint) return 'repost'
  return 'skip'
}
