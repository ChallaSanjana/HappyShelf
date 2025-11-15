import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const StockLevelsChart: React.FC<Props> = ({ items, stats }) => {
  const labels = items.slice(0, 6).map((i) => i.name || 'Item');
  const data = items.slice(0, 6).map((i) => i.quantity || 0);

  // fallback sample data when empty
  const finalLabels = labels.length ? labels : ['Item A', 'Item B', 'Item C'];
  const finalData = data.length ? data : [12, 8, 5];

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Stock Levels</h4>
      <SimpleBarChart
        labels={finalLabels}
        datasets={[{ label: 'Quantity', data: finalData, backgroundColor: '#3B82F6' }]}
        height={220}
      />
    </div>
  );
};

export default StockLevelsChart;
