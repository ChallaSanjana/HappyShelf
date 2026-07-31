import React from 'react';
import { InventoryItem, PredictionsResponse } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';

type Props = { items: InventoryItem[]; predictions: PredictionsResponse | null };

const DemandForecast: React.FC<Props> = ({ items, predictions }) => {
  if (!items || items.length === 0) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Demand Forecast</h4>
        <div className="flex items-center justify-center h-[180px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
          No inventory items to forecast.
        </div>
      </div>
    );
  }

  // Labels are the actual next seven days, matching the window the ML
  // service forecasts (today+1 .. today+7) rather than a fixed Mon–Sun.
  const labels = Array.from({ length: 7 }, (_, i) => {
    const day = new Date();
    day.setDate(day.getDate() + i + 1);
    return day.toLocaleDateString(undefined, { weekday: 'short' });
  });

  // No predictions means no forecast. This used to fall back to
  // `base * (1 + Math.sin(i) * 0.2 + i * 0.05)` — a curve derived from how
  // many items existed, shown without any indication it wasn't a forecast.
  if (!predictions?.predictions) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Demand Forecast</h4>
        <div className="flex items-center justify-center h-[180px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500 text-center px-4">
          Forecast unavailable — the prediction service could not be reached.
        </div>
      </div>
    );
  }

  const totalForecast = [0, 0, 0, 0, 0, 0, 0];
  items.forEach((item) => {
    const itemPred = predictions.predictions[item.id];
    if (itemPred && Array.isArray(itemPred.demand_forecast)) {
      itemPred.demand_forecast.forEach((val, i) => {
        if (i < 7) totalForecast[i] += val;
      });
    }
  });

  const data = totalForecast.map((v) => Math.round(v * 10) / 10);

  // How many items were forecast from this household's own logged usage,
  // rather than from the generic training data or a flat estimate.
  const sources = predictions.model_metadata?.forecast_sources;
  const fromHistory = sources?.household_history ?? 0;

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
        <span>Demand Forecast</span>
        {renderModelBadge(predictions?.is_ml)}
      </h4>
      <SimpleLineChart labels={labels} datasets={[{ label: 'Predicted Demand', data, borderColor: '#0ea5e9' }]} height={180} />
      {fromHistory > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {fromHistory} of {items.length} item{items.length === 1 ? '' : 's'} forecast from your
          household&apos;s own consumption history.
        </p>
      )}
    </div>
  );
};

export default DemandForecast;
