import type { Metadata } from "next";
import { connection } from "next/server";
import "./styles.css";
import "./globals.css";
import "./theme.css";
import "./aave-look.css";
import "./token.css";
import { Providers } from "./providers";
import { NETWORK_ON } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Rome Aave V3 — Lending ${NETWORK_ON}`,
  description: `Aave V3 ${NETWORK_ON}, enabled by Rome. Supply, borrow, repay, withdraw, liquidate, flash loan.`,
  icons: { icon: "/assets/logomark-purple.svg" },
};

// Key via a variable so the bundler does not inline the build-time value.
const WC_KEY = "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request: the WalletConnect id is set when the container starts,
  // and lib/wagmi.ts reads it from the meta tag below.
  await connection();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="theme-color" content="#0A0421" />
        <meta name="walletconnect-project-id" content={process.env[WC_KEY] ?? ""} />
        {/* Render-blocking, before paint: sets the theme from the persisted
            choice (dark by default) so there is no flash of the wrong theme. Static asset,
            not inline, to keep the document CSP-clean. */}
        <script src="/theme-init.js" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
