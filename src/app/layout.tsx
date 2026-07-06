import type { Metadata } from "next";
import "./globals.css";

// Every page is per-request (session + org lookups); force-dynamic stops Next
// from prerendering pages at build time, which would query a database that
// doesn't exist in the Docker build stage (and quietly hit the dev DB locally).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LabHub",
  description: "Self-hosted lab platform",
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
