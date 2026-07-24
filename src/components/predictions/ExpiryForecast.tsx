import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';
import { getDaysToExpiry } from '../../utils/expiry';

type Props = { items: InventoryItem[]; stats: Stats | null };

const ExpiryForecast: React.FC<Props> = ({ items }) => {
  const buckets = ['Expired', '0-3d', '4-7d', '8-14d', '15+d'];
  const counts = [0, 0, 0, 0, 0];

  items.forEach((it) => {
    const days = getDaysToExpiry(it.expiry_date);
    if (days === null) {
      counts[4] += 1;
      return;
    }
    // The previous version only checked an upper bound after the first
    // bucket (`else if (days <= 7)` with no lower bound), so an
    // already-expired item (e.g. days = -10) fell into the "4-7d" bucket
    // instead of being flagged as expired.
    if (days < 0) counts[0] += 1;
    else if (days <= 3) counts[1] += 1;
    else if (days <= 7) counts[2] += 1;
    else if (days <= 14) counts[3] += 1;
    else counts[4] += 1;
  });

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Expiry Forecast</h4>
      <SimpleBarChart labels={buckets} datasets={[{ label: 'Expiring Items', data: counts, backgroundColor: '#ef4444' }]} height={140} />
    </div>
  );
};

export default ExpiryForecast;