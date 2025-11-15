import React from 'react';
import { InventoryItem } from '../../services/api';

type Props = { items: InventoryItem[] };

const PurchaseRecommendations: React.FC<Props> = ({ items }) => {
  // Simple heuristic recommendations: low quantity and high daily usage
  const recs = items
    .map((it) => ({ ...it, score: (it.daily_usage || 0) > 0 ? (it.quantity || 0) / it.daily_usage : Infinity }))
    .filter((it) => it.score <= 7)
    .sort((a, b) => (a.score as number) - (b.score as number))
    .slice(0, 6);

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Purchase Recommendations</h4>
      {recs.length ? (
        <ul className="list-disc list-inside text-sm text-gray-700">
          {recs.map((r) => (
            <li key={r.id}>
              {r.name} — Estimated days remaining: {Math.max(0, Math.round((r.quantity || 0) / (r.daily_usage || 1)))}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-500">No immediate recommendations.</div>
      )}
    </div>
  );
};

export default PurchaseRecommendations;
