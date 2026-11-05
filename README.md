# Rome Aave V3 — Demo UI

Demo web app for canonical [Aave V3.6 on Rome](https://github.com/rome-protocol/rome-aave-v3). Chain config and contract addresses come from two JSON files in this repo, `lib/hadrian-chain.json` and `lib/aave-hadrian.json`. Reserve and user data are read from the chain at request time.

**Live:** `aave.testnet.romeprotocol.xyz`. Users see the network as **Solana · via Rome** with a **Testnet** tag. Under the hood it is Hadrian, chain 200010.

## Docs

- **[User guide](docs/USER-GUIDE.md)**: how to use the app (connect, fund, supply, borrow, withdraw, repay, liquidate, flash loan) and how to run your own copy.
- **[Aave V3 on Rome](https://github.com/rome-protocol/rome-aave-v3/blob/main/docs/AAVE-V3-ON-ROME.md)** (contracts repo): how the protocol works on Rome, contract deploy, oracle, flash-loan pattern, ops tasks.

## What the app does

- **Pages:** Markets (home), Dashboard, Liquidate, Flash Loan, History, and one detail page per asset.
- **Home page:** a market overview (size, available, borrowed) split into EVM and Solana wallets. Each address that has supplied or borrowed is classed once as an EVM wallet or a Solana wallet (by how its first transaction was signed). The totals are summed per side and refreshed about every 30 seconds on the server (`/api/market-overview`).
- **Actions:** supply, withdraw, borrow, repay, collateral on/off, `liquidationCall`, and `flashLoanSimple`. A multi-asset `flashLoan` form exists but stays hidden until a demo receiver is registered in `lib/aave-hadrian.json` (`flashLoanReceivers.demoMulti`). None is registered today.
- **Wallets:** EVM wallets (injected; WalletConnect appears only when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set when the server starts, which it is not on live today) and Solana wallets (Phantom and Solflare both work). One identity is active at a time, see below.
- **Liquidation:** only below health factor 1.00, on the Aave v3.6 close rules (`lib/liquidation-amount.ts`). The list shows positions under 1.05 so liquidators can watch them.
- **Flash loan:** the premium is read from the pool (`FLASHLOAN_PREMIUM_TOTAL`, 0 today) and shown on the page.
- **Prices:** live. See the next section.
- **Themes:** light and dark. Dark is the default. The choice is Light, System or Dark and is remembered in the browser.
- **Funding:** the [Rome Bridge](https://bridge-api.devnet.romeprotocol.xyz). There is no faucet.

## Prices

The four reserves (USDC, ETH, SOL, BTC) are priced from Rome's price book. The pool reads one oracle contract, `RomePriceOracle`, which reads each asset's price book entry directly. If the book stalls, it answers with the price that was fixed when the oracle was deployed. Prices move with the market and no price is hard-coded in this repo.

Read on 2026-11-05: USDC 0.9997, ETH 2,258, SOL 90.09 from `RomePriceOracle.getAssetPrice`, no fallback oracle set. BTC is priced the same way.

## Local dev

```bash
npm install --legacy-peer-deps
npm run dev
# open http://localhost:3000  (or 3001 if 3000 is in use)
```

## Live deployment reference

Hadrian (chain 200010, testnet):

| Contract | Address |
|---|---|
| `Pool` | `0x81e7e7e4cBC2b5a55C2dE1d3dFCf87C0cF867520` |
| `PoolAddressesProvider` | `0x8f40D56ffAA473120177c65FC5EE431b22353CD4` |
| `PoolConfigurator` | `0x1186549d0E2308579337ff064B2C5865F416d01F` |
| `RomePriceOracle` (the pool's oracle) | `0x3ca9343F21661c1F854860532deeC2734bcD869B` |
| `AaveOracle` (kept, no longer read by the pool) | `0x4736549aB02e6c6b7083b7625464368E203287E4` |
| `AaveProtocolDataProvider` | `0x79b627B56252468FD53d6F2d7C572Ea969dCC10D` |
| `UiPoolDataProviderV3` | `0xd5C1348e15543A04e6A10303429F75d1ddeFD152` |

Reserves: USDC (6 decimals), ETH (8), SOL (9), BTC (9). Each is backed 1:1 by the asset on Solana. Liquidation bonus is 5%. The flash-loan premium is read from the pool (0 today). No e-mode categories are set.

The app reads these addresses from `lib/aave-hadrian.json`; the code does not hardcode them. After a redeploy, update that file.

## Architecture

```
rome-aave-v3-demo/
├── app/                  Next.js App Router: pages, /api routes, styles
│   ├── page.tsx           Markets (home)
│   ├── dashboard/ liquidate/ flashloan/ history/ markets/[symbol]/
│   ├── api/               aave-config, user-data, at-risk, history, market-overview, status, health, token
│   ├── styles.css         this app's own tokens and table rules
│   ├── globals.css        fonts and base rules (the Rome DEX's classes)
│   ├── theme.css          the Rome app look, Aurora (dark) and Daylight (light)
│   └── aave-look.css      joins this app's tokens to the look
├── components/            page contents, action modals, wallet chooser, theme choice
├── hooks/                 data hooks and action hooks (one hook for supply/withdraw/borrow/repay)
├── lib/                   aave-reader, registry-config, history/at-risk indexers, market overview
│   ├── lane/              which identity is active, the Solana wallet's synthetic address
│   └── solana/            v1 transaction building, legs, relay
├── utils/                 wallet detection, chain switch guard, session timeout, error handler
├── constants/             the single chain (Hadrian) definition
├── store/                 wallet, lane and theme stores
└── public/                theme-init.js (paints the saved theme before the first frame), fonts (Untitled Sans and Untitled Serif, licensed to Rome Protocol, see NOTICE; IBM Plex Mono, SIL OFL), Rome logos
```

## Identity and lanes

The app acts under ONE identity at a time. `hooks/useActiveLane.ts` is the single
place that decides it, from `lib/lane/activeLane.ts`: the only connected wallet
is active; with both wallets holding a session the visitor's connect click
decides and the other wallet's session is dropped (applied in
`UniWalletProvider`, never in click handlers, because both wallets reconnect
silently on load). Every read and write binds to `useActiveAddress()`:

- **EVM wallet** → its own address; sends go through wagmi.
- **Solana wallet** → the synthetic EVM address `keccak256(pubkey)[12..32]`
  (`lib/lane/identity.ts`, the address rome-evm derives on chain from the Solana
  signer). Reads and sends both work. Sends are SIMD-0385 v1 transactions
  composed by the Rome proxy and signed by the wallet through Wallet Standard
  (`lib/lane/walletStandard.ts`: `solana:signMessage` over the readable
  authorisation envelope "Rome authorization 0x<hash>", `solana:signTransaction`
  on the raw v1 wire). `hooks/useSendAaveCall.ts` is the one send function for
  both lanes.

Money for a Solana wallet moves at action time (`hooks/useSyntheticLegs.ts`).
Before a supply, repay or liquidation, the missing tokens go from the wallet to its Rome
account in one wallet-signed v1 transaction. Native SOL is wrapped for that
step. After a withdraw, borrow or liquidation, the result is swept back to the
wallet, and a wrapped SOL account is closed so the user ends with plain SOL.

An action the atomic composer refuses (borrow, liquidation, flash loans) runs
several Solana transactions and goes through the relay (`lib/solana/relay.ts`):
one wallet-signed gas deposit (USDC) for the synthetic when it is short, then
the authorisation already given lets the proxy's payer drive the legs. Atomic
actions go straight to Solana with the wallet as payer. A wallet-signed plan
(`lib/solana/plan.ts`) is built and tested, not used by the app today.

Phantom and Solflare both work on Hadrian; the code never branches on a
wallet's brand.

## Vocabulary rule

The display layer never says `wUSDC` / `wETH` / `cached` / `wrapper` / `SPL`. Reserves are labelled by their underlying asset symbol (USDC, ETH, SOL, BTC) from `lib/aave-hadrian.json`. Logos and Solana-wallet names come from `/api/token` (Jupiter's verified list, then on-chain metadata); a token with neither shows a letter mark. Solana backing is disclosed in exactly one place — the asset detail page's "About" disclosure.

## Parameterization rule

No chain value or Aave address is written into components or hooks (the only fixed addresses are the Rome helper precompile and Multicall3). The code reads:
- **The vendored files**: chain config from `lib/hadrian-chain.json`; contract addresses (Pool / PoolConfigurator / Oracle / etc.), reserves and the token list from `lib/aave-hadrian.json` (loaded by `lib/registry-config.ts`)
- **Logos and names**: logos come from `/api/token`, by mint: Jupiter's verified list, then the token's on-chain metadata; a token with neither shows a letter mark. With a Solana wallet connected, names come from the same source. Otherwise the app shows each reserve's symbol from `lib/aave-hadrian.json` and the token's on-chain name. This copy has no registry source.
- **RPC at request time**: reserve data (APYs / utilization / total supply / borrow) via `UiPoolDataProviderV3.getReservesData`; user data via `getUserReservesData(user)`; per-asset price via `RomePriceOracle.getAssetPrice` (the pool's live oracle, read from the addresses provider)

## License

Licensed under Rome's license (personal, non-commercial use). See LICENSE and NOTICE. The Untitled Sans and Untitled Serif fonts in `public/fonts/` are licensed to Rome Protocol and are not covered by that license.

## Building on Rome with an agent

See [`AGENTS.md`](./AGENTS.md): the Rome-specific rules a coding agent needs, and what this repo's code does.
