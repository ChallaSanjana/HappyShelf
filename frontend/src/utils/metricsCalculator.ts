import { InventoryItem } from '../services/api';
import { isExpiredOrExpiringSoon } from './expiry';
import {
  getStockStatus,
  needsRestock,
  isAtWasteRisk,
  getWasteRiskValue,
  CARBON_PER_WELL_MANAGED_ITEM,
} from './stock';

export interface CalculatedMetrics {
  totalItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  expiringSoon: number;
  wasteRiskItems: number;
  wasteRiskValue: number;
  categoryCounts: Record<string, number>;
  predictedSavings: number;
  carbonReduced: number;
}

/**
 * Items that are neither expiring nor running out — the stock that current
 * behaviour is successfully protecting from waste.
 */
export const getWellManagedItems = (items: InventoryItem[]): InventoryItem[] =>
  items.filter(
    (item) => !isExpiredOrExpiringSoon(item.expiry_date) && getStockStatus(item) === 'healthy'
  );

/**
 * Dashboard metrics, computed locally so the UI updates the instant an item
 * changes rather than waiting on a round trip.
 *
 * Must stay equivalent to calculateStats() in
 * backend/src/utils/inventoryMetrics.js — the shared-fixture tests on both
 * sides exist to catch it if it doesn't.
 */
export const calculateMetrics = (items: InventoryItem[]): CalculatedMetrics => {
  const list = items || [];
  const totalItems = list.length;

  if (totalItems === 0) {
    return {
      totalItems: 0,
      lowStockItems: 0,
      outOfStockItems: 0,
      expiringSoon: 0,
      wasteRiskItems: 0,
      wasteRiskValue: 0,
      categoryCounts: {},
      predictedSavings: 0,
      carbonReduced: 0,
    };
  }

  const lowStockItems = list.filter(needsRestock).length;
  const outOfStockItems = list.filter((item) => getStockStatus(item) === 'out').length;
  const expiringSoon = list.filter((item) => isExpiredOrExpiringSoon(item.expiry_date)).length;

  // Overstock relative to shelf life — a separate axis from stock and expiry
  // status, matching calculateStats on the backend.
  const atRisk = list.filter(isAtWasteRisk);
  const wasteRiskItems = atRisk.length;
  const wasteRiskValue = Math.round(atRisk.reduce((sum, item) => sum + getWasteRiskValue(item), 0));

  const categoryCounts = list.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const wellManaged = getWellManagedItems(list);

  // Value of stock currently safe from waste. Items with no cost_per_unit
  // contribute 0 rather than a fabricated per-category price guess.
  const predictedSavings = Math.round(
    wellManaged.reduce((sum, item) => sum + (item.quantity || 0) * (item.cost_per_unit || 0), 0)
  );

  const carbonReduced =
    Math.round(wellManaged.length * CARBON_PER_WELL_MANAGED_ITEM * 100) / 100;

  return {
    totalItems,
    lowStockItems,
    outOfStockItems,
    expiringSoon,
    wasteRiskItems,
    wasteRiskValue,
    categoryCounts,
    predictedSavings,
    carbonReduced,
  };
};
