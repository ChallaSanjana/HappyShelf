import React from 'react';
import { InventoryItem, PredictionsResponse } from '../../services/api';

type Props = { items: InventoryItem[]; predictions: PredictionsResponse | null };

const PurchaseRecommendations: React.FC<Props> = ({ items, predictions }) => {
  const recs = items
    .map((it) => {
      const score = (it.daily_usage || 0) > 0 ? (it.quantity || 0) / it.daily_usage : Infinity;
      let mlRefillDate = 'N/A';
      if (predictions?.predictions) {
        const itemPred = predictions.predictions[it.id];
        if (itemPred && itemPred.refill_date) {
          mlRefillDate = itemPred.refill_date;
        }
      }
      return { ...it, score, mlRefillDate };
    })
    .filter((it) => it.score <= 14)
    .sort((a, b) => a.score - b.score)
    .slice(0, 6);

  const renderModelBadge = (isMl?: boolean) => {
    if (isMl) {
      return (
        <span className="text-[10px] uppercase tracking-wider font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded ml-2">
          Live ML Model
        </span>
      );
    }
    return (
      <span className="text-[10px] uppercase tracking-wider font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded ml-2">
        Heuristic Fallback
      </span>
    );
  };

  return (
    <div>
      <h4 className="text-md font-medium mb-3 flex items-center justify-between">
        <span>Purchase Recommendations</span>
        {renderModelBadge(predictions?.is_ml)}
      </h4>
      {recs.length ? (
        <ul className="space-y-2 text-sm text-gray-700">
          {recs.map((r) => (
            <li key={r.id} className="border-b border-gray-100 pb-2">
              <span className="font-medium text-gray-800">{r.name}</span>
              <div className="text-xs text-gray-500">
                Predicted Refill Date: <strong className="text-green-600">{r.mlRefillDate !== 'N/A' ? new Date(r.mlRefillDate).toLocaleDateString() : 'Immediate'}</strong>
              </div>
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
