/**
 * Validation for inbound item payloads, shared by POST /items and the bulk
 * import endpoint so a row rejected one way is rejected the other way too.
 *
 * Returns `{ error }` with a human-readable message, or `{ value }` with
 * fully coerced fields ready to hand to Mongoose. Never throws.
 */

export const VALID_UNITS = ['pcs', 'kg', 'g', 'L', 'ml', 'packs', 'bottles', 'boxes', 'other'];

/**
 * Coerces quantity/daily_usage. parseInt/parseFloat return NaN for
 * non-numeric input, and NaN silently passes both `=== undefined` checks and
 * Mongoose's `min: 0` validator (NaN < 0 is false), so bad input could
 * otherwise reach storage untouched.
 */
export function parseNumericFields(quantity, daily_usage) {
  const result = {};

  if (quantity !== undefined) {
    const parsedQuantity = parseInt(quantity, 10);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) return null;
    result.quantity = parsedQuantity;
  }

  if (daily_usage !== undefined) {
    const parsedDailyUsage = parseFloat(daily_usage);
    if (!Number.isFinite(parsedDailyUsage) || parsedDailyUsage < 0) return null;
    result.daily_usage = parsedDailyUsage;
  }

  return result;
}

/**
 * Validates a complete new-item payload (the create path, where every
 * required field must be present).
 */
export function validateNewItem(raw) {
  const {
    name,
    category,
    quantity,
    daily_usage,
    expiry_date,
    unit,
    purchase_date,
    min_stock_level,
    storage_location,
    cost_per_unit,
  } = raw || {};

  if (!name || !category || quantity === undefined || daily_usage === undefined || !unit) {
    return { error: 'Missing required fields' };
  }

  // Strings reach Mongoose as query/document values; anything that isn't a
  // string here is a client sending the wrong shape, not a value to coerce.
  if (typeof name !== 'string' || typeof category !== 'string') {
    return { error: 'Name and category must be text' };
  }

  const numericFields = parseNumericFields(quantity, daily_usage);
  if (!numericFields || numericFields.quantity === undefined || numericFields.daily_usage === undefined) {
    return { error: 'quantity and daily_usage must be non-negative numbers' };
  }

  if (numericFields.quantity <= 0) {
    return { error: 'Quantity must be positive' };
  }

  if (numericFields.daily_usage <= 0) {
    return { error: 'Daily usage must be positive' };
  }

  if (!VALID_UNITS.includes(unit)) {
    return { error: `Invalid unit "${unit}". Must be one of: ${VALID_UNITS.join(', ')}` };
  }

  let minStock = null;
  if (min_stock_level !== undefined && min_stock_level !== null && min_stock_level !== '') {
    minStock = parseInt(min_stock_level, 10);
    if (Number.isNaN(minStock) || minStock < 0) {
      return { error: 'Minimum stock level must be a non-negative number' };
    }
    if (minStock > numericFields.quantity) {
      return { error: 'Minimum stock level cannot exceed quantity' };
    }
  }

  let costPerUnit = null;
  if (cost_per_unit !== undefined && cost_per_unit !== null && cost_per_unit !== '') {
    costPerUnit = parseFloat(cost_per_unit);
    if (!Number.isFinite(costPerUnit) || costPerUnit < 0) {
      return { error: 'Cost per unit must be a non-negative number' };
    }
  }

  if (purchase_date) {
    const pDate = new Date(purchase_date);
    if (Number.isNaN(pDate.getTime())) {
      return { error: 'Invalid purchase date' };
    }
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (pDate > today) {
      return { error: 'Purchase date cannot be in the future' };
    }
  }

  if (expiry_date) {
    const eDate = new Date(expiry_date);
    if (Number.isNaN(eDate.getTime())) {
      return { error: 'Invalid expiry date' };
    }
    if (purchase_date) {
      const pDate = new Date(purchase_date);
      if (!Number.isNaN(pDate.getTime()) && eDate <= pDate) {
        return { error: 'Expiry date must be after purchase date' };
      }
    }
  }

  return {
    value: {
      name,
      category,
      quantity: numericFields.quantity,
      daily_usage: numericFields.daily_usage,
      expiry_date: expiry_date || null,
      unit,
      purchase_date: purchase_date || null,
      min_stock_level: minStock,
      storage_location: storage_location || null,
      cost_per_unit: costPerUnit,
    },
  };
}
