import { InventoryItem, PredictionsResponse } from '../services/api';
import { estimateLowStockProbability } from './stock';

/**
 * Headline figures for the Predictions view, derived from the ML service's
 * per-item output.
 *
 * Both tiles previously ignored `predictions` entirely: "Demand Forecast"
 * showed `stats.totalItems` (a count of items, not a forecast) and "Predicted
 * Shortages" showed `stats.lowStockItems` (what is low *now*, not what is
 * predicted to become low). The real per-item numbers were already being
 * fetched and rendered by the charts directly below them.
 */

/**
 * Probability at or above which an item is counted as a predicted shortage.
 *
 * `low_stock_probability` is the chance an item runs out within 7 days, so
 * 0.5 is "more likely than not". It sits between the shared probability
 * bands (0.45 for under 10 days of runway, 0.75 for under 7), which means an
 * item is counted exactly when it is projected to run out inside the same
 * 7-day window the forecast covers.
 */
export const SHORTAGE_PROBABILITY_THRESHOLD = 0.5;

/**
 * Total units forecast to be consumed across the household over the horizon
 * the ML service returns (7 days).
 *
 * Returns null when no forecast is available at all, so the caller can show
 * an unavailable state rather than a confident-looking zero.
 */
export const getForecastDemandUnits = (
  predictions: PredictionsResponse | null
): number | null => {
  const byItem = predictions?.predictions;
  if (!byItem) return null;

  const series = Object.values(byItem)
    .map((prediction) => prediction?.demand_forecast)
    .filter((forecast): forecast is number[] => Array.isArray(forecast));

  if (series.length === 0) return null;

  const total = series.reduce(
    (sum, forecast) =>
      sum + forecast.reduce((day, value) => day + (Number.isFinite(value) ? value : 0), 0),
    0
  );

  return Math.round(total);
};

/**
 * Items more likely than not to run out within 7 days.
 *
 * Falls back to the shared `estimateLowStockProbability` for items the ML
 * service returned nothing for — the same fallback LowStockForecast uses, so
 * the tile and the chart beneath it can't disagree about an item.
 */
export const countPredictedShortages = (
  items: InventoryItem[],
  predictions: PredictionsResponse | null
): number => {
  const byItem = predictions?.predictions;

  return (items || []).filter((item) => {
    const predicted = byItem?.[item.id]?.low_stock_probability;
    const probability =
      typeof predicted === 'number' && Number.isFinite(predicted)
        ? predicted
        : estimateLowStockProbability(item);
    return probability >= SHORTAGE_PROBABILITY_THRESHOLD;
  }).length;
};
