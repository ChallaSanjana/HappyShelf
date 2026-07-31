import { InventoryItem, ConsumptionHistoryEntry } from '../services/api';
import { isExpiredOrExpiringSoon } from './expiry';
import { getStockStatus } from './stock';

/**
 * Shared waste and CO2 rules.
 *
 * `isWasted` and the CO2 factor table were each copy-pasted into three or
 * four components (FoodWasteTracker, CO2Impact, SustainabilityScore,
 * reportGenerator). They agreed at the time of writing, which is exactly how
 * the stock/expiry rules used to look right before they drifted.
 */

/** Rough kg CO2e per unit of wasted stock, by category keyword. */
export const CATEGORY_CO2_FACTORS: Record<string, number> = {
  produce: 1.2,
  dairy: 3.0,
  meat: 10.0,
  bakery: 1.5,
  dry: 0.8,
  beverage: 1.0,
};

/** Fallback factor for a category that matches none of the keywords above. */
export const DEFAULT_CO2_FACTOR = 2.0;

export const getCO2Factor = (category: string): number => {
  const cat = category?.toLowerCase() || '';
  for (const [key, value] of Object.entries(CATEGORY_CO2_FACTORS)) {
    if (cat.includes(key)) return value;
  }
  return DEFAULT_CO2_FACTOR;
};

/**
 * An item counts as wasted when it is out of stock or already past its
 * expiry date. Out-of-stock is included because the sustainability views
 * treat "we ran out" and "it went off" as the two ways stock stops being
 * useful.
 */
export const isWasted = (item: InventoryItem): boolean =>
  getStockStatus(item) === 'out' || isExpiredOrExpiringSoon(item.expiry_date, 0);

/** Estimated CO2e attributable to an item's current wasted quantity. */
export const getItemWasteCO2 = (item: InventoryItem): number =>
  (item.quantity || 0) * getCO2Factor(item.category);

/**
 * CO2e associated with stock the household actually used, derived from the
 * consumption log. This is the counterfactual saving: had those units been
 * thrown away instead of consumed, this is roughly what they would have cost
 * the atmosphere.
 */
export const getConsumedCO2 = (entry: ConsumptionHistoryEntry): number =>
  (entry.quantityConsumed || 0) * getCO2Factor(entry.category);
