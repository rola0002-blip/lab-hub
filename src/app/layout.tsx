import type { Metadata, Viewport } from "next";
import { Lato } from "next/font/google";
import "./globals.css";

const lato = Lato({
  weight: ["400", "700", "900"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-lato",
});

// Every page is per-request (session + org lookups); force-dynamic stops Next
// from prerendering pages at build time, which would query a database that
// doesn't exist in the Docker build stage (and quietly hit the dev DB locally).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "COLOSSUS",
  description: "Self-hosted lab platform",
  applicationName: "COLOSSUS",
  // iOS Web Push only registers from a home-screen PWA launched standalone;
  // appleWebApp emits apple-mobile-web-app-capable + title, and the manifest
  // (src/app/manifest.ts) supplies display:standalone.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "COLOSSUS" },
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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${lato.variable} h-full antialiased`}
    >
      <head>
        <script
          // Static string only — the sole sanctioned dangerouslySetInnerHTML in the app.
          // Applies the saved/OS theme AND saved accent before first paint to avoid a
          // flash. An unknown accent is a harmless no-op (CSS falls back to teal).
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}document.documentElement.dataset.theme=t;var a=localStorage.getItem('accent');if(a){document.documentElement.dataset.accent=a}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
