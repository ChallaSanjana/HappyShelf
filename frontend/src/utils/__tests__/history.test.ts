import { describe, test, expect } from 'vitest';
import {
  buildWeekBuckets,
  buildMonthBuckets,
  bucketRecords,
  hasAnyData,
  buildCostLookup,
  getReorderSpend,
  totalConsumed,
} from '../history';
import { makeItem } from '../../test/fixtures';
import type { ConsumptionHistoryEntry, ReorderHistoryEntry } from '../../services/api';

const daysAgo = (n: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString();
};

const monthsAgo = (n: number): string => {
  const date = new Date();
  date.setMonth(date.getMonth() - n);
  // Mid-month, so a month-length difference can't push it into a neighbour.
  date.setDate(15);
  return date.toISOString();
};

const consumed = (createdAt: string, qty: number, category = 'Dairy'): ConsumptionHistoryEntry => ({
  id: Math.random().toString(36).slice(2),
  householdId: 'h1',
  itemId: 'i1',
  itemName: 'Milk',
  category,
  quantityConsumed: qty,
  remainingQuantity: 0,
  unit: 'L',
  consumedBy: 'u1',
  createdAt,
});

const reordered = (createdAt: string, qty: number, itemId = 'i1'): ReorderHistoryEntry => ({
  id: Math.random().toString(36).slice(2),
  householdId: 'h1',
  itemId,
  itemName: 'Milk',
  category: 'Dairy',
  quantityAdded: qty,
  newQuantity: qty,
  unit: 'L',
  reorderedBy: 'u1',
  createdAt,
});

describe('buildWeekBuckets', () => {
  test('produces the requested number of buckets', () => {
    expect(buildWeekBuckets(8)).toHaveLength(8);
  });

  test('the last bucket is the current week', () => {
    const buckets = buildWeekBuckets(4);
    expect(buckets.at(-1)!.label).toBe('This week');
  });

  test('buckets run oldest to newest and do not overlap', () => {
    const buckets = buildWeekBuckets(5);
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].start.getTime()).toBe(buckets[i - 1].end.getTime());
    }
  });

  test('the current week contains now', () => {
    const current = buildWeekBuckets(3).at(-1)!;
    const now = Date.now();
    expect(now).toBeGreaterThanOrEqual(current.start.getTime());
    expect(now).toBeLessThan(current.end.getTime());
  });
});

describe('buildMonthBuckets', () => {
  test('produces the requested number of buckets', () => {
    expect(buildMonthBuckets(6)).toHaveLength(6);
  });

  test('the last bucket is the current month', () => {
    const current = buildMonthBuckets(6).at(-1)!;
    const now = new Date();
    expect(current.start.getMonth()).toBe(now.getMonth());
    expect(current.start.getFullYear()).toBe(now.getFullYear());
  });

  test('consecutive months are contiguous', () => {
    const buckets = buildMonthBuckets(4);
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].start.getTime()).toBe(buckets[i - 1].end.getTime());
    }
  });

  test('labels are month names', () => {
    for (const bucket of buildMonthBuckets(3)) {
      expect(bucket.label).toMatch(/^[A-Za-z]{3,}$/);
    }
  });
});

describe('bucketRecords', () => {
  test('sums records into the right bucket', () => {
    const buckets = bucketRecords(
      buildWeekBuckets(4),
      [consumed(daysAgo(0), 5), consumed(daysAgo(1), 3)],
      (entry) => entry.quantityConsumed
    );
    expect(buckets.at(-1)!.value).toBe(8);
  });

  test('separates records that fall in different weeks', () => {
    const buckets = bucketRecords(
      buildWeekBuckets(4),
      [consumed(daysAgo(0), 5), consumed(daysAgo(10), 7)],
      (entry) => entry.quantityConsumed
    );
    expect(buckets.at(-1)!.value).toBe(5);
    expect(buckets.reduce((sum, b) => sum + b.value, 0)).toBe(12);
  });

  test('ignores records older than the whole window', () => {
    const buckets = bucketRecords(
      buildWeekBuckets(2),
      [consumed(daysAgo(400), 99)],
      (entry) => entry.quantityConsumed
    );
    expect(hasAnyData(buckets)).toBe(false);
  });

  test('ignores unparseable timestamps rather than throwing', () => {
    const buckets = bucketRecords(
      buildWeekBuckets(2),
      [consumed('not-a-date', 5), consumed(daysAgo(0), 2)],
      (entry) => entry.quantityConsumed
    );
    expect(buckets.at(-1)!.value).toBe(2);
  });

  test('an empty record list yields all-zero buckets', () => {
    const buckets = bucketRecords(buildWeekBuckets(3), [], () => 1);
    expect(buckets.map((b) => b.value)).toEqual([0, 0, 0]);
    expect(hasAnyData(buckets)).toBe(false);
  });

  test('does not mutate the buckets it was given', () => {
    const original = buildWeekBuckets(2);
    bucketRecords(original, [consumed(daysAgo(0), 5)], (e) => e.quantityConsumed);
    expect(original.every((b) => b.value === 0)).toBe(true);
  });

  test('buckets months correctly', () => {
    const buckets = bucketRecords(
      buildMonthBuckets(4),
      [consumed(monthsAgo(0), 10), consumed(monthsAgo(2), 4)],
      (entry) => entry.quantityConsumed
    );
    expect(buckets.at(-1)!.value).toBe(10);
    expect(buckets.at(-3)!.value).toBe(4);
  });
});

describe('reorder spend', () => {
  test('values a reorder at the item current cost', () => {
    const lookup = buildCostLookup([makeItem({ id: 'i1', cost_per_unit: 50 })]);
    expect(getReorderSpend(reordered(daysAgo(0), 3), lookup)).toBe(150);
  });

  test('an item with no recorded cost contributes nothing', () => {
    // Deliberately 0, not a guessed price — the same rule the stats use.
    const lookup = buildCostLookup([makeItem({ id: 'i1', cost_per_unit: null })]);
    expect(getReorderSpend(reordered(daysAgo(0), 3), lookup)).toBe(0);
  });

  test('a reorder for a since-deleted item contributes nothing', () => {
    const lookup = buildCostLookup([makeItem({ id: 'other', cost_per_unit: 50 })]);
    expect(getReorderSpend(reordered(daysAgo(0), 3, 'i1'), lookup)).toBe(0);
  });

  test('a zero cost is respected rather than treated as missing', () => {
    const lookup = buildCostLookup([makeItem({ id: 'i1', cost_per_unit: 0 })]);
    expect(getReorderSpend(reordered(daysAgo(0), 3), lookup)).toBe(0);
    expect(lookup.get('i1')).toBe(0);
  });
});

describe('totalConsumed', () => {
  test('sums quantities', () => {
    expect(totalConsumed([consumed(daysAgo(0), 2), consumed(daysAgo(1), 3)])).toBe(5);
  });

  test('is zero for an empty log', () => {
    expect(totalConsumed([])).toBe(0);
  });
});
