import mongoose from 'mongoose';
import Item from '../models/Item.js';
import ReorderHistory from '../models/ReorderHistory.js';
import ConsumptionHistory from '../models/ConsumptionHistory.js';
import { queryInventoryItems } from '../utils/inventoryQuery.js';
import { buildDevHistoryBase } from '../utils/historyJson.js';

// In-memory storage fallback for development when MongoDB is unavailable.
// Exported so other controllers (actionPlanController) that need to read
// the current household's items in dev mode share this same store instead
// of maintaining a separate, out-of-sync copy.
export const devInventory = new Map(); // userId -> items[]
let nextItemId = 1;

// In-memory reorder history, mirroring the devInventory pattern above.
// Keyed by householdId -> history entries[], newest first.
const devReorderHistory = new Map();
let nextHistoryId = 1;

// In-memory consumption history, same pattern as devReorderHistory above.
const devConsumptionHistory = new Map();
let nextConsumptionHistoryId = 1;

export function getUserItems(userId) {
  if (!devInventory.has(userId)) {
    devInventory.set(userId, []);
  }
  return devInventory.get(userId);
}

function getHouseholdHistory(householdId) {
  if (!devReorderHistory.has(householdId)) {
    devReorderHistory.set(householdId, []);
  }
  return devReorderHistory.get(householdId);
}

function getHouseholdConsumptionHistory(householdId) {
  if (!devConsumptionHistory.has(householdId)) {
    devConsumptionHistory.set(householdId, []);
  }
  return devConsumptionHistory.get(householdId);
}

// readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
// Only treat the DB as usable when it's fully connected (state 1). Anything
// else (including "connecting") falls back to in-memory storage instead of
// letting Mongoose silently buffer/queue the query.
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

// A user who registered/logged in while the DB was down gets a token with a
// synthetic id like "dev_1", which is not a valid Mongo ObjectId. If the DB
// comes back up during that token's 7-day lifetime, any query built from
// req.user.userId would throw a Mongoose CastError (surfacing as an opaque
// 500). Catch that case up front and return a clear, actionable error
// instead, telling the user to log in again now that the DB is available.
function isDevModeUserId(userId) {
  return typeof userId === 'string' && userId.startsWith('dev_');
}

// req.params.id is a raw URL segment — if it isn't a valid 24-char hex
// ObjectId, Mongoose throws a CastError when it's used in a query filter.
// That was previously falling through to the generic catch block and coming
// back as a 500, when it's really a client input error (400).
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}


function rejectStaleDevSession(req, res) {
  if (isDbConnected() && isDevModeUserId(req.user.userId)) {
    res.status(409).json({
      error: 'Your session was created while offline. Please log in again.',
    });
    return true;
  }
  return false;
}

