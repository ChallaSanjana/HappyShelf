import { InventoryItem } from '../services/api';
import { getDaysToExpiry } from './expiry';

/**
 * Client-side mirror of backend/src/utils/inventoryMetrics.js.
 *
 * The two implementations exist because the dashboard recomputes stats
 * locally on every item change (so the UI updates instantly instead of
 * waiting on a round trip), while the server needs the same answers for
 * `/api/inventory/stats`, the search filters, and the low-stock alert
 * emails. Keeping them identical is enforced by tests on both sides that
 * run the same fixtures through both — see src/utils/__tests__/metrics.test.ts
 * and backend/__tests__/metrics.test.js. If you change a rule here, change
 * it there in the same commit.
 */

export type StockStatus = 'out' | 'low' | 'healthy';

/** Days of remaining supply below which an item counts as low. */
export const LOW_STOCK_DAYS = 3;

/** Rough kg of CO2 avoided per item kept out of the bin. */
export const CARBON_PER_WELL_MANAGED_ITEM = 0.5;

/**
 * Days of stock left at the current usage rate. Infinity when nothing is
 * being consumed — an item with no usage never runs out on its own.
 */
export const getDaysLeft = (item: Pick<InventoryItem, 'quantity' | 'daily_usage'>): number => {
  const quantity = item.quantity ?? 0;
  const dailyUsage = item.daily_usage ?? 0;
  return dailyUsage > 0 ? quantity / dailyUsage : Infinity;
};

/**
 * An explicitly configured min_stock_level counts even when daily_usage is 0
 * or unset — that setting is the user telling us what "low" means for this
 * item. Honouring it only in the backend's alert path (as the old code did)
 * made the dashboard and the alert emails contradict each other.
 */
export const getStockStatus = (
  item: Pick<InventoryItem, 'quantity' | 'daily_usage' | 'min_stock_level'>
): StockStatus => {
  if ((item.quantity ?? 0) <= 0) return 'out';

  const belowMinStock =
    item.min_stock_level != null && (item.quantity ?? 0) <= item.min_stock_level;

  return getDaysLeft(item) < LOW_STOCK_DAYS || belowMinStock ? 'low' : 'healthy';
};

/** True when the item needs restock attention — i.e. it is low or already out. */
export const needsRestock = (
  item: Pick<InventoryItem, 'quantity' | 'daily_usage' | 'min_stock_level'>
): boolean => getStockStatus(item) !== 'healthy';

/**
 * Surplus that will not be consumed before it expires.
 *
 * A separate axis from stock status and expiry status, not a change to
 * either. An item can be "healthy" on stock and merely "expiring soon" on
 * date while most of it is still headed for the bin.
 *
 * Client mirror of getSurplusAtExpiry in backend/src/utils/inventoryMetrics.js;
 * the shared fixtures run both.
 */
export const getSurplusAtExpiry = (
  item: Pick<InventoryItem, 'quantity' | 'daily_usage' | 'expiry_date'>
): number => {
  const days = getDaysToExpiry(item.expiry_date);
  if (days === null) return 0;

  const quantity = item.quantity ?? 0;
  if (quantity <= 0) return 0;

  const dailyUsage = item.daily_usage ?? 0;
  // Nothing is being consumed, so none of it gets used before it expires.
  if (dailyUsage <= 0) return quantity;

  // Already past its date: none of the remaining stock gets used.
  if (days <= 0) return quantity;

  return Math.max(0, quantity - dailyUsage * days);
};

/** Fraction (0–1) of an item's stock projected to be wasted. */
export const getWasteRiskRatio = (
  item: Pick<InventoryItem, 'quantity' | 'daily_usage' | 'expiry_date'>
): number => {
  const quantity = item.quantity ?? 0;
  if (quantity <= 0) return 0;
  return getSurplusAtExpiry(item) / quantity;
};

/**
 * Share of an item's stock that must be surplus before it is worth warning
 * about. Below this the projection is too close to call — usage rates are
 * estimates, and flagging a 2% overshoot would make the warning noise.
 */
export const WASTE_RISK_THRESHOLD = 0.1;

/** True when a meaningful share of this item is projected to be wasted. */
export const isAtWasteRisk = (
  item: Pick<InventoryItem, 'quantity' | 'daily_usage' | 'expiry_date'>
): boolean => getWasteRiskRatio(item) > WASTE_RISK_THRESHOLD;

/** Rupee value of the surplus, or 0 when no cost is recorded. */
export const getWasteRiskValue = (
  item: Pick<InventoryItem, 'quantity' | 'daily_usage' | 'expiry_date' | 'cost_per_unit'>
): number => getSurplusAtExpiry(item) * (item.cost_per_unit || 0);

/**
 * Days-of-runway bands used to estimate the chance an item runs out within
 * the next week, from least to most runway.
 */
export const LOW_STOCK_PROBABILITY_BANDS: ReadonlyArray<{ withinDays: number; probability: number }> = [
  { withinDays: 3, probability: 0.95 },
  { withinDays: 7, probability: 0.75 },
  { withinDays: 10, probability: 0.45 },
];

/** Probability used when an item has more runway than every band above. */
export const BASELINE_LOW_STOCK_PROBABILITY = 0.05;

/**
 * Estimated probability (0–1) that an item runs out in the next 7 days.
 *
 * Used when the ML service hasn't supplied a `low_stock_probability` for an
 * item. The identical ladder previously existed twice — inline in the
 * backend's JS prediction fallback and again inline in LowStockForecast — so
 * it now lives here and in backend/src/utils/inventoryMetrics.js, pinned
 * together by the shared fixtures like every other rule.
 *
 * Note this deliberately considers only days of runway, not
 * `min_stock_level`: an item flagged 'low' purely because it sits below its
 * configured minimum still reports the baseline probability, because with no
 * consumption it genuinely isn't on track to run out. That is existing
 * behaviour, preserved here rather than changed.
 */
export const estimateLowStockProbability = (
  item: Pick<InventoryItem, 'quantity' | 'daily_usage'>
): number => {
  const daysLeft = getDaysLeft(item);
  for (const band of LOW_STOCK_PROBABILITY_BANDS) {
    if (daysLeft < band.withinDays) return band.probability;
  }
  return BASELINE_LOW_STOCK_PROBABILITY;
};
