// Pure, dependency-free profile-field validators — unit-tested and inside the
// src/lib coverage gate. The IANA set is resolved once from the runtime ICU and
// is the same set the timezone <select> is built from on the client.
export function isValidDisplayName(name: string): boolean {
  const n = name.trim()
  return n.length >= 1 && n.length <= 80
}

export function isValidTitle(title: string): boolean {
  return title.trim().length <= 100
}

let TZ_SET: Set<string> | null = null
function tzSet(): Set<string> {
  if (!TZ_SET) TZ_SET = new Set(Intl.supportedValuesOf('timeZone'))
  return TZ_SET
}
export function isSupportedTimezone(tz: string): boolean {
  return tzSet().has(tz)
}
