import React from 'react';
import { InventoryItem } from '../../services/api';

type Props = { items: InventoryItem[] };

const SmartRecommendations: React.FC<Props> = ({ items }) => {
  const recs = items
    .map((it) => ({ ...it, daysLeft: it.daily_usage > 0 ? Math.round((it.quantity || 0) / (it.daily_usage || 1)) : Infinity }))
    .filter((r) => r.daysLeft <= 7)
    .sort((a, b) => (a.daysLeft as number) - (b.daysLeft as number))
    .slice(0, 6);

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Action-driven Recommendations</h4>
      {recs.length ? (
        <ul className="list-disc list-inside text-sm text-gray-700">
          {recs.map((r) => (
            <li key={r.id}>
              {r.name} — {r.daysLeft} days left — <strong>Action:</strong> Consider reorder or reprioritize usage
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-500">No urgent actions recommended.</div>
      )}
    </div>
  );
};

export default SmartRecommendations;
