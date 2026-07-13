// UTC instant → RFC 5545 basic-format 'YYYYMMDDTHHMMSSZ'. Leaf module (no Buffer, no
// DB) so the client-imported links.ts can reuse it without pulling ics.ts (which
// folds octets via Buffer) into the browser bundle. Also drives Google's `dates`.
export function toIcsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}
