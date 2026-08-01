import { describe, test, expect } from 'vitest';
import { makeItem } from '../../test/fixtures';
import { getSupplyConfidence } from '../metricsCalculator';
import {
  getForecastDemandUnits,
  countPredictedShortages,
  SHORTAGE_PROBABILITY_THRESHOLD,
} from '../predictionSummary';
import { InventoryItem, PredictionsResponse } from '../../services/api';

const healthy = (id: string) => makeItem({ id, quantity: 100, daily_usage: 1 });
const low = (id: string) => makeItem({ id, quantity: 1, daily_usage: 1 });
const out = (id: string) => makeItem({ id, quantity: 0, daily_usage: 1 });

const predictionsFor = (
  byItem: Record<string, { demand_forecast?: number[]; low_stock_probability?: number }>
): PredictionsResponse =>
  ({
    predictions: Object.fromEntries(
      Object.entries(byItem).map(([id, p]) => [
        id,
        {
          demand_forecast: p.demand_forecast ?? [],
          refill_date: '2026-08-10',
          expiry_risk: 'Low' as const,
          low_stock_probability: p.low_stock_probability ?? 0,
        },
      ])
    ),
    model_metadata: { model_confidence: 0.8, next_peak_demand_date: '2026-08-10' },
  }) as PredictionsResponse;

describe('getSupplyConfidence', () => {
  test('does not subtract out-of-stock items twice', () => {
    // The regression: the old inline formula was
    // (total - needsRestock - outOfStock) / total, and needsRestock already
    // contains every out-of-stock item. 5 of 10 items are healthy.
    const items = [
      healthy('h1'), healthy('h2'), healthy('h3'), healthy('h4'), healthy('h5'),
      low('l1'), low('l2'),
      out('o1'), out('o2'), out('o3'),
    ];
    expect(getSupplyConfidence(items)).toBe(50);
  });

  test('a majority-out inventory reports a real figure, not a clamped zero', () => {
    // Old formula: (10 - 6 - 6) / 10 = -20%, clamped to 0. Four items are
    // genuinely fine, and the user was told none of them were.
    const items = [
      healthy('h1'), healthy('h2'), healthy('h3'), healthy('h4'),
      out('o1'), out('o2'), out('o3'), out('o4'), out('o5'), out('o6'),
    ];
    expect(getSupplyConfidence(items)).toBe(40);
  });

  test('the extremes are still right', () => {
    expect(getSupplyConfidence([healthy('a'), healthy('b')])).toBe(100);
    expect(getSupplyConfidence([out('a'), low('b')])).toBe(0);
    expect(getSupplyConfidence([])).toBe(0);
  });

  test('never exceeds 100 or drops below 0', () => {
    for (const items of [[healthy('a')], [out('a')], [healthy('a'), out('b'), low('c')]]) {
      const value = getSupplyConfidence(items);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe('getForecastDemandUnits', () => {
  test('totals the ML forecast across items and days', () => {
    const predictions = predictionsFor({
      a: { demand_forecast: [1, 1, 1, 1, 1, 1, 1] },
      b: { demand_forecast: [2, 2, 2, 2, 2, 2, 2] },
    });
    expect(getForecastDemandUnits(predictions)).toBe(21);
  });

  test('is null when there is no forecast to report', () => {
    // Distinguishable from a real zero, so the tile can stay blank rather
    // than claim the household will consume nothing.
    expect(getForecastDemandUnits(null)).toBeNull();
    expect(getForecastDemandUnits(predictionsFor({}))).toBeNull();
  });

  test('ignores non-finite values rather than producing NaN', () => {
    const predictions = predictionsFor({ a: { demand_forecast: [1, NaN, 2, Infinity] } });
    expect(getForecastDemandUnits(predictions)).toBe(3);
  });
});

describe('countPredictedShortages', () => {
  const items: InventoryItem[] = [healthy('a'), healthy('b'), healthy('c')];

  test('counts items the model says are likely to run out, not items already low', () => {
    // Every item here has 100 days of runway, so a "current low stock" count
    // would report 0 -- which is what the tile used to show. The model
    // predicts two of them running out.
    const predictions = predictionsFor({
      a: { low_stock_probability: 0.95 },
      b: { low_stock_probability: 0.75 },
      c: { low_stock_probability: 0.05 },
    });
    expect(countPredictedShortages(items, predictions)).toBe(2);
  });

  test('the threshold boundary is inclusive', () => {
    const at = predictionsFor({ a: { low_stock_probability: SHORTAGE_PROBABILITY_THRESHOLD } });
    const under = predictionsFor({
      a: { low_stock_probability: SHORTAGE_PROBABILITY_THRESHOLD - 0.01 },
    });
    expect(countPredictedShortages([healthy('a')], at)).toBe(1);
    expect(countPredictedShortages([healthy('a')], under)).toBe(0);
  });

  test('falls back to the shared estimate for items the model skipped', () => {
    // 1 unit at 1/day is a day of runway -> 0.95 from the shared bands.
    expect(countPredictedShortages([low('missing')], predictionsFor({}))).toBe(1);
    expect(countPredictedShortages([healthy('missing')], predictionsFor({}))).toBe(0);
    expect(countPredictedShortages([low('missing')], null)).toBe(1);
  });

  test('the fallback respects the observed rate', () => {
    // 30 units at the typed 1/day looks like a month of runway; the household
    // is observed to use 15/day, so it runs out in two days.
    const item = makeItem({ id: 'x', quantity: 30, daily_usage: 1, observed_daily_usage: 15 });
    expect(countPredictedShortages([item], predictionsFor({}))).toBe(1);
  });
});
