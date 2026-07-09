import type { Metadata, Viewport } from "next";
import "./globals.css";

// Every page is per-request (session + org lookups); force-dynamic stops Next
// from prerendering pages at build time, which would query a database that
// doesn't exist in the Docker build stage (and quietly hit the dev DB locally).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LabHub",
  description: "Self-hosted lab platform",
  applicationName: "LabHub",
  // iOS Web Push only registers from a home-screen PWA launched standalone;
  // appleWebApp emits apple-mobile-web-app-capable + title, and the manifest
  // (src/app/manifest.ts) supplies display:standalone.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "LabHub" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0d9488",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
