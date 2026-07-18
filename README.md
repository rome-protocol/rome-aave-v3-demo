# Rome Aave V3 — Demo UI

Demo web app that wraps canonical [Aave V3.6 on Rome](https://github.com/aave/aave-v3-origin) with the Rome product-suite chrome. Reads chain config + contract addresses from [`@rome-protocol/registry`](https://github.com/rome-protocol/rome-registry) (`apps/aave/<chainId>-<slug>.json`) at boot and per-reserve / per-user data from live RPC at request time.

**Live:** `aave.testnet.romeprotocol.xyz` (Hadrian, chain 200010).

## Docs

- **[User guide](docs/USER-GUIDE.md)** — how to use the app (connect, supply/borrow/withdraw/repay, liquidate, flash loan, faucet) + how to deploy the demo app.
- **[Aave V3 on Rome](https://github.com/aave/aave-v3-origin/blob/main/docs/AAVE-V3-ON-ROME.md)** (contracts repo) — how the protocol works on Rome, contract deploy, oracle (OG-V2), flash-loan pattern, ops tasks.

## Status — shipped + live

Fully wired: native Next.js 15 pages, registry + live-RPC data, all action
modals (Supply / Borrow / Repay / Withdraw / liquidationCall / flashLoanSimple
+ multi-asset flashLoan), at-risk feed (`/api/at-risk`), history indexer,
dual-theme (dark/light), wagmi + the the Rome web app UniWallet stack. Real assets are
priced from live Pyth via Oracle Gateway V2.

## Local dev

```bash
npm install
npm run dev
# open http://localhost:3000  (or 3001 if 3000 is in use)
```

## Live deployment reference

Hadrian (chain 200010, testnet):

| Contract | Address |
|---|---|
| `Pool` | `0x56cD6Bd0FDAd19F44df9D8b9aadD84f964c2fE11` |
| `PoolAddressesProvider` | `0xDba99FC11d7383e722F6DEc181F71560b2780f14` |
| `PoolConfigurator` | `0x0C87be51a3676B5B5d9929C99B3F8496ecBB8B03` |
| `AaveOracle` | `0x8A7dcF67BBe2BacF6f9d82E14c16B76df6b9DB11` |
| `AaveProtocolDataProvider` | `0xE58Ea21dBF3f117cC8e39895E9Dcb843A31441d4` |
| `UiPoolDataProviderV3` | `0x62c3264DBD6c09F98719B83B38fe0084F6dDf907` |

Reserves: wUSDC (\$1, 6dec) / wETH (\$3000, 8dec) / wSOL (\$200, 9dec). MockAggregator prices frozen at deploy.

Always read addresses from the registry, never hardcode here.

## Architecture

```
aave-demo/
├── app/                       Next.js App Router
│   ├── layout.tsx              dark-mode shell + styles.css link
│   ├── page.tsx                mounts design via Babel-standalone
│   └── globals.css             minimal base reset
├── components/                 (phase 2) ported components
├── lib/
│   └── registry/               (phase 2) build-time registry loader
├── public/
│   ├── styles.css              from the Rome design system package
│   ├── fonts/                  system-ui/Serif + IBM Plex Mono
│   ├── assets/                 Rome logomark + wordmark (purple/white/black)
│   └── design-src/             the 14 JSX files from the Rome design system
└── scripts/                    check-registry-drift.mjs (vendored-JSON ↔ registry guard)
```

## Vocabulary rule

The display layer never says `wUSDC` / `wETH` / `cached` / `wrapper` / `SPL`. Tokens are surfaced by their underlying asset name (USDC, ETH, SOL) with the canonical logo. Solana backing is disclosed in exactly one place — the asset detail page's "About" disclosure. See [the docs PR #137](the design spec) §3 for the full rule.

## Parameterization rule

Every value visible in mockups is illustrative. Implementation reads:
- **Registry-fed at boot**: chain config, contract addresses (Pool / PoolConfigurator / Oracle / etc.), token display info from `apps/aave/<chainId>-<slug>.json` + `chains/<chainId>-<slug>/{chain,tokens}.json`
- **RPC at request time**: reserve data (APYs / utilization / total supply / borrow) via `UiPoolDataProviderV3.getReservesData`; user data via `getUserReservesData(user)`; per-asset price via `AaveOracle.getAssetPrice`

See [the docs PR #137](the design spec) §6 for the full source map.

## License

Licensed under Apache-2.0 — see LICENSE and NOTICE.
