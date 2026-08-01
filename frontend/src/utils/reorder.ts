import { InventoryItem } from '../services/api';
import { getEffectiveDailyUsage } from './stock';

/**
 * Mirrors calculateSuggestedReorderQuantity in inventoryController.js so the
 * modal can show a sensible default before the user edits it or submits.
 * The backend recalculates independently and is the actual source of truth
 * if no quantity is sent — this is purely for the preview UI.
 *
 * Suggests enough to bring the item UP TO its target level (two-week usage
 * buffer, or min_stock_level if higher) rather than always adding a flat
 * buffer on top of whatever's already in stock — floored at 1 so there's
 * always a positive default even when already at/above target.
 */
export const getSuggestedReorderQuantity = (item: InventoryItem): number => {
    // getEffectiveDailyUsage, not item.daily_usage, so the preview matches
    // what the server will compute -- and so "two weeks of usage" means two
    // weeks of the household's observed usage where that is known.
    const twoWeekBuffer = Math.ceil(getEffectiveDailyUsage(item) * 14);
    const minStock = item.min_stock_level || 0;
    const targetLevel = Math.max(minStock, twoWeekBuffer, 1);
    const currentQuantity = item.quantity || 0;
    return Math.max(targetLevel - currentQuantity, 1);
};