import { describe, test, expect } from 'vitest';
import {
  isWasted,
  getCO2Factor,
  getItemWasteCO2,
  getConsumedCO2,
  DEFAULT_CO2_FACTOR,
} from '../sustainability';
import { makeItem } from '../../test/fixtures';
import type { ConsumptionHistoryEntry } from '../../services/api';

const daysOut = (n: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + n);
  return date.toISOString();
};

describe('isWasted', () => {
  test('out-of-stock counts as wasted', () => {
    expect(isWasted(makeItem({ quantity: 0 }))).toBe(true);
  });

  test('already expired counts as wasted even with stock left', () => {
    expect(isWasted(makeItem({ quantity: 10, expiry_date: daysOut(-1) }))).toBe(true);
  });

  test('expiring soon is NOT yet wasted', () => {
    // Still usable — it belongs in the "expiring soon" bucket, not "wasted".
    expect(isWasted(makeItem({ quantity: 10, expiry_date: daysOut(2) }))).toBe(false);
  });

  test('healthy stock is not wasted', () => {
    expect(isWasted(makeItem({ quantity: 100, expiry_date: daysOut(90) }))).toBe(false);
  });

  test('no expiry date and stock in hand is not wasted', () => {
    expect(isWasted(makeItem({ quantity: 5, expiry_date: null }))).toBe(false);
  });

  test('low stock alone is not wasted', () => {
    expect(isWasted(makeItem({ quantity: 1, daily_usage: 1 }))).toBe(false);
  });
});

describe('getCO2Factor', () => {
  test('matches a category keyword', () => {
    expect(getCO2Factor('Meat')).toBe(10.0);
    expect(getCO2Factor('Dairy')).toBe(3.0);
  });

  test('matches case-insensitively and as a substring', () => {
    expect(getCO2Factor('Fresh Produce')).toBe(1.2);
  });

  test('falls back for an unknown category', () => {
    expect(getCO2Factor('Stationery')).toBe(DEFAULT_CO2_FACTOR);
  });

  test('handles an empty or missing category', () => {
    expect(getCO2Factor('')).toBe(DEFAULT_CO2_FACTOR);
    expect(getCO2Factor(undefined as unknown as string)).toBe(DEFAULT_CO2_FACTOR);
  });
});

describe('CO2 quantities', () => {
  test('waste CO2 scales with quantity and category', () => {
    expect(getItemWasteCO2(makeItem({ quantity: 3, category: 'Meat' }))).toBe(30);
  });

  test('consumed CO2 uses the entry category', () => {
    const entry = {
      id: 'x',
      householdId: 'h',
      itemId: 'i',
      itemName: 'Cheese',
      category: 'Dairy',
      quantityConsumed: 2,
      remainingQuantity: 0,
      unit: 'kg',
      consumedBy: 'u',
      createdAt: new Date().toISOString(),
    } as ConsumptionHistoryEntry;
    expect(getConsumedCO2(entry)).toBe(6);
  });
});
