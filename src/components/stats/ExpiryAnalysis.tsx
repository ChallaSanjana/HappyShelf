import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; stats: Stats | null };

const ExpiryAnalysis: React.FC<Props> = ({ items, stats }) => {
  // Build sample upcoming expiry buckets
  const buckets = ['0-3d', '4-7d', '8-14d', '15+d'];
  const counts = [
    items.filter((it) => {
      if (!it.expiry_date) return false;
      const days = Math.ceil((new Date(it.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return days >= 0 && days <= 3;
    }).length,
    items.filter((it) => {
      if (!it.expiry_date) return false;
      const days = Math.ceil((new Date(it.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return days >= 4 && days <= 7;
    }).length,
    items.filter((it) => {
      if (!it.expiry_date) return false;
      const days = Math.ceil((new Date(it.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return days >= 8 && days <= 14;
    }).length,
    items.filter((it) => !it.expiry_date || (new Date(it.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24) > 14).length,
  ];

  const data = counts.map((c) => c || 0);

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Expiry Analysis</h4>
      <SimpleBarChart labels={buckets} datasets={[{ label: 'Items', data, backgroundColor: '#F97316' }]} height={180} />
    </div>
  );
};

export default ExpiryAnalysis;
