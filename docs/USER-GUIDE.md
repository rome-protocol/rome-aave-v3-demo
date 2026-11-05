# Rome Aave V3: User Guide

How to use the Aave V3 demo at **`aave.testnet.romeprotocol.xyz`**. It is canonical Aave V3.6 running on Rome. You can supply, borrow, repay, withdraw, liquidate and flash-loan. The app shows the network as **Solana · via Rome**, with a **Testnet** tag. Nothing here uses real money.

For how the protocol works and how to deploy the contracts, see
[`rome-aave-v3/docs/AAVE-V3-ON-ROME.md`](https://github.com/rome-protocol/rome-aave-v3/blob/main/docs/AAVE-V3-ON-ROME.md).

---

## Getting started

1. **Connect a wallet.** Click **Connect wallet**. The list has two groups.
   - **EVM wallets:** MetaMask, Rabby, or any other injected wallet. The wallet asks to add the network the first time you connect.
   - **Solana wallets:** Phantom and Solflare both work. Switch the wallet to its Solana test network first, or balances will not show. Phantom: Settings, Developer Settings, Testnet Mode, Solana Devnet. Solflare: Settings, Network, Devnet. The connect window repeats these steps.

   The app uses one wallet at a time. If you connect a wallet of the other kind, the first one is disconnected.
2. **Get test funds.** There is no faucet. Move assets in with the [Rome Bridge](https://bridge-api.devnet.romeprotocol.xyz). You can supply USDC, ETH and SOL. USDC also pays the network fee.
3. **Theme.** The sun, monitor and moon choice in the header sets Light, System or Dark. The default is dark. The app remembers your choice.

### Solana wallets

With a Solana wallet you keep your tokens in your own wallet. When you supply, repay or liquidate, the app moves what is needed into your Rome account first, in one wallet-signed transaction. When you withdraw, borrow or liquidate, the result goes back to your wallet. SOL is wrapped for the move and unwrapped on the way back, so you hold plain SOL. Your wallet asks you to sign each step.

Some actions need several Solana transactions, such as a borrow or a liquidation. The app handles the extra steps. It may ask for one small USDC deposit to cover the network fee if your Rome account is short.

---

## The pages

| Page | What you do there |
|---|---|
| **Markets** | The home page. The market overview (size, available, borrowed) is split into EVM and Solana wallets. Below it, every asset with supplied, borrowed, supply and borrow APY, utilization and price. Click an asset for its own page. |
| **Dashboard** | Your positions: net worth, net APY, **health factor**, what you supplied and borrowed. Where you act on your own portfolio. |
| **Liquidate** | Borrowers close to liquidation. Liquidate the ones below health factor 1.00. |
| **Flash Loan** | Borrow with no collateral and repay in the same transaction. |
| **History** | Your past actions. Each row opens the Solana transactions behind it. |

---

## Core actions

Open an asset from **Markets**, or use the buttons on your **Dashboard**.

- **Supply:** deposit an asset to earn yield. It counts as collateral. On the Dashboard you can switch collateral off for an asset.
- **Borrow:** borrow against your collateral, up to your borrowing power and what the pool has available.
- **Withdraw:** take supplied assets back. Blocked if it would put your health factor below 1, or if the pool has too little available.
- **Repay:** pay back debt. This frees collateral and raises your health factor.

Each window shows the **health factor before and after** (for example "2.34 to 1.62"). If an action would fail, such as too little balance, too little liquidity, a health factor below 1 or a supply cap, the app says so in plain words before you sign.

### Health factor

Health factor = collateral (weighted by liquidation thresholds) divided by debt. **Below 1 means the position can be liquidated.** A red banner appears under the header when yours drops below 1. Repay debt or supply more collateral to raise it.

### E-mode

E-mode lets you borrow more against correlated assets. This market has no e-mode categories today, so the Dashboard card says "No e-mode categories."

---

## Prices

Prices are live. USDC, ETH and SOL are priced from Rome's price book, and the numbers on screen move with the market. Each asset goes through one small contract that reads its book feed. If the book stops updating, that contract answers with the price that was fixed when the switch was made, so the market keeps working.

---

## Liquidations

A liquidator repays part of an underwater borrower's debt and receives that borrower's collateral at a discount. The discount is the **liquidation bonus**, 5% on all three assets.

- The **Liquidate** page lists borrowers whose health factor is under 1.05. The list refreshes about every 15 seconds. The default filter is "< 1.05". You can also pick "< 1.00", "< 1.10" or "All".
- You can liquidate a position only **below health factor 1.00**. Rows between 1.00 and 1.05 are there to watch. Their Liquidate button is off, with "Close to liquidation" under it.
- You cannot liquidate your own position. Your row is tagged "You".
- The window pre-fills the amount by the Aave v3.6 close rules:
  - You may repay the **whole debt in that asset** when the borrower's debt or collateral in that asset is under $2,000, or when health factor is 0.95 or lower.
  - Otherwise you may repay at most **half of the borrower's total debt**.
  - A partial repay must leave at least $1,000 of debt and $1,000 of collateral. The pre-filled amount stays inside that limit.
- "You receive" shows the collateral for your repayment plus the bonus. It never shows more than the borrower holds.

There is no liquidation bot on this demo. Liquidation is hands-on.

---

## Flash loans

A flash loan lets you borrow with no collateral and repay inside the same transaction. If repayment fails, the whole transaction reverts. The premium comes from the pool and the page shows it. It is **0 today**, so the page says "no fee".

The page takes one asset at a time. It calls the pool's `flashLoanSimple` with a receiver contract you deployed and your own calldata. The section is open on the page. You need your own receiver to use it.

Multi-asset flash loans are not offered yet.

---

## Troubleshooting

| You see | Why / what to do |
|---|---|
| "Only N USDC is liquid right now" on withdraw | Most of the pool is borrowed out. Take less, or wait for repayments. |
| "Pool has only N available" on borrow | The pool holds less than you asked for. Borrow less, or supply more so the pool has more to lend. |
| "This would drop your health factor below 1" | The action would make you liquidatable. Repay debt or do less. |
| Liquidate button is off | The health factor is 1.00 or higher, or it is your own position. |
| A Solana wallet shows no balance | Switch the wallet to its Solana test network (see Getting started). |
| A wallet will not connect | Unlock the wallet and refresh after installing an extension. |
| "Wrong network. Switch to Solana · via Rome." | Approve the wallet's prompt to add or switch the network. |

---

## Running your own copy

The demo is a standalone Next.js app (`npm install`, `npm run build`, `npm start`; see the README for local development).

App config (chain id, RPC, contract addresses) comes from the vendored registry files in `lib/` (`hadrian-chain.json`, `aave-hadrian.json`). Do not hardcode addresses elsewhere. Two environment variables point the same-origin proxies at other upstreams: `ROME_RPC_UPSTREAM` (the Rome RPC) and `SOLANA_RPC_UPSTREAM` (the Solana RPC; the default is the public Solana devnet RPC).
