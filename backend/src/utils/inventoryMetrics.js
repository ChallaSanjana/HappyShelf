/**
 * Single source of truth for every derived inventory fact on the backend:
 * stock status, expiry status, and the aggregate dashboard stats.
 *
 * These rules previously existed in three places — getStats() in
 * inventoryController, getStockStatus() in inventoryQuery, and a third
 * private copy driving the low-stock alert emails — each with a comment
 * claiming to "mirror" the others while quietly disagreeing with them. The
 * disagreements were real: getStats ignored min_stock_level entirely, so an
 * item that had dropped below its configured minimum triggered an alert
 * email while still being counted as healthy on the dashboard.
 *
 * frontend/src/utils/stock.ts and expiry.ts are the mirror of this file on
 * the client, and both test suites run the same fixtures through both
 * implementations to assert they still agree (see __tests__/metrics.test.js
 * and src/utils/__tests__/metrics.test.ts).
 */

/** Days of remaining supply below which an item counts as low. */
export const LOW_STOCK_DAYS = 3;

/** Items expiring within this many days count as "expiring soon". */
export const EXPIRY_WINDOW_DAYS = 7;

/**
 * The usage rate to reason with: what the household is *observed* to consume
 * where that is known, otherwise the rate they typed in.
 *
 * `daily_usage` is entered once when an item is created and realistically
 * never revisited, yet every derived number leans on it — days left, low
 * stock, waste risk, the refill date. Meanwhile every Consume action is
 * logged with a timestamp, so the real rate is usually knowable. Preferring
 * the evidence means the app stops telling someone they have three days left
 * based on a guess it can already prove wrong.
 *
 * `observed_daily_usage` is attached by the backend (see
 * withObservedUsage in inventoryController) and simply absent when an item
 * has too little history to be worth trusting; the typed value is the
 * fallback, not the exception. Same tiering the ML demand forecast already
 * uses, applied to the arithmetic the rest of the app runs on.
 */
export function getEffectiveDailyUsage(item) {
  const observed = item.observed_daily_usage;
  if (typeof observed === 'number' && Number.isFinite(observed) && observed > 0) {
    return observed;
  }
  return item.daily_usage ?? 0;
}

/**
 * Days of stock left at the current usage rate. Infinity when nothing is
 * being consumed — an item with no usage never runs out on its own.
 */
export function getDaysLeft(item) {
  const quantity = item.quantity ?? 0;
  const dailyUsage = getEffectiveDailyUsage(item);
  return dailyUsage > 0 ? quantity / dailyUsage : Infinity;
}

/**
 * 'out' | 'low' | 'healthy'.
 *
 * An explicitly configured min_stock_level counts even when daily_usage is 0
 * or unset — that setting is the user telling us what "low" means for this
 * item, and honouring it only in the alert path (as the old code did) made
 * the dashboard and the alert emails contradict each other.
 */
export function getStockStatus(item) {
  if ((item.quantity ?? 0) <= 0) return 'out';

  const belowMinStock =
    item.min_stock_level != null && (item.quantity ?? 0) <= item.min_stock_level;

  return getDaysLeft(item) < LOW_STOCK_DAYS || belowMinStock ? 'low' : 'healthy';
}

/**
 * Ranks statuses so callers can detect stock getting *worse* (healthy -> low
 * -> out) rather than re-firing an alert on every write once an item is
 * already sitting below its threshold.
 */
export const STOCK_STATUS_RANK = { healthy: 0, low: 1, out: 2 };

/**
 * Days-of-runway bands used to estimate the chance an item runs out within
 * the next week, from least to most runway.
 */
export const LOW_STOCK_PROBABILITY_BANDS = [
  { withinDays: 3, probability: 0.95 },
  { withinDays: 7, probability: 0.75 },
  { withinDays: 10, probability: 0.45 },
];

/** Probability used when an item has more runway than every band above. */
export const BASELINE_LOW_STOCK_PROBABILITY = 0.05;

