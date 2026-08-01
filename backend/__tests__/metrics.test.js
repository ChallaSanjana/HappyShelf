import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  getStockStatus,
  getExpiryStatus,
  getDaysLeft,
  isExpiredOrExpiringSoon,
  isExpired,
  calculateStats,
  getWellManagedItems,
  estimateLowStockProbability,
  calculateRefillDate,
  getSurplusAtExpiry,
  getWasteRiskRatio,
  isAtWasteRisk,
  getWasteRiskValue,
  WASTE_RISK_THRESHOLD,
  MAX_REFILL_HORIZON_DAYS,
  NO_REFILL_DATE,
  LOW_STOCK_DAYS,
  EXPIRY_WINDOW_DAYS,
  LOW_STOCK_PROBABILITY_BANDS,
  BASELINE_LOW_STOCK_PROBABILITY,
} from '../src/utils/inventoryMetrics.js';

import {
  fixtureItems,
  expectedStockStatus,
  expectedExpiryStatus,
  expectedLowStockProbability,
  expectedAtWasteRisk,
  expectedStats,
} from './helpers/fixtures.js';

const byId = (id) => fixtureItems.find((item) => item.id === id);

const daysFromNow = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

describe('getStockStatus', () => {
  for (const [id, expected] of Object.entries(expectedStockStatus)) {
    test(`${id} -> ${expected}`, () => {
      assert.equal(getStockStatus(byId(id)), expected);
    });
  }

  test('zero quantity is "out" even when nothing is being consumed', () => {
    assert.equal(getStockStatus({ quantity: 0, daily_usage: 0 }), 'out');
  });

  test('negative quantity is treated as out, not as low', () => {
    assert.equal(getStockStatus({ quantity: -5, daily_usage: 1 }), 'out');
  });

  test('min_stock_level applies even with no daily usage', () => {
    // The regression that motivated consolidating this logic: the alert
    // emails honoured min_stock_level while the dashboard stats ignored it.
    assert.equal(getStockStatus({ quantity: 3, daily_usage: 0, min_stock_level: 5 }), 'low');
  });

  test('exactly at min_stock_level counts as low', () => {
    assert.equal(getStockStatus({ quantity: 5, daily_usage: 0, min_stock_level: 5 }), 'low');
  });

  test('one above min_stock_level with ample runway is healthy', () => {
    assert.equal(getStockStatus({ quantity: 6, daily_usage: 0, min_stock_level: 5 }), 'healthy');
  });

  test(`exactly ${LOW_STOCK_DAYS} days of runway is healthy (boundary is exclusive)`, () => {
    assert.equal(getStockStatus({ quantity: 3, daily_usage: 1 }), 'healthy');
  });

  test('just under the runway threshold is low', () => {
    assert.equal(getStockStatus({ quantity: 2.9, daily_usage: 1 }), 'low');
  });

  test('null min_stock_level is ignored rather than treated as 0', () => {
    assert.equal(getStockStatus({ quantity: 100, daily_usage: 1, min_stock_level: null }), 'healthy');
  });
});

describe('estimateLowStockProbability', () => {
  for (const [id, expected] of Object.entries(expectedLowStockProbability)) {
    test(`${id} -> ${expected}`, () => {
      assert.equal(estimateLowStockProbability(byId(id)), expected);
    });
  }

  test('under 3 days of runway is near-certain', () => {
    assert.equal(estimateLowStockProbability({ quantity: 2, daily_usage: 1 }), 0.95);
  });

  test('band boundaries are exclusive', () => {
    // Exactly 3 days falls into the next band up, not the 0.95 one.
    assert.equal(estimateLowStockProbability({ quantity: 3, daily_usage: 1 }), 0.75);
    assert.equal(estimateLowStockProbability({ quantity: 7, daily_usage: 1 }), 0.45);
    assert.equal(estimateLowStockProbability({ quantity: 10, daily_usage: 1 }), 0.05);
  });

  test('an item with no usage reports the baseline', () => {
    // Infinity days of runway — it never runs out on its own.
    assert.equal(estimateLowStockProbability({ quantity: 5, daily_usage: 0 }), 0.05);
  });

  test('out of stock is near-certain', () => {
    assert.equal(estimateLowStockProbability({ quantity: 0, daily_usage: 1 }), 0.95);
  });

  test('every band is between 0 and 1', () => {
    for (const band of LOW_STOCK_PROBABILITY_BANDS) {
      assert.ok(band.probability > 0 && band.probability <= 1);
    }
    assert.ok(BASELINE_LOW_STOCK_PROBABILITY > 0 && BASELINE_LOW_STOCK_PROBABILITY <= 1);
  });
});

