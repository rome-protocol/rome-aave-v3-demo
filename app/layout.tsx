import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Rome Aave V3 — Lending on Solana",
  description: "Canonical Aave V3 deployed on Rome Protocol. Supply, borrow, repay, withdraw, liquidate, flash loan.",
  icons: { icon: "/assets/logomark-purple.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="stylesheet" href="/styles.css" />
        {/* Render-blocking, before paint: sets data-theme from the persisted
            preference (or OS) so there's no dark→light flash. Static asset,
            not inline, to keep the document CSP-clean. */}
        <script src="/theme-init.js" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
