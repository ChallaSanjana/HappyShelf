import { describe, test, expect } from 'vitest';
import { makeItem } from '../../test/fixtures';
import { getSuggestedReorderQuantity } from '../reorder';

/**
 * Client mirror of calculateSuggestedReorderQuantity in
 * backend/src/controllers/inventoryController.js — the modal shows this
 * before the user submits, and the server recomputes it if no quantity is
 * sent, so the two must agree.
 */
describe('getSuggestedReorderQuantity', () => {
  test('tops up to a two-week buffer rather than adding one on top', () => {
    // 2/day * 14 = 28 target, 10 in stock -> add 18.
    expect(getSuggestedReorderQuantity(makeItem({ quantity: 10, daily_usage: 2 }))).toBe(18);
  });

  test('uses the observed rate, so a fortnight means a real fortnight', () => {
    // Typed 2/day suggests 18; the household actually gets through 5/day, so
    // two weeks is 70 units and they need 60. Buying 18 would have run them
    // out in under four days while the UI called it "~14 days of usage".
    const item = makeItem({ quantity: 10, daily_usage: 2, observed_daily_usage: 5 });
    expect(getSuggestedReorderQuantity(item)).toBe(60);
  });

  test('an unusable observed rate falls back to the typed one', () => {
    expect(
      getSuggestedReorderQuantity(makeItem({ quantity: 10, daily_usage: 2, observed_daily_usage: 0 }))
    ).toBe(18);
  });

  test('min_stock_level wins when it is higher than the buffer', () => {
    expect(
      getSuggestedReorderQuantity(makeItem({ quantity: 5, daily_usage: 1, min_stock_level: 50 }))
    ).toBe(45);
  });

  test('always suggests at least one unit', () => {
    expect(getSuggestedReorderQuantity(makeItem({ quantity: 1000, daily_usage: 1 }))).toBe(1);
  });
});
