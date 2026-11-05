// Turns a viem/wagmi revert into a human, actionable message.
//
// Aave V3.6 reverts with 4-byte custom-error selectors; Solidity 0.8 checked
// math reverts with Panic(uint256). viem surfaces these raw — users were
// seeing "0x6679996d" and "arithmetic operation resulted in underflow or
// overflow" with no idea what to do. This maps the common ones to plain
// English + a next step, and falls back to viem's shortMessage otherwise.

import { TxNotConfirmedError, TxReceiptTimeoutError, TxRevertedError } from "./wait-for-receipt";

// Selector → user-facing message. Generated from Aave v3.6 libraries/helpers/Errors.sol (92 errors);
// selector = keccak256("Name(argtypes)")[:4]. Hand-written text for the common ones, the contract's own
// comment for the rest.
const AAVE_ERROR_MESSAGES: Record<string, string> = {
  "0xcdd36a97": "The caller of the function is not a pool admin.", // CallerNotPoolAdmin
  "0x934f6050": "The caller of the function is not a pool or emergency admin.", // CallerNotPoolOrEmergencyAdmin
  "0x66e574d7": "The caller of the function is not a risk or pool admin.", // CallerNotRiskOrPoolAdmin
  "0x3a38503c": "The caller of the function is not an asset listing or pool admin.", // CallerNotAssetListingOrPoolAdmin
  "0x7498ebd0": "Pool addresses provider is not registered.", // AddressesProviderNotRegistered
  "0xf7717657": "Invalid id for the pool addresses provider.", // InvalidAddressesProviderId
  "0x6f7c43f1": "Address is not a contract.", // NotContract
  "0x44ff885f": "The caller of the function is not the pool configurator.", // CallerNotPoolConfigurator
  "0x93b9ef1f": "The caller of the function is not an AToken.", // CallerNotAToken
  "0x3b175b87": "The address of the pool addresses provider is invalid.", // InvalidAddressesProvider
  "0xfb37391e": "Invalid return value of the flashloan executor function.", // InvalidFlashloanExecutorReturn
  "0xaecc2085": "Reserve has already been added to reserve list.", // ReserveAlreadyAdded
  "0x923a9466": "Maximum amount of reserves in the pool reached.", // NoMoreReservesAllowed
  "0x92842113": "Zero eMode category is reserved for volatile heterogeneous assets.", // EModeCategoryReserved
  "0x7999528e": "The liquidity of the reserve needs to be 0.", // ReserveLiquidityNotZero
  "0x742d1c72": "Invalid flashloan premium.", // FlashloanPremiumInvalid
  "0x32d6d3ef": "Invalid risk parameters for the reserve.", // InvalidReserveParams
  "0xec1dd8d5": "Invalid risk parameters for the eMode category.", // InvalidEmodeCategoryParams
  "0x54b39ce2": "The caller of this function must be a pool.", // CallerMustBePool
  "0xccfad018": "Invalid amount to mint.", // InvalidMintAmount
  "0x2075cc10": "Invalid amount to burn.", // InvalidBurnAmount
  "0x2c5211c6": "Invalid amount. Enter an amount greater than zero.", // InvalidAmount
  "0x90cd6f24": "This reserve is inactive.", // ReserveInactive
  "0x6d305815": "This reserve is frozen — new supplies and borrows are paused.", // ReserveFrozen
  "0xd37f5f1c": "This reserve is paused. Try again later.", // ReservePaused
  "0x53587745": "Borrowing isn't enabled for this reserve.", // BorrowingNotEnabled
  "0x47bc4b2c": "Not enough available balance. The pool may be borrowed down — try a smaller amount or wait for liquidity.", // NotEnoughAvailableUserBalance
  "0x17c5a78e": "Invalid interest-rate mode.", // InvalidInterestRateModeSelected
  "0x6679996d": "This would push your health factor below 1. Repay some debt or add collateral before withdrawing.", // HealthFactorLowerThanLiquidationThreshold
  "0x911ceb81": "Your collateral can't cover this borrow. Supply more collateral or borrow less.", // CollateralCannotCoverNewBorrow
  "0xf0788fb2": "You have no debt of this type to repay.", // NoDebtOfSelectedType
  "0xcd3779c3": "To repay for someone else, enter an explicit amount.", // NoExplicitAmountToRepayOnBehalf
  "0x5fe10377": "Your supplied balance here is zero.", // UnderlyingBalanceZero
  "0x930bb771": "This position is healthy (health factor ≥ 1), so it can't be liquidated.", // HealthFactorNotBelowThreshold
  "0x979b5ce8": "This position can't be liquidated — its collateral isn't eligible.", // CollateralCannotBeLiquidated
  "0x3653732b": "You haven't borrowed this asset, so there's nothing to repay.", // SpecifiedCurrencyNotBorrowedByUser
  "0x039ebb30": "Inconsistent flashloan parameters.", // InconsistentFlashloanParams
  "0x77a6a896": "This reserve's borrow cap is reached. Try a smaller amount.", // BorrowCapExceeded
  "0xf58f733a": "This reserve's supply cap is reached. Try a smaller amount.", // SupplyCapExceeded
  "0xe24734c2": "This reserve's isolation-mode debt ceiling is reached.", // DebtCeilingExceeded
  "0xc26e71fb": "Claimable rights over underlying not zero (aToken supply or accruedToTreasury).", // UnderlyingClaimableRightsNotZero
  "0xdd04d593": "Variable debt supply is not zero.", // VariableDebtSupplyNotZero
  "0x5b263df7": "This withdrawal/borrow fails Aave's loan-to-value check. Repay debt or keep more collateral.", // LtvValidationFailed
  "0xc1d88872": "Inconsistent eMode category.", // InconsistentEModeCategory
  "0x91037009": "The price-oracle sentinel blocked this action (recent oracle outage). Try again shortly.", // PriceOracleSentinelCheckFailed
  "0x30d1eeb9": "Asset is not borrowable in isolation mode.", // AssetNotBorrowableInIsolation
  "0xd71b1fd1": "Reserve has already been initialized.", // ReserveAlreadyInitialized
  "0x0cafc072": "This collateral is in isolation mode or has zero LTV and can't back this borrow.", // UserInIsolationModeOrLtvZero
  "0x649641c2": "Invalid ltv parameter for the reserve.", // InvalidLtv
  "0x3e51d2c0": "Invalid liquidity threshold parameter for the reserve.", // InvalidLiquidationThreshold
  "0x54198c1c": "Invalid liquidity bonus parameter for the reserve.", // InvalidLiquidationBonus
  "0xd25598a0": "Invalid decimals parameter of the underlying asset of the reserve.", // InvalidDecimals
  "0x373792d2": "Invalid reserve factor parameter for the reserve.", // InvalidReserveFactor
  "0xa7e9b5b6": "Invalid borrow cap for the reserve.", // InvalidBorrowCap
  "0xc0d76d92": "Invalid supply cap for the reserve.", // InvalidSupplyCap
  "0x239eacb9": "Invalid liquidation protocol fee for the reserve.", // InvalidLiquidationProtocolFee
  "0x2a67d7f9": "Invalid debt ceiling for the reserve.", // InvalidDebtCeiling
  "0x85e98beb": "Invalid reserve index.", // InvalidReserveIndex
  "0xbb5bfbae": "ACL admin cannot be set to the zero address.", // AclAdminCannotBeZero
  "0x0d10f63b": "Array parameters that should be equal length are not.", // InconsistentParamsLength
  "0x3bf95ba7": "Zero address not valid.", // ZeroAddressNotValid
  "0xfb2a6752": "Invalid expiration.", // InvalidExpiration
  "0x8baa579f": "Invalid signature.", // InvalidSignature
  "0x29a270f5": "This operation isn't supported on this reserve.", // OperationNotSupported
  "0x495f4041": "Debt ceiling is not zero.", // DebtCeilingNotZero
  "0xb77e1e0f": "Asset is not listed.", // AssetNotListed
  "0x35a8aee7": "Invalid optimal usage ratio.", // InvalidOptimalUsageRatio
  "0xbf9cb8bb": "The underlying asset cannot be rescued.", // UnderlyingCannotBeRescued
  "0x19e2f692": "Reserve has already been added to reserve list.", // AddressesProviderAlreadyAdded
  "0x4c2b89eb": "The token implementation pool address and the pool address provided by the initializing pool do not match.", // PoolAddressesDoNotMatch
  "0xc27f9abe": "User is trying to borrow multiple assets including a siloed one.", // SiloedBorrowingViolation
  "0x4f9d999f": "The total debt of the reserve needs to be 0.", // ReserveDebtNotZero
  "0x580f2f14": "Flash loans are disabled for this reserve.", // FlashloanDisabled
  "0xee69f6c0": "The expect maximum borrow rate is invalid.", // InvalidMaxRate
  "0xdbc4273c": "Withdrawing to the aToken is not allowed.", // WithdrawToAToken
  "0x18d2badf": "Supplying to the aToken is not allowed.", // SupplyToAToken
  "0xd33c1528": "Variable interest rate slope 2 can not be lower than slope 1.", // Slope2MustBeGteSlope1
  "0x803ddb7b": "The caller of the function is not a risk, pool or emergency admin.", // CallerNotRiskOrPoolOrEmergencyAdmin
  "0x9e3e6060": "Liquidations are paused for a short grace period. Try again shortly.", // LiquidationGraceSentinelCheckFailed
  "0xd7c43e0f": "Grace period above a valid range.", // InvalidGracePeriod
  "0x990c1656": "Reserve is already in the passed freeze state.", // InvalidFreezeState
  "0x24812247": "Reserve is already in the passed ltvzero state.", // InvalidLtvzeroState
  "0x57db5bba": "This asset can't be borrowed in the current e-mode category.", // NotBorrowableInEMode
  "0xc45a7cdd": "The caller of the function is not the umbrella contract.", // CallerNotUmbrella
  "0x94468f03": "The reserve is not in deficit.", // ReserveNotInDeficit
  "0xb629b0e4": "This partial liquidation would leave a small leftover (under $1,000 of debt or collateral). Repay the full debt where Aave allows it, or a smaller amount that leaves at least $1,000. Max fills in an amount Aave accepts.", // MustNotLeaveDust
  "0x16f1ef81": "This action needs an account with no debt.", // UserCannotHaveDebt
  "0x44511af1": "You can't liquidate your own position.", // SelfLiquidation
  "0xabd80224": "Thrown when the caller has not been enabled as a position manager of the on-behalf-of user.", // CallerNotPositionManager
  "0xd2f93f12": "Thrown when trying to enter an eMode with an invalid collateral asset.", // InvalidCollateralInEmode
  "0x2c906631": "Thrown when trying to enter an eMode with an invalid debt asset.", // InvalidDebtInEmode
  "0xd039d03d": "Thrown when trying to configure an asset as eMode-ltvzero that is not an eMode collateral.", // MustBeEmodeCollateral
};