// Validates and coerces quantity/daily_usage. parseInt/parseFloat return NaN
// for non-numeric input, and NaN silently passes both `=== undefined` checks
// and Mongoose's `min: 0` validator (NaN < 0 is false), so bad input could
// otherwise reach storage untouched. Returns { quantity, daily_usage } on
// success, or null if either provided value isn't a finite number.
function parseNumericFields(quantity, daily_usage) {
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

export const getItems = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    let items;
    if (!isDbConnected()) {
      items = getUserItems(req.user.householdId).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else {
      items = await Item.find({ user_id: req.user.householdId }).sort({ createdAt: -1 });
    }

    // Only the Inventory page's search/filter/sort/pagination toolbar sends
    // these; every other caller (stats, ML predictions, the PDF report)
    // calls this endpoint with no query params and must keep getting the
    // full, unpaginated list exactly as before.
    const { search, category, stockStatus, expiryStatus, sortBy, sortOrder, page, limit } = req.query;
    const hasQuery = search || category || stockStatus || expiryStatus || sortBy || sortOrder || page || limit;
    if (!hasQuery) {
      return res.json({ items });
    }

    const result = queryInventoryItems(items, req.query);
    res.json(result);
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
};

export const createItem = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    const { name, category, quantity, daily_usage, expiry_date, unit, purchase_date, min_stock_level, storage_location, cost_per_unit } = req.body;

    if (!name || !category || quantity === undefined || daily_usage === undefined || !unit) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const numericFields = parseNumericFields(quantity, daily_usage);
    if (!numericFields || numericFields.quantity === undefined || numericFields.daily_usage === undefined) {
      return res.status(400).json({ error: 'quantity and daily_usage must be non-negative numbers' });
    }

    if (numericFields.quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be positive' });
    }

    if (numericFields.daily_usage <= 0) {
      return res.status(400).json({ error: 'Daily usage must be positive' });
    }

    const validUnits = ['pcs', 'kg', 'g', 'L', 'ml', 'packs', 'bottles', 'boxes', 'other'];
    if (!validUnits.includes(unit)) {
      return res.status(400).json({ error: 'Invalid unit value' });
    }

    let minStock = null;
    if (min_stock_level !== undefined && min_stock_level !== null && min_stock_level !== '') {
      minStock = parseInt(min_stock_level, 10);
      if (Number.isNaN(minStock) || minStock < 0) {
        return res.status(400).json({ error: 'Minimum stock level must be a non-negative number' });
      }
      if (minStock > numericFields.quantity) {
        return res.status(400).json({ error: 'Minimum stock level cannot exceed quantity' });
      }
    }

    let costPerUnit = null;
    if (cost_per_unit !== undefined && cost_per_unit !== null && cost_per_unit !== '') {
      costPerUnit = parseFloat(cost_per_unit);
      if (!Number.isFinite(costPerUnit) || costPerUnit < 0) {
        return res.status(400).json({ error: 'Cost per unit must be a non-negative number' });
      }
    }

    if (purchase_date) {
      const pDate = new Date(purchase_date);
      if (Number.isNaN(pDate.getTime())) {
        return res.status(400).json({ error: 'Invalid purchase date' });
      }
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (pDate > today) {
        return res.status(400).json({ error: 'Purchase date cannot be in the future' });
      }
    }

    if (expiry_date && purchase_date) {
      const eDate = new Date(expiry_date);
      const pDate = new Date(purchase_date);
      if (!Number.isNaN(eDate.getTime()) && !Number.isNaN(pDate.getTime())) {
        if (eDate <= pDate) {
          return res.status(400).json({ error: 'Expiry date must be after purchase date' });
        }
      }
    }

    if (!isDbConnected()) {
      const items = getUserItems(req.user.householdId);
      const newItem = {
        id: `dev_${nextItemId++}`,
        user_id: req.user.householdId,
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      items.push(newItem);
      console.log(`✓ Item created (in-memory): ${name}`);
      return res.status(201).json({ message: 'Item created successfully (dev mode)', item: newItem });
    }

    const newItem = await Item.create({
      user_id: req.user.householdId,
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
    });

    res.status(201).json({ message: 'Item created successfully', item: newItem });
  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({ error: 'Failed to create item' });
  }
};

