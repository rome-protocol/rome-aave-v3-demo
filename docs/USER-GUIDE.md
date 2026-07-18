# Rome Aave V3 — User Guide

How to use the Aave V3 demo at **`aave.testnet.romeprotocol.xyz`** (Hadrian,
chain `200010`). This is canonical Aave V3 running on Rome — lend, borrow,
repay, withdraw, liquidate, and flash-loan, settled Solana-fast.

For how the protocol works + how to deploy the contracts, see
[`Aave v3/docs/AAVE-V3-ON-ROME.md`](https://github.com/aave/aave-v3-origin/blob/main/docs/AAVE-V3-ON-ROME.md).

---

## Getting started

1. **Add the network.** When you connect, your wallet is prompted to add
   Rome Hadrian automatically. Manual fallback (the connect modal lists these):
   chain id `200010` / RPC `https://hadrian.testnet.romeprotocol.xyz/`.
2. **Connect a wallet.** Click **Connect wallet** → pick your EVM wallet
   (MetaMask, Rabby, any injected wallet). The header pill shows your address
   once connected.
3. **Get test funds.** Go to **Faucet** and claim — you get **10 native gas +
   100 each of HEAT / SALT / MILK / OIL** (mock collateral tokens), **once per
   address**. (wUSDC / wETH / wSOL come from the pool's seeded liquidity, not
   the faucet.)
4. **Theme.** The sun/moon toggle in the header switches light/dark; your
   choice persists.

---

## The pages

| Page | What you do there |
|---|---|
| **Markets** | See every reserve — supply/borrow APY, total supply/borrow, available liquidity. The home view. |
| **Dashboard** | Your positions: net worth, supplied/borrowed, **health factor**, and the E-mode switcher. Where you act on your own portfolio. |
| **Liquidate** | The at-risk feed — borrowers with HF < 1.05. Liquidate underwater positions for a collateral bonus. |
| **Flash Loan** | Borrow 1-3 assets with zero collateral, atomically. |
| **History** | Your past actions, with the real Solana settlement signatures. |
| **Faucet** | One-time claim of test gas + mock tokens. |

---

## Core actions (Supply / Borrow / Withdraw / Repay)

From **Markets** or **Dashboard**, click a reserve to open the action modal.

- **Supply** — deposit an asset to earn yield; it becomes collateral you can
  borrow against. (Approves the token first if needed, then supplies.)
- **Borrow** — borrow an asset against your supplied collateral. You can only
  borrow up to your borrowing power, and only what the pool has liquid.
- **Withdraw** — pull supplied assets back out. Blocked if it would drop your
  health factor below 1, or if the pool doesn't have enough liquid (some may
  be borrowed out).
- **Repay** — pay back borrowed debt (frees collateral, raises HF).

Each modal shows a **projected health factor** ("2.34 → 1.62") before you
sign, and **guards every action before submitting** — if something would
revert (insufficient balance, exhausted liquidity, HF below 1, supply cap),
you get a plain-English message instead of a cryptic wallet error.

### Health factor (HF)

HF = (collateral × liquidation thresholds) ÷ debt. **Below 1 = liquidatable.**
The header shows a red banner when your HF drops under 1. Keep it comfortably
above 1 by repaying debt or supplying more collateral.

### E-mode (Efficiency Mode)

On the **Dashboard**, E-mode lets you borrow more against *correlated*
collateral. Hadrian has two categories: **Stablecoin** (USDC-only, up to ~93%
LTV) and **Crypto** (ETH/SOL). The trade-off: while a category is on, you can
only borrow assets within it. Reversible when you have no out-of-category debt.

---

## Liquidations

Liquidation is how the protocol stays solvent: a **third party** repays an
underwater borrower's debt and receives their collateral at a discount (the
**liquidation bonus**, e.g. +10%).

- The **Liquidate** page lists borrowers with HF < 1.05 (a 12s-tick live feed).
- The **Liquidate** button is enabled only for positions you *can* liquidate:
  HF must be below 1, and it can't be your own position (your own row is tagged
  "You" and disabled — Aave forbids self-liquidation).
- When HF is below 0.95, the modal defaults to a **full-debt** repayment (Aave
  allows a 100% close there); partial liquidations of tiny positions are
  rejected by the protocol's anti-dust rule.

There is **no automatic liquidation bot** on this demo — it's a hands-on flow.
(In production, keeper bots race to liquidate within seconds.) To see one
execute end-to-end, an operator can stand up a liquidatable position — see the
contracts repo's ops guide, §7.

---

## Flash loans

A flash loan lets you **borrow with zero collateral and repay + a 0.09%
premium inside a single transaction** — if repayment fails, the whole thing
reverts as if it never happened. The page has two paths:

- **Multi-asset Composer (primary, top-left).** Pick 1-3 assets, set amounts,
  Execute. No setup needed — it uses a pre-deployed, pre-approved demo receiver
  contract. This is the one to try. The right panel explains how it works.
- **Build your own (collapsed "advanced" section).** The canonical single-asset
  `flashLoanSimple` — for developers who supply their own receiver contract
  address + calldata. Skip this unless you've deployed a receiver.

Why a pre-approved receiver: a flash loan only works if a *contract* receives
the funds, does the work, and repays — all atomically. On Rome, the demo
pre-approves that contract so a multi-asset loan stays under Solana's per-tx
account cap. (Details: contracts repo ops guide §6.)

---

## Prices

The real assets (USDC, ETH, SOL) are priced from **live Pyth** read off
Solana through Rome's Oracle Gateway V2 — so the prices you see move with the
market (e.g. ETH ~$2,070, not a fixed demo value). The invented demo tokens
(HEAT/SALT/MILK/OIL) use fixed mock prices. If a price feed ever goes stale,
the oracle falls back to a last-known value rather than breaking the market.

---

## Troubleshooting

| You see | Why / what to do |
|---|---|
| "Only N USDC is liquid right now…" on withdraw | The pool is mostly borrowed out. Withdraw less, or repay borrowers' debt frees liquidity. |
| "This would drop your health factor below 1" | Withdrawing/borrowing that much would make you liquidatable. Repay debt or do less. |
| Liquidate button greyed out | The position is healthy (HF ≥ 1), or it's your own position. |
| Wallet won't connect | Make sure your wallet is unlocked and on Hadrian (chain 200010). Refresh after installing an extension. |
| A price looks "stuck" briefly | The market data is cached ~30s server-side; on-chain prices update continuously. |

---
