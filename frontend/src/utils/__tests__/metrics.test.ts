import { describe, test, expect } from 'vitest';

import {
  getStockStatus,
  getDaysLeft,
  getEffectiveDailyUsage,
  needsRestock,
  estimateLowStockProbability,
  getSurplusAtExpiry,
  getWasteRiskRatio,
  isAtWasteRisk,
  getWasteRiskValue,
  WASTE_RISK_THRESHOLD,
  LOW_STOCK_DAYS,
  LOW_STOCK_PROBABILITY_BANDS,
  BASELINE_LOW_STOCK_PROBABILITY,
} from '../stock';
import { getDaysToExpiry, isExpired, isExpiredOrExpiringSoon, formatExpiryLabel } from '../expiry';
import { calculateMetrics, getWellManagedItems } from '../metricsCalculator';
import {
  fixtureItems,
  expectedStockStatus,
  expectedLowStockProbability,
  expectedAtWasteRisk,
  expectedStats,
  makeItem,
} from '../../test/fixtures';

const byId = (id: string) => fixtureItems.find((item) => item.id === id)!;

describe('getStockStatus — shared contract with the backend', () => {
  for (const [id, expected] of Object.entries(expectedStockStatus)) {
    test(`${id} -> ${expected}`, () => {
      expect(getStockStatus(byId(id))).toBe(expected);
    });
  }
});

describe('getStockStatus — edge cases', () => {
  test('zero quantity is out even with no usage', () => {
    expect(getStockStatus(makeItem({ quantity: 0, daily_usage: 0 }))).toBe('out');
  });

  test('negative quantity is out, not low', () => {
    expect(getStockStatus(makeItem({ quantity: -5, daily_usage: 1 }))).toBe('out');
  });

  test('min_stock_level applies even with no daily usage', () => {
    // The divergence that motivated consolidating this: the backend's alert
    // emails honoured min_stock_level while every stats surface ignored it.
    expect(getStockStatus(makeItem({ quantity: 3, daily_usage: 0, min_stock_level: 5 }))).toBe('low');
  });

  test('exactly at min_stock_level counts as low', () => {
    expect(getStockStatus(makeItem({ quantity: 5, daily_usage: 0, min_stock_level: 5 }))).toBe('low');
  });

  test(`exactly ${LOW_STOCK_DAYS} days of runway is healthy`, () => {
    expect(getStockStatus(makeItem({ quantity: 3, daily_usage: 1 }))).toBe('healthy');
  });

  test('just under the threshold is low', () => {
    expect(getStockStatus(makeItem({ quantity: 2.9, daily_usage: 1 }))).toBe('low');
  });

  test('null min_stock_level is ignored rather than treated as 0', () => {
    expect(getStockStatus(makeItem({ quantity: 100, daily_usage: 1, min_stock_level: null }))).toBe(
      'healthy'
    );
  });

  test('needsRestock covers both low and out', () => {
    expect(needsRestock(makeItem({ quantity: 0, daily_usage: 1 }))).toBe(true);
    expect(needsRestock(makeItem({ quantity: 1, daily_usage: 1 }))).toBe(true);
    expect(needsRestock(makeItem({ quantity: 100, daily_usage: 1 }))).toBe(false);
  });
});

describe('estimateLowStockProbability — shared contract with the backend', () => {
  for (const [id, expected] of Object.entries(expectedLowStockProbability)) {
    test(`${id} -> ${expected}`, () => {
      expect(estimateLowStockProbability(byId(id))).toBe(expected);
    });
  }
});

