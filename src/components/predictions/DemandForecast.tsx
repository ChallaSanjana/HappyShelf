import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const DemandForecast: React.FC<Props> = ({ items, stats }) => {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const base = Math.max(1, Math.round((stats?.totalItems || items.length) / 5));
  const data = labels.map((_, i) => Math.round(base * (1 + Math.sin(i) * 0.2 + i * 0.05)));

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Demand Forecast</h4>
      <SimpleLineChart labels={labels} datasets={[{ label: 'Predicted Demand', data, borderColor: '#0ea5e9' }]} height={180} />
    </div>
  );
};

export default DemandForecast;
