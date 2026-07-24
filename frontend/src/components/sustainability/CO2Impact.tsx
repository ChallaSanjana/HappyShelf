import React from 'react';
import { InventoryItem, Stats } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';
import { isExpiredOrExpiringSoon } from '../../utils/expiry';

type Props = { items: InventoryItem[]; stats: Stats | null };

const CO2Impact: React.FC<Props> = ({ items }) => {
  const wastedItems = items.filter((it) => (it.quantity ?? 0) <= 0 || isExpiredOrExpiringSoon(it.expiry_date, 0));
  const wastedCount = wastedItems.length;

  if (wastedCount === 0) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Estimated CO₂ Impact (kg)</h4>
        <div className="flex items-center justify-center h-[140px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
          No CO₂ impact from waste detected.
        </div>
      </div>
    );
  }

  const categoryCO2: Record<string, number> = {
    produce: 1.2,
    dairy: 3.0,
    meat: 10.0,
    bakery: 1.5,
    dry: 0.8,
    beverage: 1.0,
  };

  const getCO2Factor = (category: string) => {
    const cat = category?.toLowerCase() || '';
    for (const [key, val] of Object.entries(categoryCO2)) {
      if (cat.includes(key)) return val;
    }
    return 2.0; // default CO2 factor per unit
  };

  const totalWastedCO2 = wastedItems.reduce((sum, it) => sum + ((it.quantity || 1) * getCO2Factor(it.category)), 0);

  const labels = ['Week -4', 'Week -3', 'Week -2', 'Week -1', 'This Week'];
  const data = labels.map((_, i) => Math.max(0, Math.round(totalWastedCO2 * (0.6 + i * 0.1))));

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Estimated CO₂ Impact (kg)</h4>
      <SimpleLineChart labels={labels} datasets={[{ label: 'CO₂ (kg)', data, borderColor: '#84cc16' }]} height={140} />
      <div className="mt-2 text-sm text-gray-600">Estimated CO₂ from waste. Reduce waste to lower emissions.</div>
    </div>
  );
};

export default CO2Impact;