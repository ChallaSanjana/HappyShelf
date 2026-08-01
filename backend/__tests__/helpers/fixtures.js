import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the shared metric fixtures from the repo-root fixtures/ directory.
 *
 * Read via fs rather than a JSON import so this works identically under
 * `node --test` here and under vitest on the frontend, with no bundler or
 * import-attribute differences to reconcile.
 */
const FIXTURE_PATH = fileURLToPath(
  new URL('../../../fixtures/inventory-metrics.json', import.meta.url)
);

const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

/** Turns the relative expiryOffsetDays into a concrete date for "now". */
function materialize(item) {
  const { expiryOffsetDays, ...rest } = item;
  let expiry_date = null;
  if (expiryOffsetDays !== null && expiryOffsetDays !== undefined) {
    const date = new Date();
    date.setDate(date.getDate() + expiryOffsetDays);
    expiry_date = date.toISOString();
  }
  return { ...rest, expiry_date };
}

export const fixtureItems = raw.items.map(materialize);
export const expectedStockStatus = raw.expectedStockStatus;
export const expectedExpiryStatus = raw.expectedExpiryStatus;
export const expectedLowStockProbability = raw.expectedLowStockProbability;
export const expectedAtWasteRisk = raw.expectedAtWasteRisk;
export const expectedStats = raw.expectedStats;