/**
 * Estimated probability (0–1) that an item runs out in the next 7 days.
 *
 * Used by the JS prediction fallback when the ML service is unreachable. The
 * identical ladder was previously written inline here and again inline in the
 * frontend's LowStockForecast chart; both now call this (and its client
 * mirror in frontend/src/utils/stock.ts).
 *
 * Deliberately considers only days of runway, not `min_stock_level`: an item
 * flagged 'low' purely because it sits below its configured minimum still
 * reports the baseline, because with no consumption it isn't actually on
 * track to run out.
 */
export function estimateLowStockProbability(item) {
  const daysLeft = getDaysLeft(item);
  for (const band of LOW_STOCK_PROBABILITY_BANDS) {
    if (daysLeft < band.withinDays) return band.probability;
  }
  return BASELINE_LOW_STOCK_PROBABILITY;
}

/**
 * Beyond this many days of remaining supply a refill date stops meaning
 * anything, and the arithmetic stops being safe: a large enough offset makes
 * `Date` invalid, and `toISOString()` on an invalid Date throws RangeError —
 * which previously took down the entire predictions response, not just the
 * one item.
 *
 * 100 years is far outside any useful horizon while leaving a wide margin
 * below the point where Date breaks, so nothing that produces a sensible
 * date today changes. Kept identical to MAX_REFILL_HORIZON_DAYS in
 * ml_service/main.py, which computes the same thing for the ML path.
 */
export const MAX_REFILL_HORIZON_DAYS = 36500;

/** Returned when no meaningful refill date exists. Matches the ML service. */
export const NO_REFILL_DATE = 'N/A';

/**
 * The day stock is projected to run out, or NO_REFILL_DATE when that isn't a
 * meaningful answer.
 *
 * Math.floor matches the ML service's int() truncation, so the answer is the
 * same whether or not that service is reachable.
 */
export function calculateRefillDate(quantity, dailyUsage, today = new Date()) {
  const usage = Number(dailyUsage);
  if (!Number.isFinite(usage) || usage <= 0) return NO_REFILL_DATE;

  const qty = Number(quantity);
  if (!Number.isFinite(qty)) return NO_REFILL_DATE;

  let daysToEmpty = qty / usage;
  if (!Number.isFinite(daysToEmpty)) return NO_REFILL_DATE;

  // Not reachable through the API (quantity is validated non-negative) but
  // clamped rather than trusted — a negative offset would quietly report a
  // refill date in the past.
  if (daysToEmpty < 0) daysToEmpty = 0;

  if (daysToEmpty > MAX_REFILL_HORIZON_DAYS) return NO_REFILL_DATE;

  const target = new Date(today.getTime());
  target.setDate(target.getDate() + Math.floor(daysToEmpty));

  if (Number.isNaN(target.getTime())) return NO_REFILL_DATE;
  return target.toISOString().split('T')[0];
}

/** Whole days until expiry (negative if already past), or null if unset. */
export function getDaysToExpiry(expiryDate) {
  if (!expiryDate) return null;
  return Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/**
 * True if the item is already expired OR expires within `windowDays`.
 *
 * Note the deliberate absence of a lower bound. Every early version of this
 * check used `days >= 0 && days < window`, which silently excluded
 * already-expired stock from "expiring soon" — the single worst place for an
 * app about reducing waste to have a blind spot.
 */
export function isExpiredOrExpiringSoon(expiryDate, windowDays = EXPIRY_WINDOW_DAYS) {
  const days = getDaysToExpiry(expiryDate);
  if (days === null) return false;
  return days < windowDays;
}

export function isExpired(expiryDate) {
  const days = getDaysToExpiry(expiryDate);
  return days !== null && days < 0;
}

/** 'expired' | 'expiring_soon' | 'healthy' | 'none' — drives the filter UI. */
export function getExpiryStatus(item) {
  const days = getDaysToExpiry(item.expiry_date);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days < EXPIRY_WINDOW_DAYS) return 'expiring_soon';
  return 'healthy';
}

/**
 * Surplus that will not be consumed before it expires.
 *
 * Deliberately a *separate* axis from stock status and expiry status, not a
 * change to either. An item can be "healthy" on stock (plenty of runway) and
 * merely "expiring soon" on date, while the genuinely useful fact is that
 * most of it is going in the bin: 1314 units consumed at 0.2/day cannot be
 * used up before tomorrow, whatever the other two columns say.
 *
 * Returns 0 when the question doesn't apply: no expiry date, nothing in
 * stock, or no usage rate to project from.
 */
