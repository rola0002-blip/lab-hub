// CSV cell formatter for the RA acknowledgments export (route stays thin). Beyond
// RFC-4180 quote-escaping, a leading =, +, - or @ is neutralized with a leading
// apostrophe so a hostile name/matric/document title can never execute as a
// formula when the download opens in Excel/Sheets/Numbers (OWASP CSV injection).
// Pure and client-safe — no 'server-only'.
export const csvCell = (v: string) => {
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v
  return `"${s.replace(/"/g, '""')}"`
}
