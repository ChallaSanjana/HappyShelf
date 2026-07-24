import React from 'react';
import { InventoryItem, Stats, PredictionsResponse } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';
import { getDaysToExpiry } from '../../utils/expiry';

type Props = { items: InventoryItem[]; stats: Stats | null; predictions: PredictionsResponse | null };

const ExpiryForecast: React.FC<Props> = ({ items, predictions }) => {
  const buckets = ['High Risk', 'Medium Risk', 'Low Risk'];
  const counts = [0, 0, 0];

  items.forEach((it) => {
    if (!it.expiry_date) return;

    if (predictions?.predictions) {
      const itemPred = predictions.predictions[it.id];
      if (itemPred) {
        if (itemPred.expiry_risk === 'High') counts[0] += 1;
        else if (itemPred.expiry_risk === 'Medium') counts[1] += 1;
        else counts[2] += 1;
      }
    } else {
      const days = getDaysToExpiry(it.expiry_date);
      if (days === null) return;
      if (days < 3) counts[0] += 1;
      else if (days < 10) counts[1] += 1;
      else counts[2] += 1;
    }
  });

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
        <span>ML Expiry Risk Forecast</span>
        {renderModelBadge(predictions?.is_ml)}
      </h4>
      <SimpleBarChart labels={buckets} datasets={[{ label: 'Risk Count', data: counts, backgroundColor: '#ef4444' }]} height={140} />
    </div>
  );
};

export default ExpiryForecast;