// Minimal ABIs for the contracts the demo reads. Keeps the bundle small.
// Full ABIs (when needed for writes) get vendored from Aave v3 artifacts.

// AggregatedReserveData struct mirrors the v3.6 IUiPoolDataProviderV3
// interface exactly. Earlier v3 versions had e-mode-related fields inline;
// v3.6 splits e-mode out into a separate getEModes() function and adds a
// `deficit` field at the end. Field order is load-bearing for ABI decoding.
const AggregatedReserveData = {
  type: "tuple",
  components: [
    { name: "underlyingAsset", type: "address" },
    { name: "name", type: "string" },
    { name: "symbol", type: "string" },
    { name: "decimals", type: "uint256" },
    { name: "baseLTVasCollateral", type: "uint256" },
    { name: "reserveLiquidationThreshold", type: "uint256" },
    { name: "reserveLiquidationBonus", type: "uint256" },
    { name: "reserveFactor", type: "uint256" },
    { name: "usageAsCollateralEnabled", type: "bool" },
    { name: "borrowingEnabled", type: "bool" },
    { name: "isActive", type: "bool" },
    { name: "isFrozen", type: "bool" },
    { name: "liquidityIndex", type: "uint128" },
    { name: "variableBorrowIndex", type: "uint128" },
    { name: "liquidityRate", type: "uint128" },
    { name: "variableBorrowRate", type: "uint128" },
    { name: "lastUpdateTimestamp", type: "uint40" },
    { name: "aTokenAddress", type: "address" },
    { name: "variableDebtTokenAddress", type: "address" },
    { name: "interestRateStrategyAddress", type: "address" },
    { name: "availableLiquidity", type: "uint256" },
    { name: "totalScaledVariableDebt", type: "uint256" },
    { name: "priceInMarketReferenceCurrency", type: "uint256" },
    { name: "priceOracle", type: "address" },
    { name: "variableRateSlope1", type: "uint256" },
    { name: "variableRateSlope2", type: "uint256" },
    { name: "baseVariableBorrowRate", type: "uint256" },
    { name: "optimalUsageRatio", type: "uint256" },
    { name: "isPaused", type: "bool" },
    { name: "isSiloedBorrowing", type: "bool" },
    { name: "accruedToTreasury", type: "uint128" },
    { name: "isolationModeTotalDebt", type: "uint128" },
    { name: "flashLoanEnabled", type: "bool" },
    { name: "debtCeiling", type: "uint256" },
    { name: "debtCeilingDecimals", type: "uint256" },
    { name: "borrowCap", type: "uint256" },
    { name: "supplyCap", type: "uint256" },
    { name: "borrowableInIsolation", type: "bool" },
    { name: "virtualUnderlyingBalance", type: "uint128" },
    { name: "deficit", type: "uint128" },
  ],
} as const;

