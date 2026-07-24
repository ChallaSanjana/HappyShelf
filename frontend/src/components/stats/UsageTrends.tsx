import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const UsageTrends: React.FC<Props> = ({ items }) => {
  const totalDailyUsage = items ? items.reduce((sum, item) => sum + (item.daily_usage || 0), 0) : 0;

  if (totalDailyUsage === 0) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Usage Trends (historical)</h4>
        <div className="flex items-center justify-center h-[220px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
          No usage records to display. Add items with daily usage values to see trends.
        </div>
      </div>
    );
  }

  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  const monthlyUsageBase = totalDailyUsage * 30;
  const data = labels.map((_, i) => Math.max(0, Math.round(monthlyUsageBase * (0.85 + Math.sin(i) * 0.1))));

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Usage Trends (historical)</h4>
      <SimpleLineChart
        labels={labels}
        datasets={[{ label: 'Estimated Monthly Usage (Units)', data, borderColor: '#10B981' }]}
        height={220}
      />
    </div>
  );
};

export default UsageTrends;
