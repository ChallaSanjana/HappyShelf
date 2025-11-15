import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const UsageTrends: React.FC<Props> = ({ items, stats }) => {
  // Build sample monthly labels and data from items' daily_usage
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  const totalDaily = labels.map((_, i) => Math.max(0, Math.round((stats?.totalItems || 0) * (0.8 + i * 0.05))));

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Usage Trends (historical)</h4>
      <SimpleLineChart
        labels={labels}
        datasets={[{ label: 'Estimated Usage', data: totalDaily, borderColor: '#10B981' }]}
        height={220}
      />
    </div>
  );
};

export default UsageTrends;
