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
    // No expiry_date set means the item doesn't expire — it isn't "15+
    // days from expiring", it's not part of this chart at all. Counting
    // it in the 15+d bucket (the old behavior) inflated that bucket and
    // mislabeled non-perishables as "far from expiring soon". This now
    // matches ExpiryAnalysis.tsx, which uses the same buckets and already
    // excludes items with no expiry date.
    if (days === null) return;

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