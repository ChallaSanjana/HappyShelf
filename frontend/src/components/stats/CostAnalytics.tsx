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

  // Items without a cost_per_unit entered contribute ₹0 rather than a
  // fabricated per-category price guess — the chart is only as complete as
  // the cost data users have actually entered on their items.
  const itemsWithCost = items.filter((item) => item.cost_per_unit !== null && item.cost_per_unit !== undefined);

  const labels = ['Week -4', 'Week -3', 'Week -2', 'Week -1', 'This Week'];
  const weeksMultiplier = [28, 21, 14, 7, 0];

  const data = weeksMultiplier.map((daysAgo) => {
    return Math.round(
      items.reduce((sum, item) => {
        const qtyAgo = Math.max(0, (item.quantity || 0) + (item.daily_usage || 0) * daysAgo);
        return sum + qtyAgo * (item.cost_per_unit || 0);
      }, 0)
    );
  });

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Cost Analytics</h4>
      <SimpleLineChart labels={labels} datasets={[{ label: 'Estimated Cost (₹)', data, borderColor: '#EF4444' }]} height={180} />
      {itemsWithCost.length < items.length && (
        <p className="mt-2 text-xs text-gray-500">
          {items.length - itemsWithCost.length} of {items.length} item{items.length === 1 ? '' : 's'} {items.length - itemsWithCost.length === 1 ? "doesn't" : "don't"} have a cost entered yet and are excluded from this estimate — add one in Edit Item for a more complete picture.
        </p>
      )}
    </div>
  );
};

export default CostAnalytics;
