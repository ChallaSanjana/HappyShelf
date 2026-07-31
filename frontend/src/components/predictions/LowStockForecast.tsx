import React from 'react';
import { InventoryItem, Stats, PredictionsResponse } from '../../services/api';
import { SimpleBarChart } from '../charts/SimpleChart';
import { estimateLowStockProbability } from '../../utils/stock';

type Props = { items: InventoryItem[]; stats: Stats | null; predictions: PredictionsResponse | null };

const LowStockForecast: React.FC<Props> = ({ items, predictions }) => {
  if (!items || items.length === 0) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Low Stock Forecast (7 days)</h4>
        <div className="flex items-center justify-center h-[160px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
          No inventory items to forecast.
        </div>
      </div>
    );
  }

  const sample = items.slice(0, 6);
  const labels = sample.map((s) => s.name);
  const data = sample.map((s) => {
    if (predictions?.predictions) {
      const itemPred = predictions.predictions[s.id];
      if (itemPred && itemPred.low_stock_probability !== undefined) {
        return Math.round(itemPred.low_stock_probability * 100);
      }
    }
    // No prediction for this item — fall back to the shared estimate rather
    // than a private copy of the same days-of-runway ladder.
    return Math.round(estimateLowStockProbability(s) * 100);
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
        <span>Low Stock Probability (7 days)</span>
        {renderModelBadge(predictions?.is_ml)}
      </h4>
      <SimpleBarChart labels={labels} datasets={[{ label: 'Stock Out Probability (%)', data, backgroundColor: '#f97316' }]} height={160} />
    </div>
  );
};

export default LowStockForecast;