export const updateItem = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    const { id } = req.params;
    const { name, category, quantity, daily_usage, expiry_date, unit, purchase_date, min_stock_level, storage_location, cost_per_unit } = req.body;

    if (isDbConnected() && !isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid item id' });
    }

    const numericFields = parseNumericFields(quantity, daily_usage);
    if (!numericFields) {
      return res.status(400).json({ error: 'quantity and daily_usage must be non-negative numbers' });
    }

    // Unlike createItem, quantity may be updated down to 0 (parseNumericFields
    // already rejects negative values) — an existing item legitimately runs
    // out over time. Consuming to exactly 0 goes through the dedicated
    // consumeItem endpoint, but a direct PUT to 0 is allowed too since it's
    // just as valid a way to record "I have none of this left."

    if (numericFields.daily_usage !== undefined && numericFields.daily_usage <= 0) {
      return res.status(400).json({ error: 'Daily usage must be positive' });
    }

    const validUnits = ['pcs', 'kg', 'g', 'L', 'ml', 'packs', 'bottles', 'boxes', 'other'];
    if (unit !== undefined && !validUnits.includes(unit)) {
      return res.status(400).json({ error: 'Invalid unit value' });
    }

    let targetQuantity = numericFields.quantity;

    let minStock = undefined;
    if (min_stock_level !== undefined) {
      if (min_stock_level === null || min_stock_level === '') {
        minStock = null;
      } else {
        minStock = parseInt(min_stock_level, 10);
        if (Number.isNaN(minStock) || minStock < 0) {
          return res.status(400).json({ error: 'Minimum stock level must be a non-negative number' });
        }
      }
    }

    // Backfill whichever of quantity/min_stock_level wasn't part of this
    // request, so the min_stock_level <= quantity invariant (enforced on
    // create) is still checked when a caller patches just one of the two —
    // e.g. lowering quantity below an existing, untouched min_stock_level.
    if (targetQuantity === undefined || minStock === undefined) {
      let existingItem = null;
      if (!isDbConnected()) {
        const items = getUserItems(req.user.householdId);
        existingItem = items.find(it => it.id === id);
      } else {
        existingItem = await Item.findOne({ _id: id, user_id: req.user.householdId });
      }
      if (existingItem) {
        if (targetQuantity === undefined) targetQuantity = existingItem.quantity;
        if (minStock === undefined) minStock = existingItem.min_stock_level;
      }
    }

    if (minStock !== null && minStock !== undefined && targetQuantity !== undefined && minStock > targetQuantity) {
      return res.status(400).json({ error: 'Minimum stock level cannot exceed quantity' });
    }

    let costPerUnit = undefined;
    if (cost_per_unit !== undefined) {
      if (cost_per_unit === null || cost_per_unit === '') {
        costPerUnit = null;
      } else {
        costPerUnit = parseFloat(cost_per_unit);
        if (!Number.isFinite(costPerUnit) || costPerUnit < 0) {
          return res.status(400).json({ error: 'Cost per unit must be a non-negative number' });
        }
      }
    }

    let targetPurchaseDate = purchase_date;
    if (purchase_date !== undefined) {
      if (purchase_date === null || purchase_date === '') {
        targetPurchaseDate = null;
      } else {
        const pDate = new Date(purchase_date);
        if (Number.isNaN(pDate.getTime())) {
          return res.status(400).json({ error: 'Invalid purchase date' });
        }
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        if (pDate > today) {
          return res.status(400).json({ error: 'Purchase date cannot be in the future' });
        }
        targetPurchaseDate = pDate;
      }
    }

    let targetExpiryDate = expiry_date;
    if (expiry_date !== undefined) {
      if (expiry_date === null || expiry_date === '') {
        targetExpiryDate = null;
      } else {
        const eDate = new Date(expiry_date);
        if (Number.isNaN(eDate.getTime())) {
          return res.status(400).json({ error: 'Invalid expiry date' });
        }
        targetExpiryDate = eDate;
      }
    }

    let pDateVal = targetPurchaseDate;
    let eDateVal = targetExpiryDate;
    if (pDateVal === undefined || eDateVal === undefined) {
      let existingItem = null;
      if (!isDbConnected()) {
        const items = getUserItems(req.user.householdId);
        existingItem = items.find(it => it.id === id);
      } else {
        existingItem = await Item.findOne({ _id: id, user_id: req.user.householdId });
      }

      if (existingItem) {
        if (pDateVal === undefined) pDateVal = existingItem.purchase_date;
        if (eDateVal === undefined) eDateVal = existingItem.expiry_date;
      }
    }

    // Only re-validate the purchase/expiry relationship when THIS request is
    // actually touching one of those two fields. Without this guard, a
    // request that only renames an item (say) would backfill both dates from
    // whatever's already stored and re-reject them if they'd become
    // out-of-order for any other reason (e.g. reorderItem advancing
    // purchase_date past a stale expiry_date) — trapping the item so no
    // unrelated field can ever be edited again without also fixing dates the
    // caller never asked to change.
    if ((purchase_date !== undefined || expiry_date !== undefined) && pDateVal && eDateVal) {
      const pD = new Date(pDateVal);
      const eD = new Date(eDateVal);
      if (!Number.isNaN(pD.getTime()) && !Number.isNaN(eD.getTime())) {
        if (eD <= pD) {
          return res.status(400).json({ error: 'Expiry date must be after purchase date' });
        }
      }
    }

    if (!isDbConnected()) {
      const items = getUserItems(req.user.householdId);
      const item = items.find(it => it.id === id);
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }
      if (name !== undefined) item.name = name;
      if (category !== undefined) item.category = category;
      if (numericFields.quantity !== undefined) item.quantity = numericFields.quantity;
      if (numericFields.daily_usage !== undefined) item.daily_usage = numericFields.daily_usage;
      if (expiry_date !== undefined) item.expiry_date = expiry_date || null;
      if (unit !== undefined) item.unit = unit;
      if (purchase_date !== undefined) item.purchase_date = purchase_date || null;
      if (min_stock_level !== undefined) item.min_stock_level = minStock;
      if (storage_location !== undefined) item.storage_location = storage_location || null;
      if (cost_per_unit !== undefined) item.cost_per_unit = costPerUnit;
      item.updated_at = new Date().toISOString();
      return res.json({ message: 'Item updated successfully (dev mode)', item });
    }

    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (numericFields.quantity !== undefined) updateData.quantity = numericFields.quantity;
    if (numericFields.daily_usage !== undefined) updateData.daily_usage = numericFields.daily_usage;
    if (expiry_date !== undefined) updateData.expiry_date = expiry_date || null;
    if (unit !== undefined) updateData.unit = unit;
    if (purchase_date !== undefined) updateData.purchase_date = purchase_date || null;
    if (min_stock_level !== undefined) updateData.min_stock_level = minStock;
    if (storage_location !== undefined) updateData.storage_location = storage_location || null;
    if (cost_per_unit !== undefined) updateData.cost_per_unit = costPerUnit;

    const updatedItem = await Item.findOneAndUpdate(
      { _id: id, user_id: req.user.householdId },
      updateData,
      { new: true }
    );

    if (!updatedItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ message: 'Item updated successfully', item: updatedItem });
  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({ error: 'Failed to update item' });
  }
};

