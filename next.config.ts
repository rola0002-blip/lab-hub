import type { NextConfig } from "next";

// Internet-facing response headers (SP7 §7.1). Applied to every route (source '/:path*').
// The CSP ships REPORT-ONLY so nothing breaks; 'unsafe-inline' accommodates the inline
// theme-boot script and Next/Tailwind inline styles, and connect-src 'self' covers SSE.
// Enforcement (nonces/hashes + a report sink, then flipping to Content-Security-Policy and
// dropping X-Frame-Options for the enforced frame-ancestors) is a documented follow-up wave.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy-Report-Only",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Next lets the LAST matching entry win a same-key conflict, so this
      // /sw.js pin deliberately comes after the catch-all — a Cache-Control
      // added to securityHeaders later cannot override it and stall SW updates.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default nextConfig;
