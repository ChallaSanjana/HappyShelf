import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InventoryItem } from '../services/api';

/**
 * Loads the repo-root metric fixtures — the same file
 * backend/__tests__/helpers/fixtures.js reads.
 *
 * These fixtures are the contract that keeps frontend/src/utils/stock.ts +
 * metricsCalculator.ts producing identical answers to
 * backend/src/utils/inventoryMetrics.js. The two implementations exist so
 * the dashboard can recompute instantly without a round trip; this file is
 * what stops them drifting, which is precisely what happened before.
 *
 * Read via fs rather than a JSON import so the path resolution is explicit
 * and identical on both sides, with no bundler involvement.
 */

interface RawFixtureItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  daily_usage: number;
  expiryOffsetDays: number | null;
  unit: string;
  min_stock_level: number | null;
  cost_per_unit: number | null;
}

interface RawFixtures {
  items: RawFixtureItem[];
  expectedStockStatus: Record<string, 'out' | 'low' | 'healthy'>;
  expectedExpiryStatus: Record<string, string>;
  expectedLowStockProbability: Record<string, number>;
  expectedStats: {
    totalItems: number;
    lowStockItems: number;
    outOfStockItems: number;
    expiringSoon: number;
    categoryCounts: Record<string, number>;
    predictedSavings: number;
    carbonReduced: number;
  };
}

const raw: RawFixtures = JSON.parse(
  readFileSync(resolve(__dirname, '../../../fixtures/inventory-metrics.json'), 'utf8')
);

/** Turns the relative expiryOffsetDays into a concrete date for "now". */
function materialize(item: RawFixtureItem): InventoryItem {
  const { expiryOffsetDays, ...rest } = item;
  let expiry_date: string | null = null;
  if (expiryOffsetDays !== null && expiryOffsetDays !== undefined) {
    const date = new Date();
    date.setDate(date.getDate() + expiryOffsetDays);
    expiry_date = date.toISOString();
  }
  return {
    ...rest,
    expiry_date,
    householdId: 'household-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as InventoryItem;
}

export const fixtureItems: InventoryItem[] = raw.items.map(materialize);
export const expectedStockStatus = raw.expectedStockStatus;
export const expectedExpiryStatus = raw.expectedExpiryStatus;
export const expectedLowStockProbability = raw.expectedLowStockProbability;
export const expectedStats = raw.expectedStats;

/** Builds a single item with sensible defaults, for one-off cases. */
export function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'item-1',
    householdId: 'household-1',
    name: 'Rice',
    category: 'Grains',
    quantity: 100,
    daily_usage: 1,
    expiry_date: null,
    unit: 'kg',
    purchase_date: null,
    min_stock_level: null,
    storage_location: null,
    cost_per_unit: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
