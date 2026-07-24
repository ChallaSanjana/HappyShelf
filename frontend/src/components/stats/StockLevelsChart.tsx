import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const StockLevelsChart: React.FC<Props> = ({ items }) => {
  const labels = items.slice(0, 6).map((i) => i.name || 'Item');
  const data = items.slice(0, 6).map((i) => i.quantity || 0);

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Stock Levels</h4>
      {items.length > 0 ? (
        <SimpleBarChart
          labels={labels}
          datasets={[{ label: 'Quantity', data, backgroundColor: '#3B82F6' }]}
          height={220}
        />
      ) : (
        <div className="flex items-center justify-center h-[220px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
          No inventory items to display.
        </div>
      )}
    </div>
  );
};

export default StockLevelsChart;
