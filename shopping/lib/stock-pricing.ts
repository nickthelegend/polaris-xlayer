/**
 * What a basket costs in shares.
 *
 * A shopper thinks in dollars and holds stock. The engine thinks in shares and
 * a loan-to-value ceiling. Something has to do that conversion, and doing it
 * in the checkout is the whole reason this is a payments product rather than a
 * lending one.
 *
 * All of it is integer maths. A price times a balance is exactly where binary
 * floating point starts losing cents, and a cent lost here is a loan that
 * opens for the wrong amount.
 */

/** Stablecoin units — the engine settles in 6 decimals. */
export const STABLE_DECIMALS = 6n;
/** The oracle publishes at 1e8, the scale Chainlink feeds use. */
export const PRICE_DECIMALS = 8n;
/** The collateral token is a standard 18-decimal ERC20. */
export const SHARE_DECIMALS = 18n;

/** Dollars (as a decimal string) to stablecoin units, without touching a float. */
export function usdToUnits(usd: string): bigint {
  const cleaned = usd.trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error(`not an amount: ${usd}`);
  const [whole, frac = ""] = cleaned.split(".");
  const padded = (frac + "000000").slice(0, Number(STABLE_DECIMALS));
  return BigInt(whole) * 10n ** STABLE_DECIMALS + BigInt(padded || "0");
}

export type Pricing = {
  /** Price per share, 1e8. */
  usdPerShare: bigint;
  /** Effective loan-to-value in basis points, after any after-hours haircut. */
  ltvBps: bigint;
  /** Origination fee in basis points. */
  originationFeeBps: bigint;
  /** Interest, annualised, in basis points. */
  interestAprBps: bigint;
  /** Tenor in seconds. */
  tenor: bigint;
};

const BPS = 10000n;
const YEAR = 365n * 24n * 60n * 60n;

/**
 * The fee the engine charges to open a loan: origination plus simple interest
 * for the tenor, both on the principal. Mirrors `PolarisEngine.feeFor`.
 */
export function feeFor(principal: bigint, p: Pricing): bigint {
  const origination = (principal * p.originationFeeBps) / BPS;
  const interest = (principal * p.interestAprBps * p.tenor) / (BPS * YEAR);
  return origination + interest;
}

/**
 * What locking `shares` frees up — the engine's own arithmetic, not an
 * approximation of it.
 *
 * The first version of this modelled the fee as a slice of the ceiling. It is
 * not: the engine charges origination *and interest over the tenor* on the
 * principal, then solves `borrow + fee(borrow) <= allowed` for the principal.
 * Getting that wrong asked for one unit more than the ceiling and every
 * checkout reverted with ExceedsMaxLtv — a basket that priced perfectly on
 * screen and could never be paid.
 *
 * Mirrors `PolarisEngine.quote`, including the walk-back loop that integer
 * division makes necessary.
 */
export function quoteForShares(shares: bigint, p: Pricing) {
  const collateralValue =
    (shares * p.usdPerShare * 10n ** STABLE_DECIMALS) / 10n ** SHARE_DECIMALS / 10n ** PRICE_DECIMALS;
  const allowed = (collateralValue * p.ltvBps) / BPS;

  const k = p.originationFeeBps + (p.interestAprBps * p.tenor) / YEAR;
  let maxBorrow = (allowed * BPS) / (BPS + k);
  let fee = feeFor(maxBorrow, p);
  // Integer division can leave the pair a hair over the ceiling; the contract
  // walks it back, so this has to as well or the two disagree by one unit.
  while (maxBorrow > 0n && maxBorrow + fee > allowed) {
    maxBorrow -= 1n;
    fee = feeFor(maxBorrow, p);
  }

  return { collateralValue, ceiling: allowed, fee, merchantReceives: maxBorrow };
}

/**
 * The shares a basket needs.
 *
 * `merchantReceives` rises monotonically with shares, so the smallest
 * sufficient count can be found exactly. Solving it in closed form is possible
 * but brittle — it has to track every flooring step in the contract — so this
 * searches against the same function the checkout quotes from.
 */
export function sharesForTotal(totalUnits: bigint, p: Pricing): bigint {
  if (p.usdPerShare === 0n || p.ltvBps === 0n || totalUnits <= 0n) return 0n;

  let high = 10n ** SHARE_DECIMALS;
  for (let i = 0; i < 64 && quoteForShares(high, p).merchantReceives < totalUnits; i++) high *= 2n;
  if (quoteForShares(high, p).merchantReceives < totalUnits) return high;

  let low = 0n;
  while (low < high) {
    const mid = (low + high) / 2n;
    if (quoteForShares(mid, p).merchantReceives >= totalUnits) high = mid;
    else low = mid + 1n;
  }
  return low;
}

/** Stablecoin units back to a display string. */
export function formatUsd(units: bigint): string {
  const negative = units < 0n;
  const v = negative ? -units : units;
  const whole = v / 10n ** STABLE_DECIMALS;
  const frac = (v % 10n ** STABLE_DECIMALS).toString().padStart(Number(STABLE_DECIMALS), "0").slice(0, 2);
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}.${frac}`;
}

/** Share units to a display string. */
export function formatShares(units: bigint, dp = 4): string {
  const whole = units / 10n ** SHARE_DECIMALS;
  const frac = (units % 10n ** SHARE_DECIMALS).toString().padStart(Number(SHARE_DECIMALS), "0").slice(0, dp);
  return `${whole}.${frac}`;
}

/**
 * The price at which a position becomes liquidatable.
 *
 * A borrower's real question is not "what is my health factor" — it is "how far
 * can this fall before somebody sells my shares". The engine liquidates when
 * the collateral's value drops under `owed × 10000 / liquidationThresholdBps`,
 * so the price that happens at is that value spread back over the shares held.
 *
 * Returned at the oracle's 1e8 scale, like every other price here.
 */
export function liquidationPrice(
  shares: bigint,
  owedUnits: bigint,
  liquidationThresholdBps: bigint,
): bigint | null {
  if (shares === 0n || liquidationThresholdBps === 0n) return null;
  // collateralValue = shares × price / 1e20, and liquidation bites when
  // collateralValue × threshold / 10000 <= owed.
  const requiredValue = (owedUnits * 10000n) / liquidationThresholdBps;
  return (requiredValue * 10n ** (SHARE_DECIMALS + PRICE_DECIMALS - STABLE_DECIMALS)) / shares;
}

/** How far the price can fall before that happens, in basis points. */
export function headroomBps(currentPrice: bigint, liqPrice: bigint): bigint {
  if (currentPrice === 0n || liqPrice >= currentPrice) return 0n;
  return ((currentPrice - liqPrice) * 10000n) / currentPrice;
}
