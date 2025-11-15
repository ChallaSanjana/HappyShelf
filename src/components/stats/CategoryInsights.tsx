import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimplePieChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const CategoryInsights: React.FC<Props> = ({ items, stats }) => {
  const catCounts = stats?.categoryCounts || {};
  const labels = Object.keys(catCounts).length ? Object.keys(catCounts) : ['Dry Goods', 'Dairy', 'Produce'];
  const data = Object.keys(catCounts).length ? Object.values(catCounts) : [12, 7, 6];

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Category Breakdown</h4>
      <SimplePieChart
        labels={labels}
        datasets={[{ label: 'Categories', data, backgroundColor: ['#60A5FA', '#34D399', '#F59E0B'] }]}
        height={220}
      />
    </div>
  );
};

export default CategoryInsights;