export function getSurplusAtExpiry(item) {
  const days = getDaysToExpiry(item.expiry_date);
  if (days === null) return 0;

  const quantity = item.quantity ?? 0;
  if (quantity <= 0) return 0;

  // Already past its date: none of the remaining stock gets used. Checked
  // before the usage rate, because this is an observation about what has
  // already happened rather than a projection, and holds either way.
  if (days <= 0) return quantity;

  // No usage rate means there is nothing to project from, so no claim gets
  // made. Previously this returned the whole quantity — reading "we don't
  // know how fast this is used" as "none of it will be used", i.e. the
  // strongest possible warning from the least possible information.
  //
  // itemValidation requires daily_usage > 0, so this isn't reachable through
  // create or update today. It is still wrong to leave in place: the schema
  // allows 0 and *defaults* to it, so imported, migrated or pre-validation
  // documents carry it, and the client mirror computes from whatever the API
  // returns.
  const dailyUsage = getEffectiveDailyUsage(item);
  if (dailyUsage <= 0) return 0;

  return Math.max(0, quantity - dailyUsage * days);
}

/**
 * Fraction (0–1) of an item's stock projected to be wasted. 0 when none is.
 */
export function getWasteRiskRatio(item) {
  const quantity = item.quantity ?? 0;
  if (quantity <= 0) return 0;
  return getSurplusAtExpiry(item) / quantity;
}

/**
 * Share of an item's stock that must be surplus before it is worth warning
 * about. Below this the projection is too close to call — usage rates are
 * estimates, and flagging a 2% overshoot would make the warning noise.
 */
export const WASTE_RISK_THRESHOLD = 0.1;

/** True when a meaningful share of this item is projected to be wasted. */
export function isAtWasteRisk(item) {
  return getWasteRiskRatio(item) > WASTE_RISK_THRESHOLD;
}

/** Rupee value of the surplus, or 0 when no cost is recorded. */
export function getWasteRiskValue(item) {
  return getSurplusAtExpiry(item) * (item.cost_per_unit || 0);
}

/**
 * Items that are neither expiring nor running out — the stock that current
 * behaviour is successfully protecting from waste.
 */
export function getWellManagedItems(items) {
  return items.filter(
    (item) =>
      !isExpiredOrExpiringSoon(item.expiry_date) && getStockStatus(item) === 'healthy'
  );
}

/**
 * Aggregate dashboard metrics.
 *
 * `lowStockItems` counts everything needing restock attention — both 'low'
 * and 'out' — which is what the "Critical Stock" card has always meant.
 */
export function calculateStats(items) {
  const list = items || [];
  const totalItems = list.length;

  const lowStockItems = list.filter((item) => getStockStatus(item) !== 'healthy').length;
  const outOfStockItems = list.filter((item) => getStockStatus(item) === 'out').length;
  const expiringSoon = list.filter((item) => isExpiredOrExpiringSoon(item.expiry_date)).length;

  // Overstock relative to shelf life. A separate axis from the two above:
  // an item can be healthy on stock and merely expiring soon on date while
  // most of it is still headed for the bin.
  const atRiskItems = list.filter(isAtWasteRisk);
  const wasteRiskItems = atRiskItems.length;
  const wasteRiskValue = Math.round(
    atRiskItems.reduce((sum, item) => sum + getWasteRiskValue(item), 0)
  );

  const categoryCounts = list.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});

  const wellManaged = getWellManagedItems(list);

  // Value of stock currently safe from waste. Items with no cost_per_unit
  // contribute 0 rather than a fabricated per-category price guess.
  const predictedSavings = Math.round(
    wellManaged.reduce((sum, item) => sum + (item.quantity || 0) * (item.cost_per_unit || 0), 0)
  );

  return {
    totalItems,
    lowStockItems,
    outOfStockItems,
    expiringSoon,
    wasteRiskItems,
    wasteRiskValue,
    categoryCounts,
    predictedSavings,
  };
}