export const UiPoolDataProviderV3Abi = [
  {
    type: "function",
    name: "getReservesList",
    stateMutability: "view",
    inputs: [{ name: "provider", type: "address" }],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "getReservesData",
    stateMutability: "view",
    inputs: [{ name: "provider", type: "address" }],
    outputs: [
      { name: "reservesData", type: "tuple[]", components: AggregatedReserveData.components },
      {
        name: "baseCurrencyInfo",
        type: "tuple",
        components: [
          { name: "marketReferenceCurrencyUnit", type: "uint256" },
          { name: "marketReferenceCurrencyPriceInUsd", type: "int256" },
          { name: "networkBaseTokenPriceInUsd", type: "int256" },
          { name: "networkBaseTokenPriceDecimals", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getUserReservesData",
    stateMutability: "view",
    inputs: [
      { name: "provider", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [
      {
        name: "userReserves",
        type: "tuple[]",
        components: [
          { name: "underlyingAsset", type: "address" },
          { name: "scaledATokenBalance", type: "uint256" },
          { name: "usageAsCollateralEnabledOnUser", type: "bool" },
          { name: "scaledVariableDebt", type: "uint256" },
        ],
      },
      { name: "userEmodeCategoryId", type: "uint8" },
    ],
  },
] as const;

export const PoolAbi = [
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
  // Pool.supply(asset, amount, onBehalfOf, referralCode). Caller must
  // approve(pool, amount) on `asset` first; the modal's approve step
  // sets that up.
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  // Pool.withdraw(asset, amount, to) — pass type(uint256).max to redeem all aTokens.
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "withdrawn", type: "uint256" }],
  },
  // Pool.borrow(asset, amount, interestRateMode, referralCode, onBehalfOf).
  // Variable mode only on Rome (Aave V3 deprecated stable rates).
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "referralCode", type: "uint16" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [],
  },
  // Pool.repay(asset, amount, interestRateMode, onBehalfOf) — pass
  // type(uint256).max to clear the entire variable debt.
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [{ name: "repaid", type: "uint256" }],
  },
  // Pool.liquidationCall(collateralAsset, debtAsset, user, debtToCover, receiveAToken).
  // Caller must approve(pool, debtToCover) on `debtAsset` first; the
  // bonus collateral is sent to the caller's address when
  // receiveAToken=false. Passing debtToCover = type(uint256).max routes
  // to closeFactor * debt inside the Pool.
  {
    type: "function",
    name: "liquidationCall",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralAsset", type: "address" },
      { name: "debtAsset", type: "address" },
      { name: "user", type: "address" },
      { name: "debtToCover", type: "uint256" },
      { name: "receiveAToken", type: "bool" },
    ],
    outputs: [],
  },
  // Pool.flashLoanSimple(receiverAddress, asset, amount, params, referralCode).
  // The receiver must implement IFlashLoanSimpleReceiver.executeOperation
  // and approve(pool, amount + premium) inside that callback. The 0.09%
  // premium is enforced by the Pool — we surface it in the composer UI.
  {
    type: "function",
    name: "flashLoanSimple",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiverAddress", type: "address" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "params", type: "bytes" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  // Pool.flashLoan(receiverAddress, assets[], amounts[], modes[], onBehalfOf,
  // params, referralCode). Multi-asset variant. modes=[0,...] = flash-only
  // (must repay in same tx). On Rome the receiver MUST be pre-approved (see
  // Aave v3's PreApprovedFlashReceiverBase) — in-callback approve adds
  // the SPL approve_checked CPI accounts to the per-sig set and overflows
  // the per-tx account_locks cap.
  {
    type: "function",
    name: "flashLoan",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiverAddress", type: "address" },
      { name: "assets", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "interestRateModes", type: "uint256[]" },
      { name: "onBehalfOf", type: "address" },
      { name: "params", type: "bytes" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  // E-mode reads + write. Categories are configured by an admin via
  // PoolConfigurator.setEModeCategory; users opt in by calling
  // Pool.setUserEMode(categoryId). id=0 means "no e-mode."
  {
    type: "function",
    name: "setUserEMode",
    stateMutability: "nonpayable",
    inputs: [{ name: "categoryId", type: "uint8" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getUserEMode",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getEModeCategoryLabel",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint8" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "getEModeCategoryCollateralConfig",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint8" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "ltv", type: "uint16" },
        { name: "liquidationThreshold", type: "uint16" },
        { name: "liquidationBonus", type: "uint16" },
      ],
    }],
  },
  // Bitmaps of asset ids for collateral + borrowable membership inside an
  // e-mode category. Used to render the eligible-asset chips in the
  // switch modal.
  {
    type: "function",
    name: "getEModeCategoryCollateralBitmap",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint8" }],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "getEModeCategoryBorrowableBitmap",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint8" }],
    outputs: [{ type: "uint128" }],
  },
  // Pool.getReserveData returns DataTypes.ReserveDataLegacy. We only
  // touch `.id` (position in the active-reserves list, used to map the
  // e-mode bitmap back to assets) but viem needs the full shape to
  // decode the tuple.
  {
    type: "function",
    name: "getReserveData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "configuration", type: "uint256" },
        { name: "liquidityIndex", type: "uint128" },
        { name: "currentLiquidityRate", type: "uint128" },
        { name: "variableBorrowIndex", type: "uint128" },
        { name: "currentVariableBorrowRate", type: "uint128" },
        { name: "currentStableBorrowRate", type: "uint128" },
        { name: "lastUpdateTimestamp", type: "uint40" },
        { name: "id", type: "uint16" },
        { name: "aTokenAddress", type: "address" },
        { name: "stableDebtTokenAddress", type: "address" },
        { name: "variableDebtTokenAddress", type: "address" },
        { name: "interestRateStrategyAddress", type: "address" },
        { name: "accruedToTreasury", type: "uint128" },
        { name: "unbacked", type: "uint128" },
        { name: "isolationModeTotalDebt", type: "uint128" },
      ],
    }],
  },
  // Aave V3.6 IPool.Borrow event. `onBehalfOf` (indexed topic 2) is the
  // address that carries the debt — that's our at-risk feed's borrower set.
  // `user` (msg.sender, non-indexed) can be a delegate router and would
  // give wrong results.
  {
    type: "event",
    name: "Borrow",
    inputs: [
      { name: "reserve",          type: "address", indexed: true  },
      { name: "user",             type: "address", indexed: false },
      { name: "onBehalfOf",       type: "address", indexed: true  },
      { name: "amount",           type: "uint256", indexed: false },
      { name: "interestRateMode", type: "uint8",   indexed: false },
      { name: "borrowRate",       type: "uint256", indexed: false },
      { name: "referralCode",     type: "uint16",  indexed: true  },
    ],
  },
] as const;

export const Erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals",  stateMutability: "view", inputs: [], outputs: [{ type: "uint8"  }] },
  { type: "function", name: "symbol",    stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name",      stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve",   stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer",  stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
