import React from 'react';
import { InventoryItem } from '../../services/api';
import { SimplePieChart } from '../charts/SimpleChart';
import { getDaysToExpiry } from '../../utils/expiry';

type Props = { items: InventoryItem[] };

const ExpiryToUsageEfficiency: React.FC<Props> = ({ items }) => {
  const perishableItems = items.filter((it) => it.expiry_date);

  if (perishableItems.length === 0) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Expiry → Usage Efficiency</h4>
        <div className="flex items-center justify-center h-[160px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
          No perishable items to analyze.
        </div>
      </div>
    );
  }

  let totalUsed = 0;
  let totalWasted = 0;

  perishableItems.forEach((it) => {
    const days = getDaysToExpiry(it.expiry_date);
    if (days === null) return;
    if (days < 0) {
      totalWasted += it.quantity || 0;
    } else {
      const expectedConsumption = (it.daily_usage || 0) * days;
      const used = Math.min(it.quantity || 0, expectedConsumption);
      const wasted = Math.max(0, (it.quantity || 0) - expectedConsumption);
      totalUsed += used;
      totalWasted += wasted;
    }
  });

  if (totalUsed === 0 && totalWasted === 0) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Expiry → Usage Efficiency</h4>
        <div className="flex items-center justify-center h-[160px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
          No active quantities for perishable items.
        </div>
      </div>
    );
  }

  const labels = ['Used Before Expiry', 'Wasted Due To Expiry'];
  const data = [Math.round(totalUsed), Math.round(totalWasted)];

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Expiry → Usage Efficiency</h4>
      <SimplePieChart labels={labels} datasets={[{ label: 'Efficiency', data, backgroundColor: ['#10b981', '#ef4444'] }]} height={160} />
    </div>
  );
};

export default ExpiryToUsageEfficiency;
