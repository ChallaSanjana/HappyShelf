import React from 'react';
import { InventoryItem, Stats } from '../../services/api';

type Props = { items: InventoryItem[]; stats: Stats | null };

const SustainabilityScore: React.FC<Props> = ({ items }) => {
  // rudimentary score: fewer wasted and more recycling -> higher score
  const wasted = items.filter((it) => it.quantity <= 0).length;
  const total = Math.max(1, items.length);
  const score = Math.max(0, Math.round(((total - wasted) / total) * 100));

  return (
    <div className="text-center">
      <h4 className="text-md font-medium mb-2">Sustainability Score</h4>
      <div className="text-3xl font-bold text-green-600">{score}</div>
      <div className="text-sm text-gray-600">Higher is better — based on recent waste & expiry metrics</div>
    </div>
  );
};

export default SustainabilityScore;
