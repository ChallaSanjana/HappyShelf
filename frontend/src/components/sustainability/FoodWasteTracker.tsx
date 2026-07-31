import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';
import { isExpiredOrExpiringSoon } from '../../utils/expiry';
import { isWasted } from '../../utils/sustainability';

type Props = { items: InventoryItem[]; stats: Stats | null };

const FoodWasteTracker: React.FC<Props> = ({ items }) => {
  // "Wasted" (out of stock, or already past expiry) comes from
  // utils/sustainability.ts so this tracker, the CO2 chart, the
  // sustainability score and the PDF report all agree on the definition.
  const wasted = items.filter(isWasted).length;
  const expiringSoon = items.filter(
    (it) => !isWasted(it) && isExpiredOrExpiringSoon(it.expiry_date, 7)
  ).length;
  const safe = Math.max(0, items.length - wasted - expiringSoon);

  const labels = ['Wasted', 'Expiring Soon', 'Safe'];
  const data = [wasted, expiringSoon, safe];

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Food Waste Tracker</h4>
      <SimpleBarChart labels={labels} datasets={[{ label: 'Counts', data, backgroundColor: ['#ef4444', '#f59e0b', '#10b981'] }]} height={160} />
      <div className="mt-3 text-sm text-gray-600">Wasted items: {wasted} — Expiring soon: {expiringSoon}</div>
    </div>
  );
};

export default FoodWasteTracker;