import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const FoodWasteTracker: React.FC<Props> = ({ items }) => {
  // simple waste buckets based on expiry + quantity
  const wasted = items.filter((it) => it.quantity <= 0).length;
  const expiringSoon = items.filter((it) => {
    if (!it.expiry_date) return false;
    const days = Math.ceil((new Date(it.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 7;
  }).length;
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