describe('estimateLowStockProbability — edge cases', () => {
  test('under 3 days of runway is near-certain', () => {
    expect(estimateLowStockProbability(makeItem({ quantity: 2, daily_usage: 1 }))).toBe(0.95);
  });

  test('band boundaries are exclusive', () => {
    // Exactly 3 days falls into the next band up, not the 0.95 one.
    expect(estimateLowStockProbability(makeItem({ quantity: 3, daily_usage: 1 }))).toBe(0.75);
    expect(estimateLowStockProbability(makeItem({ quantity: 7, daily_usage: 1 }))).toBe(0.45);
    expect(estimateLowStockProbability(makeItem({ quantity: 10, daily_usage: 1 }))).toBe(0.05);
  });

  test('an item with no usage reports the baseline', () => {
    expect(estimateLowStockProbability(makeItem({ quantity: 5, daily_usage: 0 }))).toBe(0.05);
  });

  test('out of stock is near-certain', () => {
    expect(estimateLowStockProbability(makeItem({ quantity: 0, daily_usage: 1 }))).toBe(0.95);
  });

  test('bands are ordered from least to most runway', () => {
    const days = LOW_STOCK_PROBABILITY_BANDS.map((b) => b.withinDays);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  test('every probability is between 0 and 1', () => {
    for (const band of LOW_STOCK_PROBABILITY_BANDS) {
      expect(band.probability).toBeGreaterThan(0);
      expect(band.probability).toBeLessThanOrEqual(1);
    }
    expect(BASELINE_LOW_STOCK_PROBABILITY).toBeGreaterThan(0);
  });
});

const daysFromNow = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

describe('waste risk — shared contract with the backend', () => {
  for (const [id, expected] of Object.entries(expectedAtWasteRisk)) {
    test(`${id} -> ${expected ? 'at risk' : 'safe'}`, () => {
      expect(isAtWasteRisk(byId(id))).toBe(expected);
    });
  }
});

describe('waste risk — edge cases', () => {
  test('surplus is what cannot be consumed before the date', () => {
    const item = makeItem({ quantity: 100, daily_usage: 2, expiry_date: daysFromNow(10) });
    expect(Math.round(getSurplusAtExpiry(item))).toBe(80);
    expect(Math.round(getWasteRiskRatio(item) * 100)).toBe(80);
  });

  test('an item that will be finished in time has no surplus', () => {
    const item = makeItem({ quantity: 5, daily_usage: 2, expiry_date: daysFromNow(10) });
    expect(getSurplusAtExpiry(item)).toBe(0);
    expect(isAtWasteRisk(item)).toBe(false);
  });

  test('no expiry date means the question does not apply', () => {
    const item = makeItem({ quantity: 1000, daily_usage: 0, expiry_date: null });
    expect(getSurplusAtExpiry(item)).toBe(0);
    expect(isAtWasteRisk(item)).toBe(false);
  });

  test('no usage rate makes no claim, rather than flagging everything', () => {
    // Previously this returned the whole quantity — the strongest possible
    // warning from the least possible information. Not reachable via the API
    // (itemValidation requires daily_usage > 0), but the schema allows 0 and
    // defaults to it, so imported and migrated rows still land here.
    const item = makeItem({ quantity: 40, daily_usage: 0, expiry_date: daysFromNow(3) });
    expect(getSurplusAtExpiry(item)).toBe(0);
    expect(isAtWasteRisk(item)).toBe(false);
  });

  test('but an item already past its date is still waste, rate or no rate', () => {
    const item = makeItem({ quantity: 40, daily_usage: 0, expiry_date: daysFromNow(-1) });
    expect(getSurplusAtExpiry(item)).toBe(40);
    expect(isAtWasteRisk(item)).toBe(true);
  });

  test('an observed rate is preferred over the typed one', () => {
    // Typed 10/day would consume all 40 within the 4 days remaining and look
    // fine; the household is actually observed to use 1/day, leaving 36.
    const item = makeItem({
      quantity: 40,
      daily_usage: 10,
      observed_daily_usage: 1,
      expiry_date: daysFromNow(4),
    });
    expect(getSurplusAtExpiry(item)).toBe(36);
    expect(isAtWasteRisk(item)).toBe(true);
  });

  test('already expired means none of it gets used', () => {
    expect(getSurplusAtExpiry(makeItem({ quantity: 12, daily_usage: 5, expiry_date: daysFromNow(-2) }))).toBe(12);
  });

  test('zero quantity has nothing to waste', () => {
    const item = makeItem({ quantity: 0, daily_usage: 1, expiry_date: daysFromNow(1) });
    expect(getSurplusAtExpiry(item)).toBe(0);
    expect(getWasteRiskRatio(item)).toBe(0);
  });

  test(`exactly at the ${WASTE_RISK_THRESHOLD} threshold is not flagged`, () => {
    // Strictly greater-than, so an exact 0.10 stays safe.
    expect(isAtWasteRisk(byId('healthy-1'))).toBe(false);
  });

  test('value is the surplus priced at cost, 0 without one', () => {
    // Already expired, so the whole quantity is surplus regardless of rate.
    expect(getWasteRiskValue(makeItem({ quantity: 40, daily_usage: 0, expiry_date: daysFromNow(-1), cost_per_unit: 25 }))).toBe(1000);
    expect(getWasteRiskValue(makeItem({ quantity: 40, daily_usage: 0, expiry_date: daysFromNow(-1), cost_per_unit: null }))).toBe(0);
  });

  test('does not change stock or expiry status', () => {
    const item = byId('overstocked-perishable');
    expect(getStockStatus(item)).toBe('healthy');
    expect(isAtWasteRisk(item)).toBe(true);
  });
});

describe('getDaysLeft', () => {
  test('is Infinity when nothing is consumed', () => {
    expect(getDaysLeft(makeItem({ quantity: 10, daily_usage: 0 }))).toBe(Infinity);
  });

  test('divides quantity by usage', () => {
    expect(getDaysLeft(makeItem({ quantity: 10, daily_usage: 2 }))).toBe(5);
  });

  test('divides by the observed rate when the server supplied one', () => {
    // The typed 2/day says 5 days left; the household is observed to get
    // through 5/day, so they actually have 2.
    const item = makeItem({ quantity: 10, daily_usage: 2, observed_daily_usage: 5 });
    expect(getDaysLeft(item)).toBe(2);
    expect(getStockStatus(item)).toBe('low');
  });
});

describe('getEffectiveDailyUsage', () => {
  test('prefers the observed rate', () => {
    expect(getEffectiveDailyUsage(makeItem({ daily_usage: 2, observed_daily_usage: 5 }))).toBe(5);
  });

  test('falls back to the typed rate when there is no observation', () => {
    expect(getEffectiveDailyUsage(makeItem({ daily_usage: 2 }))).toBe(2);
  });

  test('ignores an unusable observation rather than trusting it', () => {
    // A zero or negative rate would silently turn days-left into Infinity.
    expect(getEffectiveDailyUsage(makeItem({ daily_usage: 2, observed_daily_usage: 0 }))).toBe(2);
    expect(getEffectiveDailyUsage(makeItem({ daily_usage: 2, observed_daily_usage: -1 }))).toBe(2);
    expect(getEffectiveDailyUsage(makeItem({ daily_usage: 2, observed_daily_usage: NaN }))).toBe(2);
  });
});

describe('expiry rules', () => {
  const daysOut = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString();
  };

  test('already-expired stock still counts as expiring soon', () => {
    // No lower bound is deliberate: `days >= 0 && days < window` hid expired
    // stock from the exact surfaces meant to catch it.
    expect(isExpiredOrExpiringSoon(daysOut(-1))).toBe(true);
  });

  test('no expiry date is never flagged', () => {
    expect(isExpiredOrExpiringSoon(null)).toBe(false);
    expect(isExpired(null)).toBe(false);
    expect(getDaysToExpiry(null)).toBeNull();
  });

  test('far-future stock is not flagged', () => {
    expect(isExpiredOrExpiringSoon(daysOut(60))).toBe(false);
  });

  test('isExpired is false for merely expiring soon', () => {
    expect(isExpired(daysOut(2))).toBe(false);
    expect(isExpiredOrExpiringSoon(daysOut(2))).toBe(true);
  });

  test('labels read naturally in past, present and future', () => {
    expect(formatExpiryLabel(null)).toBe('N/A');
    expect(formatExpiryLabel(daysOut(-3))).toMatch(/Expired 3 days ago/);
    expect(formatExpiryLabel(daysOut(5))).toMatch(/Expires in 5 days/);
  });

  test('singular days are not pluralised', () => {
    expect(formatExpiryLabel(daysOut(1))).toBe('Expires in 1 day');
  });
});

describe('calculateMetrics — shared contract with the backend', () => {
  test('matches the shared expected stats exactly', () => {
    // If this fails while backend/__tests__/metrics.test.js still passes,
    // the two implementations have drifted apart again.
    expect(calculateMetrics(fixtureItems)).toEqual(expectedStats);
  });

  test('lowStockItems counts both low and out-of-stock', () => {
    const stats = calculateMetrics(fixtureItems);
    // Derived from the shared fixtures, so adding a fixture case doesn't
    // silently invalidate the assertion.
    expect(stats.lowStockItems).toBe(expectedStats.lowStockItems);
    expect(stats.outOfStockItems).toBe(expectedStats.outOfStockItems);
  });

  test('expiringSoon includes already-expired stock', () => {
    expect(calculateMetrics(fixtureItems).expiringSoon).toBe(expectedStats.expiringSoon);
  });

  test('waste risk is reported alongside, not instead of, the other counts', () => {
    const stats = calculateMetrics(fixtureItems);
    expect(stats.wasteRiskItems).toBe(expectedStats.wasteRiskItems);
    expect(stats.wasteRiskValue).toBe(expectedStats.wasteRiskValue);
  });

  test('a low-stock item with no expiry date is not counted as well managed', () => {
    const wellManaged = getWellManagedItems(fixtureItems).map((i) => i.id);
    expect(wellManaged).not.toContain('low-by-min-stock');
    expect(wellManaged.sort()).toEqual([
      'dated-but-untracked',
      'healthy-1',
      'healthy-no-expiry',
      'no-cost-recorded',
    ]);
  });

  test('items without a recorded cost contribute nothing to savings', () => {
    const withoutSpices = fixtureItems.filter((i) => i.id !== 'no-cost-recorded');
    expect(calculateMetrics(withoutSpices).predictedSavings).toBe(
      calculateMetrics(fixtureItems).predictedSavings
    );
  });

  test('an empty inventory produces zeroes, not NaN', () => {
    expect(calculateMetrics([])).toEqual({
      totalItems: 0,
      lowStockItems: 0,
      outOfStockItems: 0,
      expiringSoon: 0,
      wasteRiskItems: 0,
      wasteRiskValue: 0,
      categoryCounts: {},
      predictedSavings: 0,
    });
  });
});
