import React from 'react';
import { InventoryItem } from '../../services/api';
import { SimplePieChart } from '../charts/SimpleChart';
import { getDaysToExpiry } from '../../utils/expiry';
import { getSurplusAtExpiry } from '../../utils/stock';

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

  // Split via the shared getSurplusAtExpiry rather than a local copy of
  // `quantity - daily_usage * days`. The copy had drifted twice over: it read
  // the typed daily_usage instead of the household's observed rate, and it
  // still treated a missing rate as "none of it will be used", so this chart
  // could show an item as entirely wasted while the inventory table showed no
  // Overstocked badge for it.
  perishableItems.forEach((it) => {
    if (getDaysToExpiry(it.expiry_date) === null) return;
    const wasted = getSurplusAtExpiry(it);
    totalWasted += wasted;
    totalUsed += Math.max(0, (it.quantity || 0) - wasted);
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
