import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';
import { getDaysToExpiry } from '../../utils/expiry';

type Props = { items: InventoryItem[]; stats: Stats | null };

const ExpiryAnalysis: React.FC<Props> = ({ items }) => {
  // Bucket every item with an expiry date into exactly one bucket.
  // The previous version used `days >= 0` guards on the first three
  // buckets and `days > 14` on the last, which meant an already-expired
  // item (negative days) matched none of the buckets and simply vanished
  // from the chart instead of being counted anywhere.
  const buckets = ['Expired', '0-3d', '4-7d', '8-14d', '15+d'];
  const counts = [0, 0, 0, 0, 0];

  items.forEach((it) => {
    const days = getDaysToExpiry(it.expiry_date);
    if (days === null) return; // no expiry date set — not part of this chart
    if (days < 0) counts[0] += 1;
    else if (days <= 3) counts[1] += 1;
    else if (days <= 7) counts[2] += 1;
    else if (days <= 14) counts[3] += 1;
    else counts[4] += 1;
  });

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Expiry Analysis</h4>
      <SimpleBarChart labels={buckets} datasets={[{ label: 'Items', data: counts, backgroundColor: '#F97316' }]} height={180} />
    </div>
  );
};

export default ExpiryAnalysis;