// Solidity Panic(uint256) codes — the runtime-arithmetic family.
const PANIC_SELECTOR = "0x4e487b71";
const PANIC_MESSAGES: Record<string, string> = {
  "0x11":
    "The amount exceeds what's available — usually withdrawing/borrowing more than the pool currently holds. Try a smaller amount or wait for liquidity.",
  "0x12": "Division by zero in the contract math.",
  "0x32": "An index was out of bounds in the contract.",
};
const ERROR_STRING_SELECTOR = "0x08c379a0";

// viem's shortMessage for a Panic(0x11) reads like this — catch it even when
// the raw selector isn't surfaced.
const UNDERFLOW_TEXT = /underflow|overflow/i;

function pluck(obj: unknown, path: string[]): unknown {
  let cur: any = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Find the first 0x-prefixed revert data blob hiding in a viem error tree. */
function findRevertData(err: unknown): string | undefined {
  const candidates = [
    pluck(err, ["data"]),
    pluck(err, ["cause", "data"]),
    pluck(err, ["cause", "cause", "data"]),
    pluck(err, ["cause", "cause", "cause", "data"]),
    pluck(err, ["cause", "reason"]),
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^0x[0-9a-fA-F]{8}/.test(c)) return c;
  }
  return undefined;
}

/**
 * Decode a wallet/RPC revert into a human message.
 * Order: explicit revert data → selector in the message text → panic/underflow
 * text → viem shortMessage → raw message.
 */
