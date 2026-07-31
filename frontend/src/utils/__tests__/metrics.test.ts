import { describe, test, expect } from 'vitest';

import {
  getStockStatus,
  getDaysLeft,
  needsRestock,
  estimateLowStockProbability,
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

describe('getDaysLeft', () => {
  test('is Infinity when nothing is consumed', () => {
    expect(getDaysLeft(makeItem({ quantity: 10, daily_usage: 0 }))).toBe(Infinity);
  });

  test('divides quantity by usage', () => {
    expect(getDaysLeft(makeItem({ quantity: 10, daily_usage: 2 }))).toBe(5);
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
    expect(stats.lowStockItems).toBe(3);
    expect(stats.outOfStockItems).toBe(1);
  });

  test('expiringSoon includes already-expired stock', () => {
    expect(calculateMetrics(fixtureItems).expiringSoon).toBe(2);
  });

  test('a low-stock item with no expiry date is not counted as well managed', () => {
    const wellManaged = getWellManagedItems(fixtureItems).map((i) => i.id);
    expect(wellManaged).not.toContain('low-by-min-stock');
    expect(wellManaged.sort()).toEqual(['healthy-1', 'healthy-no-expiry', 'no-cost-recorded']);
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
      categoryCounts: {},
      predictedSavings: 0,
      carbonReduced: 0,
    });
  });
});
