// Shared search/filter/sort/pagination logic for the inventory list.
//
// Runs against a plain array rather than a Mongo aggregation pipeline
// because getItems() already has to support two backends — real Mongo
// documents and the in-memory devInventory fallback used when the DB is
// down (see isDbConnected() in inventoryController.js) — and stock/expiry
// status are derived from quantity/daily_usage/expiry_date rather than
// stored fields, which would need fragile $cond/$divide-by-zero guards in
// an aggregation. Household-scoped arrays are small (a home's inventory,
// not a multi-tenant table), so a single indexed `find({ user_id })` plus
// in-process filtering is the efficient option here, not a shortcut.
//
// Status derivation lives in inventoryMetrics.js so this filter can't drift
// from the dashboard stats and alert emails, as it previously had.

import { getStockStatus, getExpiryStatus } from './inventoryMetrics.js';

export { getStockStatus, getExpiryStatus };

function getTotalValue(item) {
  return (item.quantity || 0) * (item.cost_per_unit || 0);
}

const SORT_FIELDS = {
  name: (item) => item.name?.toLowerCase() ?? '',
  quantity: (item) => item.quantity ?? 0,
  price: (item) => (item.cost_per_unit === null || item.cost_per_unit === undefined ? null : item.cost_per_unit),
  totalValue: (item) => getTotalValue(item),
  expiryDate: (item) => (item.expiry_date ? new Date(item.expiry_date).getTime() : null),
};

export const VALID_SORT_FIELDS = Object.keys(SORT_FIELDS);
export const VALID_STOCK_STATUSES = ['out', 'low', 'healthy'];
export const VALID_EXPIRY_STATUSES = ['expired', 'expiring_soon', 'healthy', 'none'];

/**
 * Filters, sorts, and paginates a household's items array in one pass.
 * `page`/`limit` are optional — omitting both returns every matching item
 * (still filtered/sorted), which is what callers that need the full list
 * (stats, ML predictions, the PDF report) should keep doing.
 */
export function queryInventoryItems(items, query = {}) {
  const { search, category, stockStatus, expiryStatus, sortBy = 'name', sortOrder = 'asc', page, limit } = query;

  let result = items;

  if (search && String(search).trim()) {
    const term = String(search).trim().toLowerCase();
    result = result.filter(
      (item) =>
        item.name?.toLowerCase().includes(term) ||
        item.category?.toLowerCase().includes(term) ||
        item.storage_location?.toLowerCase().includes(term)
    );
  }

  if (category) {
    result = result.filter((item) => item.category === category);
  }

  if (stockStatus && VALID_STOCK_STATUSES.includes(stockStatus)) {
    result = result.filter((item) => getStockStatus(item) === stockStatus);
  }

  if (expiryStatus && VALID_EXPIRY_STATUSES.includes(expiryStatus)) {
    result = result.filter((item) => getExpiryStatus(item) === expiryStatus);
  }

  const sortFn = SORT_FIELDS[sortBy] || SORT_FIELDS.name;
  const direction = sortOrder === 'desc' ? -1 : 1;
  result = result.slice().sort((a, b) => {
    const va = sortFn(a);
    const vb = sortFn(b);
    // Items missing the sorted-on value (no price / no expiry date) always
    // sort last, regardless of direction — flipping to desc shouldn't bury
    // priced items under a pile of "N/A"s.
    const aMissing = va === null || va === undefined;
    const bMissing = vb === null || vb === undefined;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (va < vb) return -1 * direction;
    if (va > vb) return 1 * direction;
    return 0;
  });

  const total = result.length;

  if (!page && !limit) {
    return { items: result, total, page: 1, limit: total, totalPages: 1 };
  }

  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const totalPages = Math.max(1, Math.ceil(total / limitNum));
  const pageNum = Math.min(totalPages, Math.max(1, parseInt(page, 10) || 1));
  const start = (pageNum - 1) * limitNum;

  return {
    items: result.slice(start, start + limitNum),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages,
  };
}
