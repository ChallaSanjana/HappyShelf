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

/** Rough kg of CO2 avoided per item kept out of the bin. */
export const CARBON_PER_WELL_MANAGED_ITEM = 0.5;

/**
 * Days of stock left at the current usage rate. Infinity when nothing is
 * being consumed — an item with no usage never runs out on its own.
 */
export function getDaysLeft(item) {
  const quantity = item.quantity ?? 0;
  const dailyUsage = item.daily_usage ?? 0;
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

  const carbonReduced =
    totalItems > 0
      ? Math.round(wellManaged.length * CARBON_PER_WELL_MANAGED_ITEM * 100) / 100
      : 0;

  return {
    totalItems,
    lowStockItems,
    outOfStockItems,
    expiringSoon,
    categoryCounts,
    predictedSavings,
    carbonReduced,
  };
}
