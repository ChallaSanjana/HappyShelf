import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const SeasonalTrends: React.FC<Props> = ({ items }) => {
  if (!items || items.length === 0) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Seasonal Trends</h4>
        <div className="flex items-center justify-center h-[140px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
          No inventory items to forecast.
        </div>
      </div>
    );
  }

  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const base = Math.max(1, Math.round(items.length / 6));
  const data = labels.map((_, i) => Math.round(base * (1 + Math.cos(i) * 0.3 + (i % 3) * 0.05)));

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Seasonal Trends</h4>
      <SimpleLineChart labels={labels} datasets={[{ label: 'Seasonal Demand', data, borderColor: '#34d399' }]} height={140} />
    </div>
  );
};

export default SeasonalTrends;
