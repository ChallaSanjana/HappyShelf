import { ConsumptionHistoryEntry, ReorderHistoryEntry, InventoryItem } from '../services/api';

/**
 * Aggregation helpers for the two real history logs.
 *
 * The analytics charts used to generate their own series from `Math.sin()`
 * and `Math.cos()` over hardcoded month labels, while genuine timestamped
 * consumption and reorder records sat unused in the database. Everything here
 * derives from those records, so a chart with no data renders an empty state
 * rather than an invented trend.
 */

export interface Bucket {
  /** Label for the x-axis, e.g. "12 May" or "May". */
  label: string;
  /** Inclusive start of the bucket. */
  start: Date;
  /** Exclusive end of the bucket. */
  end: Date;
  value: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const startOfMonth = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), 1);

/**
 * Builds `count` consecutive week buckets ending with the current week.
 * Weeks are trailing 7-day windows anchored on today, which keeps the most
 * recent bucket complete-to-now rather than partially through a calendar week.
 */
export function buildWeekBuckets(count: number, now: Date = new Date()): Bucket[] {
  const buckets: Bucket[] = [];
  const today = startOfDay(now);

  for (let i = count - 1; i >= 0; i--) {
    const end = new Date(today.getTime() + DAY_MS - i * 7 * DAY_MS);
    const start = new Date(end.getTime() - 7 * DAY_MS);
    buckets.push({
      label: i === 0 ? 'This week' : `${i}w ago`,
      start,
      end,
      value: 0,
    });
  }

  return buckets;
}

/** Builds `count` consecutive calendar-month buckets ending with this month. */
export function buildMonthBuckets(count: number, now: Date = new Date()): Bucket[] {
  const buckets: Bucket[] = [];
  const thisMonth = startOfMonth(now);

  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    buckets.push({
      label: start.toLocaleDateString(undefined, { month: 'short' }),
      start,
      end,
      value: 0,
    });
  }

  return buckets;
}

interface TimestampedRecord {
  createdAt: string;
}

/**
 * Sums `valueOf(record)` into whichever bucket each record's timestamp falls
 * in. Records outside every bucket (older than the window) are ignored.
 */
export function bucketRecords<T extends TimestampedRecord>(
  buckets: Bucket[],
  records: T[],
  valueOf: (record: T) => number
): Bucket[] {
  const filled = buckets.map((bucket) => ({ ...bucket, value: 0 }));

  for (const record of records) {
    const at = new Date(record.createdAt).getTime();
    if (!Number.isFinite(at)) continue;

    for (const bucket of filled) {
      if (at >= bucket.start.getTime() && at < bucket.end.getTime()) {
        bucket.value += valueOf(record) || 0;
        break;
      }
    }
  }

  return filled;
}

/** True when at least one bucket has data — used to pick an empty state. */
export const hasAnyData = (buckets: Bucket[]): boolean =>
  buckets.some((bucket) => bucket.value > 0);

/**
 * Looks up an item's current cost per unit by the id recorded on a history
 * entry. History rows deliberately don't store cost (it changes over time),
 * so spend is valued at today's price — an approximation, and the only one
 * available without a price history table.
 */
export function buildCostLookup(items: InventoryItem[]): Map<string, number> {
  const lookup = new Map<string, number>();
  for (const item of items) {
    if (item.cost_per_unit != null) lookup.set(String(item.id), item.cost_per_unit);
  }
  return lookup;
}

/** Spend represented by one reorder, or 0 when the item has no cost recorded. */
export const getReorderSpend = (
  entry: ReorderHistoryEntry,
  costLookup: Map<string, number>
): number => (entry.quantityAdded || 0) * (costLookup.get(String(entry.itemId)) ?? 0);

/** Total units consumed across a set of history entries. */
export const totalConsumed = (entries: ConsumptionHistoryEntry[]): number =>
  entries.reduce((sum, entry) => sum + (entry.quantityConsumed || 0), 0);
