import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const ExpiryForecast: React.FC<Props> = ({ items }) => {
  const buckets = ['0-3d', '4-7d', '8-14d', '15+d'];
  const counts = [0, 0, 0, 0];
  items.forEach((it) => {
    if (!it.expiry_date) {
      counts[3] += 1;
      return;
    }
    const days = Math.ceil((new Date(it.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (days <= 3 && days >= 0) counts[0] += 1;
    else if (days <= 7) counts[1] += 1;
    else if (days <= 14) counts[2] += 1;
    else counts[3] += 1;
  });

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Expiry Forecast</h4>
      <SimpleBarChart labels={buckets} datasets={[{ label: 'Expiring Items', data: counts, backgroundColor: '#ef4444' }]} height={140} />
    </div>
  );
};

export default ExpiryForecast;
