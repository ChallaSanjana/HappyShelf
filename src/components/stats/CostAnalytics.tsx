import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const CostAnalytics: React.FC<Props> = ({ items, stats }) => {
  // Placeholder showing cost trend (synthetic)
  const labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
  const data = labels.map((_, i) => Math.round((items.length || 10) * (100 + i * 20)));

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Cost Analytics</h4>
      <SimpleLineChart labels={labels} datasets={[{ label: 'Estimated Cost ($)', data, borderColor: '#EF4444' }]} height={180} />
    </div>
  );
};

export default CostAnalytics;
