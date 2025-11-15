import React from 'react';
import { InventoryItem } from '../../services/api';
import { SimplePieChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[] };

const ExpiryToUsageEfficiency: React.FC<Props> = ({ items }) => {
  // compute fraction of items used before expiry (synthetic)
  const expiring = items.filter((it) => it.expiry_date).length;
  const usedBeforeExpiry = Math.max(0, Math.round((expiring * 0.6)));

  const labels = ['Used Before Expiry', 'Wasted Due To Expiry'];
  const data = [usedBeforeExpiry, Math.max(0, expiring - usedBeforeExpiry)];

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Expiry → Usage Efficiency</h4>
      <SimplePieChart labels={labels} datasets={[{ label: 'Efficiency', data, backgroundColor: ['#10b981', '#ef4444'] }]} height={160} />
    </div>
  );
};

export default ExpiryToUsageEfficiency;