// Default suggested reorder quantity: enough to bring the item UP TO a
// two-week-usage buffer (or its configured min_stock_level, if higher) —
// not a flat top-up added on top of whatever's already in stock. Without
// subtracting current quantity, an item sitting well above its target level
// would still suggest adding a full extra buffer on every reorder click.
// Floored at 1 so there's always a positive default to show/submit even
// when the item is already at or above target. This is only a *default* —
// the frontend shows it in a preview/edit modal before submitting, and
// reorderItem below accepts an explicit override.
function calculateSuggestedReorderQuantity(item) {
  const twoWeekBuffer = Math.ceil((item.daily_usage || 0) * 14);
  const minStock = item.min_stock_level || 0;
  const targetLevel = Math.max(minStock, twoWeekBuffer, 1);
  const currentQuantity = item.quantity || 0;
  return Math.max(targetLevel - currentQuantity, 1);
}

export const reorderItem = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    const { id } = req.params;
    const { quantity } = req.body;

    if (isDbConnected() && !isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid item id' });
    }

    // Optional client-supplied override from the reorder preview/edit modal.
    // If omitted or invalid, falls back to the server-calculated default so
    // the endpoint still works for any caller that doesn't send a quantity.
    let requestedQty = undefined;
    if (quantity !== undefined && quantity !== null && quantity !== '') {
      const parsed = parseInt(quantity, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res.status(400).json({ error: 'Reorder quantity must be a positive number' });
      }
      requestedQty = parsed;
    }

    const today = new Date().toISOString().split('T')[0];

    if (!isDbConnected()) {
      const items = getUserItems(req.user.householdId);
      const item = items.find((it) => it.id === id);
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }
      const reorderQty = requestedQty !== undefined ? requestedQty : calculateSuggestedReorderQuantity(item);
      item.quantity = item.quantity + reorderQty;
      // Advancing purchase_date to today would otherwise leave a stale
      // expiry_date from before the restock in place, violating the
      // "expiry must be after purchase" invariant enforced everywhere else
      // — that old expiry no longer describes the stock on hand anyway.
      if (item.expiry_date && new Date(item.expiry_date) <= new Date(today)) {
        item.expiry_date = null;
      }
      item.purchase_date = today;
      item.updated_at = new Date().toISOString();

      const historyEntry = {
        ...buildDevHistoryBase(`dev_hist_${nextHistoryId++}`, req.user.householdId, item),
        quantityAdded: reorderQty,
        newQuantity: item.quantity,
        reorderedBy: req.user.userId,
      };
      getHouseholdHistory(req.user.householdId).unshift(historyEntry);

      return res.json({
        message: 'Item reordered successfully (dev mode)',
        item,
        history: historyEntry,
      });
    }

    const existingItem = await Item.findOne({ _id: id, user_id: req.user.householdId });
    if (!existingItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const reorderQty = requestedQty !== undefined ? requestedQty : calculateSuggestedReorderQuantity(existingItem);

    // Advancing purchase_date to today would otherwise leave a stale
    // expiry_date from before the restock in place, violating the "expiry
    // must be after purchase" invariant enforced everywhere else — that old
    // expiry no longer describes the stock on hand anyway. Clear it rather
    // than leaving the item in a state where every future edit (even ones
    // that never touch a date field) gets rejected by that invariant.
    const setFields = { purchase_date: today };
    if (existingItem.expiry_date && new Date(existingItem.expiry_date) <= new Date(today)) {
      setFields.expiry_date = null;
    }

    // $inc is applied atomically by MongoDB, so two concurrent reorders on
    // the same item both land instead of one clobbering the other's read of
    // `quantity` (which a read-then-write like `existingItem.quantity + reorderQty`
    // would silently lose under a race).
    const updatedItem = await Item.findOneAndUpdate(
      { _id: id, user_id: req.user.householdId },
      { $inc: { quantity: reorderQty }, $set: setFields },
      { new: true }
    );

    const historyEntry = await ReorderHistory.create({
      household_id: req.user.householdId,
      item_id: updatedItem._id.toString(),
      item_name: updatedItem.name,
      category: updatedItem.category,
      quantity_added: reorderQty,
      new_quantity: updatedItem.quantity,
      unit: updatedItem.unit,
      reordered_by: req.user.userId,
    });

    res.json({
      message: 'Item reordered successfully',
      item: updatedItem,
      history: historyEntry,
    });
  } catch (error) {
    console.error('Reorder item error:', error);
    res.status(500).json({ error: 'Failed to reorder item' });
  }
};

