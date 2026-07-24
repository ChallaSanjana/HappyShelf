import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const CostAnalytics: React.FC<Props> = ({ items }) => {
  if (!items || items.length === 0) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Cost Analytics</h4>
        <div className="flex items-center justify-center h-[180px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
          No inventory items to analyze.
        </div>
      </div>
    );
  }

  const categoryCosts: Record<string, number> = {
    produce: 2.5,
    dairy: 3.5,
    meat: 8.0,
    bakery: 2.0,
    dry: 1.5,
    beverage: 2.2,
  };

  const getUnitCost = (category: string) => {
    const cat = category?.toLowerCase() || '';
    for (const [key, val] of Object.entries(categoryCosts)) {
      if (cat.includes(key)) return val;
    }
    return 3.0; // default cost per unit
  };

  const labels = ['Week -4', 'Week -3', 'Week -2', 'Week -1', 'This Week'];
  const weeksMultiplier = [28, 21, 14, 7, 0];

  const data = weeksMultiplier.map((daysAgo) => {
    return Math.round(
      items.reduce((sum, item) => {
        const qtyAgo = Math.max(0, (item.quantity || 0) + (item.daily_usage || 0) * daysAgo);
        return sum + qtyAgo * getUnitCost(item.category);
      }, 0)
    );
  });

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Cost Analytics</h4>
      <SimpleLineChart labels={labels} datasets={[{ label: 'Estimated Cost ($)', data, borderColor: '#EF4444' }]} height={180} />
    </div>
  );
};

export default CostAnalytics;
