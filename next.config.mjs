/** @type {import('next').NextConfig} */
const nextConfig = {
  // `standalone` produces a self-contained `.next/standalone/` directory
  // (server.js + bundled node_modules) the Docker `runner` stage copies in.
  // Mirrors the Rome portals pattern.
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
      {
        source: "/api/rome-rpc",
        destination: process.env.ROME_RPC_UPSTREAM ?? "https://hadrian.testnet.romeprotocol.xyz/",
      },
    ];
  },
};

export default nextConfig;
