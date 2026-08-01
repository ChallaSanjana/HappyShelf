/**
 * The consumption rate a household is actually observed to have, derived
 * from the Consume events they logged.
 *
 * `daily_usage` on an item is typed once at creation and realistically never
 * revisited, yet days-left, low-stock, waste-risk and the refill date all
 * divide by it. Every consume is already recorded with a timestamp, so the
 * real rate is usually knowable — this turns that log into a number the rest
 * of the app can prefer over the guess.
 */

/**
 * Distinct days on which an item must have been consumed before its observed
 * rate is trusted.
 *
 * Deliberately the same threshold the ML service uses to decide whether an
 * item has enough history to fit a demand model (MIN_HISTORY_POINTS in
 * ml_service/main.py). Below it, one unusual week would move a low-stock
 * alert; the typed figure is the safer answer.
 */
export const MIN_OBSERVED_USAGE_DAYS = 8;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Calendar day key, so several consumes on one afternoon count once. */
function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Map of itemId -> observed units/day, containing only items with enough
 * distinct days of history to be worth trusting.
 *
 * The rate is total quantity over the *elapsed* window (first consume to
 * last, inclusive), not over the number of days that had a consume — days
 * with no consumption are real evidence of a slower rate, and ignoring them
 * would systematically overstate usage.
 */
export function observedDailyUsageByItem(history) {
  const byItem = new Map();

  for (const record of history || []) {
    const at = new Date(record?.consumed_at).getTime();
    const quantity = Number(record?.quantity_consumed);
    if (!Number.isFinite(at) || !Number.isFinite(quantity) || quantity <= 0) continue;

    const key = String(record.item_id);
    const entry = byItem.get(key) || { total: 0, days: new Set(), earliest: at, latest: at };
    entry.total += quantity;
    entry.days.add(dayKey(at));
    entry.earliest = Math.min(entry.earliest, at);
    entry.latest = Math.max(entry.latest, at);
    byItem.set(key, entry);
  }

  const rates = new Map();
  for (const [key, { total, days, earliest, latest }] of byItem) {
    if (days.size < MIN_OBSERVED_USAGE_DAYS) continue;

    // Inclusive span: consuming on the 1st and the 8th is 8 days of
    // observation, not 7. Floored at 1 so a same-day window can't divide by 0.
    const spanDays = Math.max(1, Math.round((latest - earliest) / MS_PER_DAY) + 1);
    const rate = total / spanDays;
    if (Number.isFinite(rate) && rate > 0) rates.set(key, rate);
  }

  return rates;
}

/**
 * Returns the items with `observed_daily_usage` attached where it is known.
 *
 * Absent rather than null when unknown, so getEffectiveDailyUsage falls
 * straight through to the typed figure.
 */
export function attachObservedUsage(items, rates) {
  if (!rates || rates.size === 0) return items;

  return items.map((item) => {
    const plain = typeof item.toJSON === 'function' ? item.toJSON() : { ...item };
    const observed = rates.get(String(plain.id ?? item.id ?? item._id));
    if (observed === undefined) return plain;
    return { ...plain, observed_daily_usage: observed };
  });
}
