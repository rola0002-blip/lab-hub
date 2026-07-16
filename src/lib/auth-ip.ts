// Pure, testable construction of better-auth's advanced.ipAddress config.
// Unset/blank ⇒ undefined ⇒ better-auth keeps its x-forwarded-for default.
// Set (e.g. 'cf-connecting-ip' behind Cloudflare) ⇒ read ONLY that header:
// a single, proxy-set, unspoofable value that restores per-client limiting.
export function trustedIpConfig(header: string | undefined) {
  const h = header?.trim()
  if (!h) return undefined
  return { ipAddress: { ipAddressHeaders: [h] } }
}
