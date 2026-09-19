// Node 20.9+ ships full-icu; guard for exotic runtimes anyway.
export const TIMEZONES: readonly string[] =
  (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['Asia/Singapore']

export function isValidTimezone(v: string): boolean {
  return TIMEZONES.includes(v)
}