export function decodeAaveError(err: unknown): string {
  // The receipt-wait timeout helper rewraps viem's timeout into a friendly
  // TxReceiptTimeoutError carrying the hash — surface its message verbatim.
  if (err instanceof TxReceiptTimeoutError || err instanceof TxRevertedError || err instanceof TxNotConfirmedError) return err.message;
  const e = err as { shortMessage?: string; message?: string; details?: string } | undefined;
  const text = `${e?.shortMessage ?? ""} ${e?.message ?? ""} ${e?.details ?? ""}`;

  // 1. Structured revert data, if viem preserved it.
  const data = findRevertData(err);
  const selectorFromData = data ? data.slice(0, 10).toLowerCase() : undefined;

  // 2. Otherwise scrape a 4-byte selector out of the message text.
  const selectorFromText = text.match(/0x[0-9a-fA-F]{8}\b/)?.[0]?.toLowerCase();

  const selector = selectorFromData ?? selectorFromText;

  if (selector) {
    if (AAVE_ERROR_MESSAGES[selector]) return AAVE_ERROR_MESSAGES[selector];
    if (selector === PANIC_SELECTOR && data) {
      // panic code is the last 32-byte word
      const code = "0x" + parseInt(data.slice(-2), 16).toString(16);
      if (PANIC_MESSAGES[code]) return PANIC_MESSAGES[code];
    }
    if (selector === ERROR_STRING_SELECTOR) {
      // fall through to the text — viem already decoded the string into the message
    }
  }

  // 3. Panic surfaced only as text ("...underflow or overflow").
  if (UNDERFLOW_TEXT.test(text)) return PANIC_MESSAGES["0x11"];

  // 4. User-rejected — keep it short + recognizable.
  if (/user rejected|user denied|rejected the request/i.test(text)) {
    return "You rejected the transaction in your wallet.";
  }

  // 5. Fall back to whatever viem gave us, trimmed.
  const fallback = e?.shortMessage ?? e?.message ?? String(err ?? "Unknown error");
  return fallback.length > 200 ? fallback.slice(0, 200) + "…" : fallback;
}
