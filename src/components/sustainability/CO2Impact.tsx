import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const CO2Impact: React.FC<Props> = ({ items }) => {
  // synthetic CO2 impact based on number of wasted items
  const wasted = items.filter((it) => it.quantity <= 0).length;
  const labels = ['Week -4', 'Week -3', 'Week -2', 'Week -1', 'This Week'];
  const base = Math.max(1, Math.round(wasted || 5));
  const data = labels.map((_, i) => Math.round(base * (1 + i * 0.5)));

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Estimated CO₂ Impact (kg)</h4>
      <SimpleLineChart labels={labels} datasets={[{ label: 'CO₂ (kg)', data, borderColor: '#84cc16' }]} height={140} />
      <div className="mt-2 text-sm text-gray-600">Estimated CO₂ from waste. Reduce waste to lower emissions.</div>
    </div>
  );
};

export default CO2Impact;
