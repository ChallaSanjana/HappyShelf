import { InventoryItem } from '../services/api';

/**
 * Mirrors calculateSuggestedReorderQuantity in inventoryController.js so the
 * modal can show a sensible default before the user edits it or submits.
 * The backend recalculates independently and is the actual source of truth
 * if no quantity is sent — this is purely for the preview UI.
 */
export const getSuggestedReorderQuantity = (item: InventoryItem): number => {
    const twoWeekBuffer = Math.ceil((item.daily_usage || 0) * 14);
    const minStock = item.min_stock_level || 0;
    return Math.max(minStock, twoWeekBuffer, 1);
};