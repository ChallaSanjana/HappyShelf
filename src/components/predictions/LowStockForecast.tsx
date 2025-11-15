import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const LowStockForecast: React.FC<Props> = ({ items }) => {
  const sample = items.slice(0, 6);
  const labels = sample.length ? sample.map((s) => s.name) : ['Item A', 'Item B', 'Item C'];
  const data = sample.length ? sample.map((s) => Math.max(0, Math.round((s.quantity || 0) - (s.daily_usage || 0) * 7))) : [2, 5, 1];

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Low Stock Forecast (7 days)</h4>
      <SimpleBarChart labels={labels} datasets={[{ label: 'Expected Remaining', data, backgroundColor: '#f97316' }]} height={160} />
    </div>
  );
};

export default LowStockForecast;
