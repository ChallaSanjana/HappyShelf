import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimplePieChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const CategoryInsights: React.FC<Props> = ({ stats }) => {
  const catCounts = stats?.categoryCounts || {};

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Category Breakdown</h4>
      {Object.keys(catCounts).length > 0 ? (
        <SimplePieChart
          labels={Object.keys(catCounts)}
          datasets={[
            {
              label: 'Categories',
              data: Object.values(catCounts),
              backgroundColor: ['#60A5FA', '#34D399', '#F59E0B', '#F87171', '#A78BFA', '#FBBF24', '#EC4899', '#14B8A6'],
            },
          ]}
          height={220}
        />
      ) : (
        <div className="flex items-center justify-center h-[220px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
          No inventory items to analyze.
        </div>
      )}
    </div>
  );
};

export default CategoryInsights;
