import { InventoryItem } from '../services/api';

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

  // Count low stock items (less than 3 days of supply left)
  const lowStockItems = items.filter((item) => {
    const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
    return daysLeft < 3;
  }).length;

  // Count items expiring soon (within 7 days)
  const expiringSoon = items.filter((item) => {
    if (!item.expiry_date) return false;
    const daysToExpiry = Math.ceil(
      (new Date(item.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysToExpiry >= 0 && daysToExpiry < 7;
  }).length;

  // Count items by category
  const categoryCounts = items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Calculate well-managed items (not expiring soon AND not low stock)
  const wellManagedItems = items.filter((item) => {
    if (!item.expiry_date) return true; // No expiry concern
    const daysToExpiry = Math.ceil(
      (new Date(item.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );
    const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
    return daysToExpiry >= 7 && daysLeft >= 3; // Not expiring soon and not low stock
  }).length;

  // Predicted Savings: $5 per well-managed item (estimated waste prevention value)
  const predictedSavings = totalItems > 0 ? Math.round(wellManagedItems * 5) : 0;

  // Carbon Reduced: 0.5kg CO2 per well-managed item (waste prevention)
  // Round to 2 decimal places for readability
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
