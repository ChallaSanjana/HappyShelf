import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';
import { isExpiredOrExpiringSoon } from '../../utils/expiry';

type Props = { items: InventoryItem[]; stats: Stats | null };

const FoodWasteTracker: React.FC<Props> = ({ items }) => {
  // "Wasted" = out of stock, or already past its expiry date (both are
  // genuine waste). The previous version only counted quantity <= 0 as
  // wasted and used a `days >= 0` guard on "expiring soon", so an
  // already-expired item with stock still on the shelf was counted as
  // neither wasted nor expiring — it landed in "Safe", which is the
  // opposite of what a food-waste tracker should say.
  const wasted = items.filter((it) => (it.quantity ?? 0) <= 0 || isExpiredOrExpiringSoon(it.expiry_date, 0)).length;
  const expiringSoon = items.filter((it) => {
    if ((it.quantity ?? 0) <= 0 || isExpiredOrExpiringSoon(it.expiry_date, 0)) return false;
    return isExpiredOrExpiringSoon(it.expiry_date, 7);
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