// Decreases an item's quantity by a user-specified amount (e.g. "I used 2 of
// these"). Unlike updateItem's generic PUT, this never lets quantity go
// negative and rejects consuming more than is actually in stock — it's the
// intended path for an item to legitimately reach 0 and become "Out of
// Stock", which the rest of the app (alerts, badges, ML predictions) already
// knows how to handle once quantity gets there.
export const consumeItem = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    const { id } = req.params;
    const { quantity } = req.body;

    if (isDbConnected() && !isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid item id' });
    }

    const consumeQty = parseInt(quantity, 10);
    if (!Number.isFinite(consumeQty) || consumeQty <= 0) {
      return res.status(400).json({ error: 'Consume quantity must be a positive number' });
    }

    if (!isDbConnected()) {
      const items = getUserItems(req.user.householdId);
      const item = items.find((it) => it.id === id);
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }
      if (consumeQty > item.quantity) {
        return res.status(400).json({
          error: `Cannot consume ${consumeQty} ${item.unit} — only ${item.quantity} ${item.unit} in stock`,
        });
      }
      item.quantity = item.quantity - consumeQty;
      item.updated_at = new Date().toISOString();

      const historyEntry = {
        ...buildDevHistoryBase(`dev_consume_${nextConsumptionHistoryId++}`, req.user.householdId, item),
        quantityConsumed: consumeQty,
        remainingQuantity: item.quantity,
        consumedBy: req.user.userId,
      };
      getHouseholdConsumptionHistory(req.user.householdId).unshift(historyEntry);

      return res.json({
        message: 'Item consumed successfully (dev mode)',
        item,
        history: historyEntry,
      });
    }

    // The `quantity: { $gte: consumeQty }` filter makes this atomic against
    // concurrent consumes the same way reorder's $inc is atomic against
    // concurrent reorders — two overlapping requests can't both read "5 in
    // stock" and independently decide a consume of 4 is safe, landing at -3.
    // Whichever request's decrement would take stock below 0 simply doesn't
    // match the filter and returns null instead of writing a negative value.
    const updatedItem = await Item.findOneAndUpdate(
      { _id: id, user_id: req.user.householdId, quantity: { $gte: consumeQty } },
      { $inc: { quantity: -consumeQty } },
      { new: true }
    );

    if (!updatedItem) {
      const existingItem = await Item.findOne({ _id: id, user_id: req.user.householdId });
      if (!existingItem) {
        return res.status(404).json({ error: 'Item not found' });
      }
      return res.status(400).json({
        error: `Cannot consume ${consumeQty} ${existingItem.unit} — only ${existingItem.quantity} ${existingItem.unit} in stock`,
      });
    }

    const historyEntry = await ConsumptionHistory.create({
      household_id: req.user.householdId,
      item_id: updatedItem._id.toString(),
      item_name: updatedItem.name,
      category: updatedItem.category,
      quantity_consumed: consumeQty,
      remaining_quantity: updatedItem.quantity,
      unit: updatedItem.unit,
      consumed_by: req.user.userId,
    });

    res.json({
      message: 'Item consumed successfully',
      item: updatedItem,
      history: historyEntry,
    });
  } catch (error) {
    console.error('Consume item error:', error);
    res.status(500).json({ error: 'Failed to consume item' });
  }
};

