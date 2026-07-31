import mongoose from 'mongoose';
import Item from '../models/Item.js';
import ReorderHistory from '../models/ReorderHistory.js';
import ConsumptionHistory from '../models/ConsumptionHistory.js';
import User from '../models/User.js';
import { devUsers } from '../store/devStore.js';
import { queryInventoryItems } from '../utils/inventoryQuery.js';
import {
  getStockStatus,
  getDaysToExpiry,
  estimateLowStockProbability,
  calculateRefillDate,
  STOCK_STATUS_RANK,
  calculateStats,
} from '../utils/inventoryMetrics.js';
import { validateNewItem, parseNumericFields, VALID_UNITS } from '../utils/itemValidation.js';
import { buildDevHistoryBase } from '../utils/historyJson.js';
import { sendStockAlert } from '../utils/mailer.js';

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

// The ML service was previously hardcoded to http://127.0.0.1:8000, which
// meant the backend and the prediction service could never be deployed to
// separate hosts without editing source. Both are configurable now; the
// defaults keep local development working with no .env at all.
const ML_SERVICE_URL = (process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const ML_SERVICE_TOKEN = process.env.ML_SERVICE_TOKEN || '';
const ML_SERVICE_TIMEOUT_MS = Number(process.env.ML_SERVICE_TIMEOUT_MS) || 5000;

// readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
// Only treat the DB as usable when it's fully connected (state 1). Anything
// else (including "connecting") falls back to in-memory storage instead of
// letting Mongoose silently buffer/queue the query.
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

// req.params.id is a raw URL segment — if it isn't a valid 24-char hex
// ObjectId, Mongoose throws a CastError when it's used in a query filter.
// That was previously falling through to the generic catch block and coming
// back as a 500, when it's really a client input error (400).
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Sessions opened while the DB was down carry a synthetic "dev_" id that
// can't be resolved once the DB is back. That's now rejected centrally in
// middleware/auth.js, which re-reads the account on every request, so no
// controller needs its own guard.

// Household members who should be emailed when stock status worsens: active,
// and opted in (email_notifications defaults to true, so only an explicit
// false excludes them).
async function getNotifiableRecipients(householdId) {
  if (!isDbConnected()) {
    return Array.from(devUsers.values())
      .filter((u) => u.household_id === householdId && u.is_active !== false && u.email_notifications !== false)
      .map((u) => ({ email: u.email, name: u.name }));
  }
  const users = await User.find(
    { household_id: householdId, is_active: { $ne: false }, email_notifications: { $ne: false } },
    'email name'
  );
  return users.map((u) => ({ email: u.email, name: u.name }));
}

// Fire-and-forget from the caller's perspective — sendStockAlert/getNotifiableRecipients
// never throw, but this is still wrapped so a future change to either can't
// turn a successful consume/update/create into a 500.
async function notifyIfStockStatusWorsened(householdId, itemBefore, itemAfter) {
  try {
    const before = itemBefore ? STOCK_STATUS_RANK[getStockStatus(itemBefore)] : STOCK_STATUS_RANK.healthy;
    const afterStatus = getStockStatus(itemAfter);
    const after = STOCK_STATUS_RANK[afterStatus];
    if (after <= before || after === STOCK_STATUS_RANK.healthy) return;

    const recipients = await getNotifiableRecipients(householdId);
    await sendStockAlert(recipients, itemAfter, afterStatus);
  } catch (error) {
    console.error('Stock alert notification failed:', error.message);
  }
}

export const getItems = async (req, res) => {
  try {
    let items;
    if (!isDbConnected()) {
      items = getUserItems(req.user.householdId).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else {
      items = await Item.find({ household_id: req.user.householdId }).sort({ createdAt: -1 });
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

// Builds the in-memory representation of a validated item, matching the
// shape Mongoose would return so both storage modes look identical to the
// rest of the app.
function buildDevItem(householdId, value) {
  const now = new Date().toISOString();
  return {
    id: `dev_${nextItemId++}`,
    household_id: householdId,
    ...value,
    created_at: now,
    updated_at: now,
  };
}

export const createItem = async (req, res) => {
  try {
    const { error, value } = validateNewItem(req.body);
    if (error) {
      return res.status(400).json({ error });
    }

    if (!isDbConnected()) {
      const items = getUserItems(req.user.householdId);
      const newItem = buildDevItem(req.user.householdId, value);
      items.push(newItem);
      console.log(`✓ Item created (in-memory): ${value.name}`);
      await notifyIfStockStatusWorsened(req.user.householdId, null, newItem);
      return res.status(201).json({ message: 'Item created successfully (dev mode)', item: newItem });
    }

    const newItem = await Item.create({ household_id: req.user.householdId, ...value });

    await notifyIfStockStatusWorsened(req.user.householdId, null, newItem);

    res.status(201).json({ message: 'Item created successfully', item: newItem });
  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({ error: 'Failed to create item' });
  }
};

/** Upper bound on a single bulk import call. */
const MAX_BULK_ITEMS = 1000;

/**
 * Creates many items in one request.
 *
 * The CSV/JSON import in the UI previously issued one POST /items per row,
 * so a 500-row spreadsheet meant 500 sequential round trips — minutes of
 * waiting, and a partially-imported file if the user closed the tab.
 *
 * Rows are validated individually and reported per-row rather than failing
 * the whole batch: an import of 300 good rows and 2 malformed ones should
 * land the 300 and tell you about the 2. `ordered: false` gives the same
 * semantics at the database level.
 */
export const bulkCreateItems = async (req, res) => {
  try {
    const { items: rawItems } = req.body;

    if (!Array.isArray(rawItems)) {
      return res.status(400).json({ error: 'Expected an "items" array' });
    }
    if (rawItems.length === 0) {
      return res.status(400).json({ error: 'No items to import' });
    }
    if (rawItems.length > MAX_BULK_ITEMS) {
      return res.status(400).json({
        error: `Too many items in one request (${rawItems.length}). Maximum is ${MAX_BULK_ITEMS}.`,
      });
    }

    const validated = [];
    const errors = [];

    rawItems.forEach((raw, index) => {
      const { error, value } = validateNewItem(raw);
      if (error) {
        // 1-based and labelled by name so the message lines up with what the
        // user sees in their spreadsheet.
        errors.push({ row: index + 1, name: raw?.name || null, error });
      } else {
        validated.push(value);
      }
    });

    if (validated.length === 0) {
      return res.status(400).json({ error: 'No valid items to import', created: 0, errors });
    }

    if (!isDbConnected()) {
      const items = getUserItems(req.user.householdId);
      const created = validated.map((value) => buildDevItem(req.user.householdId, value));
      items.push(...created);
      return res.status(201).json({
        message: `Imported ${created.length} item${created.length === 1 ? '' : 's'} (dev mode)`,
        created: created.length,
        items: created,
        errors,
      });
    }

    const docs = validated.map((value) => ({ household_id: req.user.householdId, ...value }));
    const created = await Item.insertMany(docs, { ordered: false });

    res.status(201).json({
      message: `Imported ${created.length} item${created.length === 1 ? '' : 's'}`,
      created: created.length,
      items: created,
      errors,
    });
  } catch (error) {
    console.error('Bulk create items error:', error);
    res.status(500).json({ error: 'Failed to import items' });
  }
};

export const updateItem = async (req, res) => {
  try {
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

    if (unit !== undefined && !VALID_UNITS.includes(unit)) {
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
        existingItem = await Item.findOne({ _id: id, household_id: req.user.householdId });
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
        existingItem = await Item.findOne({ _id: id, household_id: req.user.householdId });
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
      const beforeSnapshot = { quantity: item.quantity, daily_usage: item.daily_usage, min_stock_level: item.min_stock_level };
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
      await notifyIfStockStatusWorsened(req.user.householdId, beforeSnapshot, item);
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

    // Only fetch the pre-update state when quantity/min_stock_level are
    // actually part of this request — those are the only fields that affect
    // stock status, so an edit that e.g. only renames the item skips this
    // extra query entirely.
    let beforeItemForAlert = null;
    if (numericFields.quantity !== undefined || minStock !== undefined) {
      beforeItemForAlert = await Item.findOne({ _id: id, household_id: req.user.householdId });
    }

    const updatedItem = await Item.findOneAndUpdate(
      { _id: id, household_id: req.user.householdId },
      updateData,
      { returnDocument: 'after' }
    );

    if (!updatedItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    await notifyIfStockStatusWorsened(req.user.householdId, beforeItemForAlert, updatedItem);

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

    const existingItem = await Item.findOne({ _id: id, household_id: req.user.householdId });
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
      { _id: id, household_id: req.user.householdId },
      { $inc: { quantity: reorderQty }, $set: setFields },
      { returnDocument: 'after' }
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
      const beforeSnapshot = { quantity: item.quantity, daily_usage: item.daily_usage, min_stock_level: item.min_stock_level };
      item.quantity = item.quantity - consumeQty;
      item.updated_at = new Date().toISOString();

      const historyEntry = {
        ...buildDevHistoryBase(`dev_consume_${nextConsumptionHistoryId++}`, req.user.householdId, item),
        quantityConsumed: consumeQty,
        remainingQuantity: item.quantity,
        consumedBy: req.user.userId,
      };
      getHouseholdConsumptionHistory(req.user.householdId).unshift(historyEntry);

      await notifyIfStockStatusWorsened(req.user.householdId, beforeSnapshot, item);

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
      { _id: id, household_id: req.user.householdId, quantity: { $gte: consumeQty } },
      { $inc: { quantity: -consumeQty } },
      { returnDocument: 'after' }
    );

    if (!updatedItem) {
      const existingItem = await Item.findOne({ _id: id, household_id: req.user.householdId });
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

    // updatedItem's quantity already reflects the atomic $inc decrement, so
    // the pre-consume quantity can be reconstructed by adding consumeQty back
    // — no extra query needed to know the "before" state.
    const beforeSnapshot = {
      quantity: updatedItem.quantity + consumeQty,
      daily_usage: updatedItem.daily_usage,
      min_stock_level: updatedItem.min_stock_level,
    };
    await notifyIfStockStatusWorsened(req.user.householdId, beforeSnapshot, updatedItem);

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

// The history logs were capped at a flat 50 entries, which is fine for the
// "Recent activity" lists but far too short to draw a real trend from — it's
// why the analytics charts used to invent their own data. `limit` and `days`
// let a caller ask for an actual window. Both default to the previous
// behaviour, so existing callers are unaffected.
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 2000;

function parseHistoryQuery(query) {
  const parsedLimit = parseInt(query.limit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(MAX_HISTORY_LIMIT, Math.max(1, parsedLimit))
    : DEFAULT_HISTORY_LIMIT;

  const parsedDays = parseInt(query.days, 10);
  const since =
    Number.isFinite(parsedDays) && parsedDays > 0
      ? new Date(Date.now() - parsedDays * 24 * 60 * 60 * 1000)
      : null;

  return { limit, since };
}

/** Newest-first in-memory equivalent of the Mongo query below. */
function sliceDevHistory(entries, { limit, since }) {
  const withinWindow = since
    ? entries.filter((entry) => new Date(entry.createdAt) >= since)
    : entries;
  return withinWindow.slice(0, limit);
}

export const getConsumptionHistory = async (req, res) => {
  try {
    const householdId = req.user.householdId;
    const { limit, since } = parseHistoryQuery(req.query);

    if (!isDbConnected()) {
      const history = sliceDevHistory(getHouseholdConsumptionHistory(householdId), { limit, since });
      return res.json({ history });
    }

    const filter = { household_id: householdId };
    if (since) filter.created_at = { $gte: since };

    const history = await ConsumptionHistory.find(filter)
      .sort({ created_at: -1 })
      .limit(limit);

    res.json({ history });
  } catch (error) {
    console.error('Get consumption history error:', error);
    res.status(500).json({ error: 'Failed to fetch consumption history' });
  }
};

export const getReorderHistory = async (req, res) => {
  try {
    const householdId = req.user.householdId;
    const { limit, since } = parseHistoryQuery(req.query);

    if (!isDbConnected()) {
      const history = sliceDevHistory(getHouseholdHistory(householdId), { limit, since });
      return res.json({ history });
    }

    const filter = { household_id: householdId };
    if (since) filter.created_at = { $gte: since };

    const history = await ReorderHistory.find(filter)
      .sort({ created_at: -1 })
      .limit(limit);

    res.json({ history });
  } catch (error) {
    console.error('Get reorder history error:', error);
    res.status(500).json({ error: 'Failed to fetch reorder history' });
  }
};

export const deleteItem = async (req, res) => {
  try {
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
      household_id: req.user.householdId,
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
    let items;
    if (!isDbConnected()) {
      items = getUserItems(req.user.householdId);
    } else {
      items = await Item.find({ household_id: req.user.householdId });
    }

    res.json(calculateStats(items));
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
};

// How much consumption history to hand the ML service so it can fit a
// per-item demand model on this household's actual usage rather than on the
// generic training CSVs. A year of data bounded at 2000 rows keeps the
// request payload sane for even a heavy household.
const ML_HISTORY_DAYS = 365;
const ML_HISTORY_LIMIT = 2000;

/**
 * The household's recent consumption, flattened to the minimum the ML
 * service needs to fit a demand model: which item, how much, and when.
 */
async function getConsumptionHistoryForMl(householdId) {
  const since = new Date(Date.now() - ML_HISTORY_DAYS * 24 * 60 * 60 * 1000);

  if (!isDbConnected()) {
    return getHouseholdConsumptionHistory(householdId)
      .filter((entry) => new Date(entry.createdAt) >= since)
      .slice(0, ML_HISTORY_LIMIT)
      .map((entry) => ({
        item_id: String(entry.itemId),
        item_name: entry.itemName,
        quantity_consumed: entry.quantityConsumed,
        consumed_at: entry.createdAt,
      }));
  }

  const records = await ConsumptionHistory.find(
    { household_id: householdId, created_at: { $gte: since } },
    'item_id item_name quantity_consumed created_at'
  )
    .sort({ created_at: -1 })
    .limit(ML_HISTORY_LIMIT)
    .lean();

  return records.map((entry) => ({
    item_id: String(entry.item_id),
    item_name: entry.item_name,
    quantity_consumed: entry.quantity_consumed,
    consumed_at: new Date(entry.created_at).toISOString(),
  }));
}

/**
 * Mean daily consumption per item over the supplied history, used by the JS
 * fallback so it doesn't have to rely purely on the static `daily_usage`
 * figure a user typed in months ago.
 */
function meanDailyConsumptionByItem(history) {
  const totals = new Map();

  for (const record of history) {
    const key = String(record.item_id);
    const at = new Date(record.consumed_at).getTime();
    if (!Number.isFinite(at)) continue;

    const current = totals.get(key) || { total: 0, earliest: at, latest: at };
    current.total += Number(record.quantity_consumed) || 0;
    current.earliest = Math.min(current.earliest, at);
    current.latest = Math.max(current.latest, at);
    totals.set(key, current);
  }

  const means = new Map();
  for (const [key, { total, earliest, latest }] of totals) {
    // At least a day of span so a single burst of consumes on one day can't
    // divide by ~0 and report an absurd daily rate.
    const spanDays = Math.max(1, (latest - earliest) / (24 * 60 * 60 * 1000));
    means.set(key, total / spanDays);
  }
  return means;
}

export const getPredictions = async (req, res) => {
  try {
    let items;
    if (!isDbConnected()) {
      items = getUserItems(req.user.householdId);
    } else {
      items = await Item.find({ household_id: req.user.householdId });
    }

    const formattedItems = items.map((it) => (it.toJSON ? it.toJSON() : it));

    // Loaded once and used by both paths: sent to the ML service so it can
    // learn this household's real pattern, and used by the JS fallback below
    // if the service is unavailable.
    let consumptionHistory = [];
    try {
      consumptionHistory = await getConsumptionHistoryForMl(req.user.householdId);
    } catch (historyError) {
      console.warn('Could not load consumption history for predictions:', historyError.message);
    }

    try {
      // A slow-but-alive ML service would otherwise hang this request
      // indefinitely — the try/catch below only covers network errors and
      // non-2xx responses, not a stalled connection. Abort and fall through
      // to the JS fallback predictions if it doesn't respond in time.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ML_SERVICE_TIMEOUT_MS);
      let mlResponse;
      try {
        mlResponse = await fetch(`${ML_SERVICE_URL}/predict`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Only sent when configured; the ML service leaves the endpoint
            // open (loopback-only) when it has no token either.
            ...(ML_SERVICE_TOKEN ? { 'X-ML-Token': ML_SERVICE_TOKEN } : {}),
          },
          body: JSON.stringify({
            items: formattedItems,
            consumption_history: consumptionHistory,
          }),
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

    // --- JS fallback (ML service unreachable) ----------------------------
    // Uses the same consumption history the ML service would have learned
    // from, so an item with real usage data gets a forecast grounded in that
    // rather than in the static daily_usage figure alone.
    const predictions = {};
    const observedDailyUsage = meanDailyConsumptionByItem(consumptionHistory);
    let totalScore = 0;

    items.forEach((item) => {
      const itemId = item.id || item._id.toString();
      const observed = observedDailyUsage.get(String(itemId));
      const hasObserved = observed !== undefined && observed > 0;

      // A flat projection of the best rate available. No sine wave: there is
      // no daily pattern in this data, and inventing one produced a "trend"
      // with nothing behind it.
      const baseDaily = hasObserved ? observed : item.daily_usage || 0;
      const demand_forecast = Array(7).fill(Math.max(0.1, Math.round(baseDaily * 100) / 100));

      let expiry_risk = 'Low';
      const daysToExpiry = getDaysToExpiry(item.expiry_date);
      if (daysToExpiry !== null) {
        if (daysToExpiry < 3) expiry_risk = 'High';
        else if (daysToExpiry < 10) expiry_risk = 'Medium';
      }

      const low_stock_probability = estimateLowStockProbability(item);

      // Shared with the ML service's calculate_refill_date, including the
      // horizon beyond which no date is returned. Computing it inline here
      // used to throw RangeError on a large enough quantity/usage ratio,
      // which failed the whole response rather than the one item.
      const refill_date = calculateRefillDate(item.quantity, baseDaily);

      predictions[itemId] = {
        demand_forecast,
        refill_date,
        expiry_risk,
        low_stock_probability,
        // Mirrors the ML service's field so the UI can say where a forecast
        // came from regardless of which path produced it.
        forecast_source: hasObserved ? 'household_history' : 'daily_usage_estimate',
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