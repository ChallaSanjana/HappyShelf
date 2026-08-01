import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  observedDailyUsageByItem,
  attachObservedUsage,
  MIN_OBSERVED_USAGE_DAYS,
} from '../src/utils/observedUsage.js';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 0, 1, 12, 0, 0);

/** One consume per day for `days` consecutive days, starting at START. */
const dailyHistory = (itemId, days, quantity = 1) =>
  Array.from({ length: days }, (_, i) => ({
    item_id: itemId,
    quantity_consumed: quantity,
    consumed_at: new Date(START + i * DAY).toISOString(),
  }));

describe('observedDailyUsageByItem', () => {
  test('averages consumption over the elapsed window', () => {
    // 10 days, 2 units each = 20 units over 10 days.
    const rates = observedDailyUsageByItem(dailyHistory('a', 10, 2));
    assert.equal(rates.get('a'), 2);
  });

  test('an item with too little history is left out entirely', () => {
    // Absent rather than 0, so getEffectiveDailyUsage falls through to the
    // typed rate instead of concluding the item is never consumed.
    const rates = observedDailyUsageByItem(dailyHistory('a', MIN_OBSERVED_USAGE_DAYS - 1));
    assert.equal(rates.has('a'), false);
  });

  test('exactly at the threshold is trusted', () => {
    const rates = observedDailyUsageByItem(dailyHistory('a', MIN_OBSERVED_USAGE_DAYS));
    assert.equal(rates.get('a'), 1);
  });

  test('days with no consumption drag the rate down, as they should', () => {
    // 8 consumes of 1 unit spread over 16 days is half a unit a day, not one.
    // Averaging only over days that had a consume would overstate the rate and
    // make everything look like it is about to run out.
    const sparse = Array.from({ length: 8 }, (_, i) => ({
      item_id: 'a',
      quantity_consumed: 1,
      consumed_at: new Date(START + i * 2 * DAY).toISOString(),
    }));
    const rates = observedDailyUsageByItem(sparse);
    assert.equal(rates.get('a'), 8 / 15);
  });

  test('several consumes in one day count as one day of observation', () => {
    const sameDay = Array.from({ length: 20 }, (_, i) => ({
      item_id: 'a',
      quantity_consumed: 1,
      consumed_at: new Date(START + i * 60 * 1000).toISOString(),
    }));
    assert.equal(observedDailyUsageByItem(sameDay).has('a'), false);
  });

  test('items are kept separate', () => {
    const rates = observedDailyUsageByItem([
      ...dailyHistory('a', 10, 2),
      ...dailyHistory('b', 10, 5),
      ...dailyHistory('c', 3, 100),
    ]);
    assert.equal(rates.get('a'), 2);
    assert.equal(rates.get('b'), 5);
    assert.equal(rates.has('c'), false);
  });

  test('malformed records are skipped rather than poisoning the average', () => {
    const rates = observedDailyUsageByItem([
      ...dailyHistory('a', 10, 2),
      { item_id: 'a', quantity_consumed: 'lots', consumed_at: new Date(START).toISOString() },
      { item_id: 'a', quantity_consumed: 5, consumed_at: 'not a date' },
      { item_id: 'a', quantity_consumed: -5, consumed_at: new Date(START).toISOString() },
      { item_id: 'a', quantity_consumed: 0, consumed_at: new Date(START).toISOString() },
      null,
    ]);
    assert.equal(rates.get('a'), 2);
  });

  test('no history at all is an empty map, not a crash', () => {
    assert.equal(observedDailyUsageByItem([]).size, 0);
    assert.equal(observedDailyUsageByItem(undefined).size, 0);
    assert.equal(observedDailyUsageByItem(null).size, 0);
  });
});

describe('attachObservedUsage', () => {
  const items = [
    { id: 'a', name: 'Rice', quantity: 10, daily_usage: 1 },
    { id: 'b', name: 'Milk', quantity: 4, daily_usage: 2 },
  ];

  test('attaches the rate only to items that have one', () => {
    const [rice, milk] = attachObservedUsage(items, new Map([['a', 3]]));
    assert.equal(rice.observed_daily_usage, 3);
    assert.equal('observed_daily_usage' in milk, false);
  });

  test('leaves the items untouched when nothing was observed', () => {
    assert.equal(attachObservedUsage(items, new Map()), items);
    assert.equal(attachObservedUsage(items, null), items);
  });

  test('matches Mongoose documents by their id, via toJSON', () => {
    const doc = {
      _id: 'a',
      toJSON() {
        return { id: 'a', name: 'Rice', quantity: 10, daily_usage: 1 };
      },
    };
    const [plain] = attachObservedUsage([doc], new Map([['a', 3]]));
    assert.equal(plain.observed_daily_usage, 3);
    assert.equal(plain.name, 'Rice');
    // Plain object, so the response body carries the extra field.
    assert.equal(typeof plain.toJSON, 'undefined');
  });

  test('does not mutate the items it was given', () => {
    const original = [{ id: 'a', quantity: 10 }];
    attachObservedUsage(original, new Map([['a', 3]]));
    assert.equal('observed_daily_usage' in original[0], false);
  });
});