describe('calculateRefillDate', () => {
  const FIXED = new Date('2026-08-01T00:00:00.000Z');

  test('projects the day stock runs out', () => {
    assert.equal(calculateRefillDate(10, 1, FIXED), '2026-08-11');
  });

  test('truncates rather than rounding, matching the ML service', () => {
    // 10 / 3 = 3.33 days -> floor 3, so the refill lands on or before the
    // day stock actually runs out, never after.
    assert.equal(calculateRefillDate(10, 3, FIXED), '2026-08-04');
  });

  test('an item that is never consumed has no refill date', () => {
    assert.equal(calculateRefillDate(10, 0, FIXED), NO_REFILL_DATE);
  });

  test('out of stock refills today', () => {
    assert.equal(calculateRefillDate(0, 1, FIXED), '2026-08-01');
  });

  test('exactly at the horizon still returns a date', () => {
    const at = calculateRefillDate(MAX_REFILL_HORIZON_DAYS, 1, FIXED);
    assert.notEqual(at, NO_REFILL_DATE);
    assert.match(at, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('one day past the horizon returns the sentinel', () => {
    assert.equal(calculateRefillDate(MAX_REFILL_HORIZON_DAYS + 1, 1, FIXED), NO_REFILL_DATE);
  });

  test('an extreme ratio does not throw', () => {
    // Previously `new Date(...).toISOString()` threw RangeError here, which
    // failed the whole predictions response rather than this one item.
    assert.doesNotThrow(() => calculateRefillDate(1_000_000, 0.01, FIXED));
    assert.equal(calculateRefillDate(1_000_000, 0.01, FIXED), NO_REFILL_DATE);
    assert.equal(calculateRefillDate(1e9, 1e-6, FIXED), NO_REFILL_DATE);
  });

  test('non-finite and missing input yields the sentinel, not a crash', () => {
    assert.equal(calculateRefillDate(Infinity, 1, FIXED), NO_REFILL_DATE);
    assert.equal(calculateRefillDate(NaN, 1, FIXED), NO_REFILL_DATE);
    assert.equal(calculateRefillDate(10, NaN, FIXED), NO_REFILL_DATE);
    assert.equal(calculateRefillDate(undefined, undefined, FIXED), NO_REFILL_DATE);
  });

  test('negative quantity is clamped rather than dated in the past', () => {
    assert.equal(calculateRefillDate(-50, 1, FIXED), '2026-08-01');
  });
});

describe('waste risk (overstock relative to shelf life)', () => {
  for (const [id, expected] of Object.entries(expectedAtWasteRisk)) {
    test(`${id} -> ${expected ? 'at risk' : 'safe'}`, () => {
      assert.equal(isAtWasteRisk(byId(id)), expected);
    });
  }

  test('surplus is what cannot be consumed before the date', () => {
    // 100 units, 2/day, 10 days left -> 20 consumable, 80 surplus.
    const item = { quantity: 100, daily_usage: 2, expiry_date: daysFromNow(10) };
    assert.equal(Math.round(getSurplusAtExpiry(item)), 80);
    assert.equal(Math.round(getWasteRiskRatio(item) * 100), 80);
  });

  test('an item that will be finished in time has no surplus', () => {
    assert.equal(getSurplusAtExpiry({ quantity: 5, daily_usage: 2, expiry_date: daysFromNow(10) }), 0);
    assert.equal(isAtWasteRisk({ quantity: 5, daily_usage: 2, expiry_date: daysFromNow(10) }), false);
  });

  test('no expiry date means the question does not apply', () => {
    assert.equal(getSurplusAtExpiry({ quantity: 1000, daily_usage: 0, expiry_date: null }), 0);
    assert.equal(isAtWasteRisk({ quantity: 1000, daily_usage: 0, expiry_date: null }), false);
  });

  test('nothing consumed means all of it is at risk', () => {
    assert.equal(getSurplusAtExpiry({ quantity: 40, daily_usage: 0, expiry_date: daysFromNow(3) }), 40);
  });

  test('already expired means none of it gets used', () => {
    assert.equal(getSurplusAtExpiry({ quantity: 12, daily_usage: 5, expiry_date: daysFromNow(-2) }), 12);
  });

  test('zero quantity has nothing to waste', () => {
    assert.equal(getSurplusAtExpiry({ quantity: 0, daily_usage: 1, expiry_date: daysFromNow(1) }), 0);
    assert.equal(getWasteRiskRatio({ quantity: 0, daily_usage: 1, expiry_date: daysFromNow(1) }), 0);
  });

  test(`exactly at the ${WASTE_RISK_THRESHOLD} threshold is not flagged`, () => {
    // 100 units, 1/day, 90 days -> 10 surplus -> exactly 0.10, and the
    // comparison is strictly greater-than, so this stays safe.
    assert.equal(isAtWasteRisk(byId('healthy-1')), false);
    assert.equal(Math.round(getWasteRiskRatio(byId('healthy-1')) * 100) / 100, WASTE_RISK_THRESHOLD);
  });

  test('value is the surplus priced at cost, 0 without one', () => {
    assert.equal(getWasteRiskValue({ quantity: 40, daily_usage: 0, expiry_date: daysFromNow(3), cost_per_unit: 25 }), 1000);
    assert.equal(getWasteRiskValue({ quantity: 40, daily_usage: 0, expiry_date: daysFromNow(3), cost_per_unit: null }), 0);
  });

  test('does not change stock or expiry status', () => {
    // The overstocked item is healthy on stock and merely expiring soon on
    // date; waste risk is an additional axis, not a redefinition.
    const item = byId('overstocked-perishable');
    assert.equal(getStockStatus(item), 'healthy');
    assert.equal(getExpiryStatus(item), 'expiring_soon');
    assert.equal(isAtWasteRisk(item), true);
  });
});

describe('getDaysLeft', () => {
  test('is Infinity when nothing is consumed', () => {
    assert.equal(getDaysLeft({ quantity: 10, daily_usage: 0 }), Infinity);
  });

  test('divides quantity by usage', () => {
    assert.equal(getDaysLeft({ quantity: 10, daily_usage: 2 }), 5);
  });

  test('treats missing fields as zero rather than producing NaN', () => {
    assert.equal(getDaysLeft({}), Infinity);
  });
});

describe('expiry rules', () => {
  for (const [id, expected] of Object.entries(expectedExpiryStatus)) {
    test(`${id} -> ${expected}`, () => {
      assert.equal(getExpiryStatus(byId(id)), expected);
    });
  }

  test('already-expired items are still "expiring soon"', () => {
    // No lower bound on days is deliberate. Every early version used
    // `days >= 0 && days < window`, which hid expired stock from the exact
    // surfaces meant to catch it.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    assert.equal(isExpiredOrExpiringSoon(yesterday.toISOString()), true);
  });

  test('an item with no expiry date is never flagged', () => {
    assert.equal(isExpiredOrExpiringSoon(null), false);
    assert.equal(isExpired(null), false);
  });

  test(`an item ${EXPIRY_WINDOW_DAYS * 4} days out is not flagged`, () => {
    const future = new Date();
    future.setDate(future.getDate() + EXPIRY_WINDOW_DAYS * 4);
    assert.equal(isExpiredOrExpiringSoon(future.toISOString()), false);
  });

  test('isExpired is false for something merely expiring soon', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    assert.equal(isExpired(soon.toISOString()), false);
    assert.equal(isExpiredOrExpiringSoon(soon.toISOString()), true);
  });
});

describe('calculateStats', () => {
  const stats = calculateStats(fixtureItems);

  test('matches the shared expected stats exactly', () => {
    assert.deepEqual(stats, expectedStats);
  });

  test('lowStockItems counts both low and out-of-stock', () => {
    // Derived from the shared fixtures rather than hardcoded, so adding a
    // fixture case doesn't silently invalidate the assertion.
    assert.equal(stats.lowStockItems, expectedStats.lowStockItems);
    assert.equal(stats.outOfStockItems, expectedStats.outOfStockItems);
  });

  test('expiringSoon includes already-expired stock', () => {
    assert.equal(stats.expiringSoon, expectedStats.expiringSoon);
  });

  test('waste risk is reported alongside, not instead of, the other counts', () => {
    assert.equal(stats.wasteRiskItems, expectedStats.wasteRiskItems);
    assert.equal(stats.wasteRiskValue, expectedStats.wasteRiskValue);
  });

  test('items without a recorded cost contribute nothing to savings', () => {
    // no-cost-recorded is well-managed but has cost_per_unit null; the total
    // must not invent a price for it.
    const withoutSpices = fixtureItems.filter((i) => i.id !== 'no-cost-recorded');
    assert.equal(calculateStats(withoutSpices).predictedSavings, stats.predictedSavings);
  });

  test('a low-stock item with no expiry date is not counted as well managed', () => {
    // Regression: an early version short-circuited on "no expiry date" and
    // skipped the stock check, inflating predictedSavings by that item's
    // full value.
    const wellManaged = getWellManagedItems(fixtureItems).map((i) => i.id);
    assert.ok(!wellManaged.includes('low-by-min-stock'));
    assert.deepEqual(wellManaged.sort(), ['healthy-1', 'healthy-no-expiry', 'no-cost-recorded']);
  });

  test('handles an empty inventory without dividing by zero', () => {
    assert.deepEqual(calculateStats([]), {
      totalItems: 0,
      lowStockItems: 0,
      outOfStockItems: 0,
      expiringSoon: 0,
      wasteRiskItems: 0,
      wasteRiskValue: 0,
      categoryCounts: {},
      predictedSavings: 0,
      carbonReduced: 0,
    });
  });

  test('tolerates a null items list', () => {
    assert.equal(calculateStats(null).totalItems, 0);
  });
});
