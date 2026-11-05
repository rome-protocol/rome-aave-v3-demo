import hadrianChain from "./lib/hadrian-chain.json" with { type: "json" };
/** @type {import('next').NextConfig} */
const nextConfig = {
  // `standalone` produces a self-contained `.next/standalone/` directory
  // (server.js + bundled node_modules) the Docker `runner` stage copies in.
  // Mirrors rome-sovereign-portal / rome-oracle-portal pattern.
  output: 'standalone',
  reactStrictMode: true,
  webpack: (config) => {
    // Suppress optional dep warnings from wallet adapters.
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    return config;
  },
  // Same-origin proxy for the EVM RPC (the chain's RPC doesn't expose CORS
  // headers). rewrites() resolve before app code loads, so the upstream comes
  // from an env var (per-deploy) with the Hadrian testnet RPC as the dev
  // default — never a baked production value. Set ROME_RPC_UPSTREAM in any
  // non-Hadrian deploy.
  async rewrites() {
    return [
      // Browsers ask for /favicon.ico regardless of the <link>; serve the logo.
      { source: "/favicon.ico", destination: "/assets/logomark-purple.svg" },
      {
        source: "/api/rome-rpc",
        destination: process.env.ROME_RPC_UPSTREAM ?? "https://hadrian.testnet.romeprotocol.xyz/",
      },
      // The Solana lane broadcasts its signed v1 wires to the chain's Solana
      // substrate RPC (never to the proxy); same CORS gap, same forwarder
      // pattern. Default = the vendored chain.json's solana.rpc; override with
      // SOLANA_RPC_UPSTREAM per deploy.
      {
        source: "/api/solana-rpc",
        destination: process.env.SOLANA_RPC_UPSTREAM ?? hadrianChain.solana.rpc,
      },
    ];
  },
};

export default nextConfig;
