import { InventoryItem } from '../services/api';
import { isExpired, isExpiredOrExpiringSoon } from './expiry';

export interface CalculatedMetrics {
  totalItems: number;
  lowStockItems: number;
  expiringSoon: number;
  categoryCounts: Record<string, number>;
  predictedSavings: number;
  carbonReduced: number;
}

/**
 * Calculate all inventory metrics from items array
 * All calculations are done on the frontend based on item data
 */
export const calculateMetrics = (items: InventoryItem[]): CalculatedMetrics => {
  if (!items || items.length === 0) {
    return {
      totalItems: 0,
      lowStockItems: 0,
      expiringSoon: 0,
      categoryCounts: {},
      predictedSavings: 0,
      carbonReduced: 0,
    };
  }

  const totalItems = items.length;

  const lowStockItems = items.filter((item) => {
    const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
    return daysLeft < 3;
  }).length;

  // Count items expiring soon (within 7 days) OR already expired.
  // Previously this only matched days >= 0, so already-expired items were
  // never flagged anywhere. isExpiredOrExpiringSoon fixes that.
  const expiringSoon = items.filter((item) => isExpiredOrExpiringSoon(item.expiry_date, 7)).length;

  const categoryCounts = items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Calculate well-managed items (not expired, not expiring soon, AND not low stock)
  const wellManagedItems = items.filter((item) => {
    if (isExpired(item.expiry_date)) return false;
    const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
    return !isExpiredOrExpiringSoon(item.expiry_date, 7) && daysLeft >= 3;
  }).length;

  const predictedSavings = totalItems > 0 ? Math.round(wellManagedItems * 5) : 0;
  const carbonReduced = totalItems > 0 ? Math.round(wellManagedItems * 0.5 * 100) / 100 : 0;

  return {
    totalItems,
    lowStockItems,
    expiringSoon,
    categoryCounts,
    predictedSavings,
    carbonReduced,
  };
};