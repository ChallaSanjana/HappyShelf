import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { isWasted } from '../../utils/sustainability';

type Props = { items: InventoryItem[]; stats: Stats | null };

const SustainabilityScore: React.FC<Props> = ({ items }) => {
  // Share of current stock that isn't wasted. "Wasted" comes from
  // utils/sustainability.ts, shared with the waste tracker, the CO2 chart
  // and the PDF report.
  const wasted = items.filter(isWasted).length;
  const total = Math.max(1, items.length);
  const score = Math.max(0, Math.round(((total - wasted) / total) * 100));

  return (
    <div className="text-center">
      <h4 className="text-md font-medium mb-2">Sustainability Score</h4>
      <div className="text-3xl font-bold text-green-600">{score}</div>
      <div className="text-sm text-gray-600">
        {items.length === 0
          ? 'Add items to start tracking'
          : `${total - wasted} of ${total} items in good standing`}
      </div>
    </div>
  );
};

export default SustainabilityScore;