export const getConsumptionHistory = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    const householdId = req.user.householdId;

    if (!isDbConnected()) {
      const history = getHouseholdConsumptionHistory(householdId).slice(0, 50);
      return res.json({ history });
    }

    const history = await ConsumptionHistory.find({ household_id: householdId })
      .sort({ created_at: -1 })
      .limit(50);

    res.json({ history });
  } catch (error) {
    console.error('Get consumption history error:', error);
    res.status(500).json({ error: 'Failed to fetch consumption history' });
  }
};

export const getReorderHistory = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    const householdId = req.user.householdId;

    if (!isDbConnected()) {
      const history = getHouseholdHistory(householdId).slice(0, 50);
      return res.json({ history });
    }

    const history = await ReorderHistory.find({ household_id: householdId })
      .sort({ created_at: -1 })
      .limit(50);

    res.json({ history });
  } catch (error) {
    console.error('Get reorder history error:', error);
    res.status(500).json({ error: 'Failed to fetch reorder history' });
  }
};

export const deleteItem = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    const { id } = req.params;

    if (isDbConnected() && !isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid item id' });
    }

    if (!isDbConnected()) {
      const items = getUserItems(req.user.householdId);
      const index = items.findIndex(it => it.id === id);
      if (index === -1) {
        return res.status(404).json({ error: 'Item not found' });
      }
      items.splice(index, 1);
      return res.json({ message: 'Item deleted successfully (dev mode)' });
    }

    const deletedItem = await Item.findOneAndDelete({
      _id: id,
      user_id: req.user.householdId,
    });

    if (!deletedItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
};

