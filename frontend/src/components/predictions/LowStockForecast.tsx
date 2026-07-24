import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const LowStockForecast: React.FC<Props> = ({ items }) => {
  if (!items || items.length === 0) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Low Stock Forecast (7 days)</h4>
        <div className="flex items-center justify-center h-[160px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
          No inventory items to forecast.
        </div>
      </div>
    );
  }

  const sample = items.slice(0, 6);
  const labels = sample.map((s) => s.name);
  const data = sample.map((s) => Math.max(0, Math.round((s.quantity || 0) - (s.daily_usage || 0) * 7)));

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Low Stock Forecast (7 days)</h4>
      <SimpleBarChart labels={labels} datasets={[{ label: 'Expected Remaining', data, backgroundColor: '#f97316' }]} height={160} />
    </div>
  );
};

export default LowStockForecast;