export const getStats = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    let items;
    if (!isDbConnected()) {
      items = getUserItems(req.user.householdId);
    } else {
      items = await Item.find({ user_id: req.user.householdId });
    }

    const totalItems = items.length;

    const lowStockItems = items.filter((item) => {
      const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
      return daysLeft < 3;
    }).length;

    // `>= 0` here would silently drop already-expired items from the count —
    // exactly the bug frontend/src/utils/metricsCalculator.ts documents fixing
    // via isExpiredOrExpiringSoon (no lower bound on days). This endpoint
    // never got that fix even though it computes the same "expiringSoon" stat,
    // so an expired-but-still-in-stock item silently vanished from it here
    // while correctly showing up everywhere the frontend derives its own stats.
    const isExpiredOrExpiringSoon = (item, windowDays = 7) => {
      if (!item.expiry_date) return false;
      const daysToExpiry = Math.ceil((new Date(item.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
      return daysToExpiry < windowDays;
    };

    const expiringSoon = items.filter((item) => isExpiredOrExpiringSoon(item, 7)).length;

    const categoryCounts = items.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {});

    // The `if (!item.expiry_date) return true` early-return below used to skip
    // the daysLeft check entirely for items with no expiry date, so a
    // critically low-stock item with no expiry_date counted as "well managed"
    // purely for lacking a date — inflating predictedSavings by its full
    // value. daysLeft must be checked unconditionally, matching
    // metricsCalculator.ts's wellManagedItemsList.
    const wellManagedItemsList = items.filter((item) => {
      if (isExpiredOrExpiringSoon(item, 0)) return false; // already past its expiry date
      const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
      return !isExpiredOrExpiringSoon(item, 7) && daysLeft >= 3;
    });

    // Rupee value of stock currently safe from waste (not expiring soon,
    // not low on stock) — quantity × cost_per_unit, summed only over items
    // that actually have a cost entered. Items without cost_per_unit
    // contribute 0 rather than a fabricated per-category price guess.
    const predictedSavings = Math.round(
      wellManagedItemsList.reduce((sum, item) => sum + (item.quantity || 0) * (item.cost_per_unit || 0), 0)
    );
    const carbonReduced = totalItems > 0 ? Math.round(wellManagedItemsList.length * 0.5 * 100) / 100 : 0;

    res.json({
      totalItems,
      lowStockItems,
      expiringSoon,
      categoryCounts,
      predictedSavings,
      carbonReduced,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
};

export const getPredictions = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    let items;
    if (!isDbConnected()) {
      items = getUserItems(req.user.householdId);
    } else {
      items = await Item.find({ user_id: req.user.householdId });
    }

    const formattedItems = items.map((it) => (it.toJSON ? it.toJSON() : it));

    try {
      // A slow-but-alive ML service would otherwise hang this request
      // indefinitely — the try/catch below only covers network errors and
      // non-2xx responses, not a stalled connection. Abort and fall through
      // to the JS fallback predictions if it doesn't respond in time.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let mlResponse;
      try {
        mlResponse = await fetch('http://127.0.0.1:8000/predict', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ items: formattedItems }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (mlResponse.ok) {
        const mlData = await mlResponse.json();
        mlData.is_ml = true;
        return res.json(mlData);
      } else {
        console.warn('ML Service returned error status:', mlResponse.status);
      }
    } catch (err) {
      console.warn('ML Service is offline, unreachable, or timed out. Using fallback predictions. Error:', err.message);
    }

    const predictions = {};
    let totalScore = 0;

    items.forEach((item) => {
      const baseDaily = item.daily_usage || 0;
      const demand_forecast = Array.from({ length: 7 }, (_, i) =>
        Math.max(0.1, Math.round(baseDaily * (1 + Math.sin(i) * 0.15) * 100) / 100)
      );

      let expiry_risk = 'Low';
      if (item.expiry_date) {
        const expDate = new Date(item.expiry_date);
        const today = new Date();
        const daysToExpiry = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysToExpiry < 3) expiry_risk = 'High';
        else if (daysToExpiry < 10) expiry_risk = 'Medium';
      }

      const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
      let low_stock_probability = 0.05;
      if (daysLeft < 3) low_stock_probability = 0.95;
      else if (daysLeft < 7) low_stock_probability = 0.75;
      else if (daysLeft < 10) low_stock_probability = 0.45;

      let refill_date = 'N/A';
      if (item.daily_usage > 0) {
        // Math.floor to match the ML service's `int(days_to_empty)` truncation
        // (main.py) — schedules the refill on/before the day stock actually
        // runs out, rather than a day after, and keeps the answer identical
        // whether or not the ML service happens to be reachable.
        const daysToEmpty = item.quantity / item.daily_usage;
        const target = new Date();
        target.setDate(target.getDate() + Math.floor(daysToEmpty));
        refill_date = target.toISOString().split('T')[0];
      }

      predictions[item.id || item._id.toString()] = {
        demand_forecast,
        refill_date,
        expiry_risk,
        low_stock_probability,
      };

      let score = 1.0;
      if (!item.expiry_date) score -= 0.3;
      if ((item.daily_usage || 0) <= 0) score -= 0.5;
      totalScore += score;
    });

    const model_confidence = items.length > 0 ? Math.round(65 + (totalScore / items.length) * 31) : 65;
    const target = new Date();
    target.setDate(target.getDate() + 5);
    const next_peak_demand_date = target.toISOString().split('T')[0];

    res.json({
      predictions,
      model_metadata: {
        model_confidence,
        next_peak_demand_date,
      },
      is_ml: false,
    });
  } catch (error) {
    console.error('Get predictions error:', error);
    res.status(500).json({ error: 'Failed to fetch predictions' });
  }
};