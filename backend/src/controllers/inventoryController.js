import mongoose from 'mongoose';
import Item from '../models/Item.js';

// In-memory storage fallback for development when MongoDB is unavailable.
// Exported so other controllers (actionPlanController) that need to read
// the current household's items in dev mode share this same store instead
// of maintaining a separate, out-of-sync copy.
export const devInventory = new Map(); // userId -> items[]
let nextItemId = 1;

export function getUserItems(userId) {
  if (!devInventory.has(userId)) {
    devInventory.set(userId, []);
  }
  return devInventory.get(userId);
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

    if (!isDbConnected()) {
      const items = getUserItems(req.user.householdId);
      return res.json({ items: items.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) });
    }

    const items = await Item.find({ user_id: req.user.householdId }).sort({ createdAt: -1 });
    res.json({ items });
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
};

export const createItem = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    const { name, category, quantity, daily_usage, expiry_date, unit, purchase_date, min_stock_level, storage_location } = req.body;

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
    const { name, category, quantity, daily_usage, expiry_date, unit, purchase_date, min_stock_level, storage_location } = req.body;

    if (isDbConnected() && !isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid item id' });
    }

    const numericFields = parseNumericFields(quantity, daily_usage);
    if (!numericFields) {
      return res.status(400).json({ error: 'quantity and daily_usage must be non-negative numbers' });
    }

    if (numericFields.quantity !== undefined && numericFields.quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be positive' });
    }

    if (numericFields.daily_usage !== undefined && numericFields.daily_usage <= 0) {
      return res.status(400).json({ error: 'Daily usage must be positive' });
    }

    const validUnits = ['pcs', 'kg', 'g', 'L', 'ml', 'packs', 'bottles', 'boxes', 'other'];
    if (unit !== undefined && !validUnits.includes(unit)) {
      return res.status(400).json({ error: 'Invalid unit value' });
    }

    let targetQuantity = numericFields.quantity;
    if (targetQuantity === undefined) {
      if (!isDbConnected()) {
        const items = getUserItems(req.user.householdId);
        const item = items.find(it => it.id === id);
        if (item) targetQuantity = item.quantity;
      } else {
        const item = await Item.findOne({ _id: id, user_id: req.user.householdId });
        if (item) targetQuantity = item.quantity;
      }
    }

    let minStock = undefined;
    if (min_stock_level !== undefined) {
      if (min_stock_level === null || min_stock_level === '') {
        minStock = null;
      } else {
        minStock = parseInt(min_stock_level, 10);
        if (Number.isNaN(minStock) || minStock < 0) {
          return res.status(400).json({ error: 'Minimum stock level must be a non-negative number' });
        }
        if (targetQuantity !== undefined && minStock > targetQuantity) {
          return res.status(400).json({ error: 'Minimum stock level cannot exceed quantity' });
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

    if (pDateVal && eDateVal) {
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

// Bumps a low/out-of-stock item back up to a target quantity and stamps
// purchase_date as today, standing in for placing an actual purchase order.
// Target = max(min_stock_level, daily_usage * 14, 1) so it always restocks
// to at least a two-week buffer, or the item's own configured minimum if
// that's higher.
function calculateReorderQuantity(item) {
  const twoWeekBuffer = Math.ceil((item.daily_usage || 0) * 14);
  const minStock = item.min_stock_level || 0;
  return Math.max(minStock, twoWeekBuffer, 1);
}

export const reorderItem = async (req, res) => {
  try {
    if (rejectStaleDevSession(req, res)) return;

    const { id } = req.params;

    if (isDbConnected() && !isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid item id' });
    }

    const today = new Date().toISOString().split('T')[0];

    if (!isDbConnected()) {
      const items = getUserItems(req.user.householdId);
      const item = items.find((it) => it.id === id);
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }
      const reorderQty = calculateReorderQuantity(item);
      item.quantity = item.quantity + reorderQty;
      item.purchase_date = today;
      item.updated_at = new Date().toISOString();
      return res.json({ message: 'Item reordered successfully (dev mode)', item });
    }

    const existingItem = await Item.findOne({ _id: id, user_id: req.user.householdId });
    if (!existingItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const reorderQty = calculateReorderQuantity(existingItem);

    const updatedItem = await Item.findOneAndUpdate(
      { _id: id, user_id: req.user.householdId },
      { quantity: existingItem.quantity + reorderQty, purchase_date: today },
      { new: true }
    );

    res.json({ message: 'Item reordered successfully', item: updatedItem });
  } catch (error) {
    console.error('Reorder item error:', error);
    res.status(500).json({ error: 'Failed to reorder item' });
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

    const expiringSoon = items.filter((item) => {
      if (!item.expiry_date) return false;
      const daysToExpiry = Math.ceil(
        (new Date(item.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)
      );
      return daysToExpiry >= 0 && daysToExpiry < 7;
    }).length;

    const categoryCounts = items.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {});

    const wellManagedItems = items.filter((item) => {
      if (!item.expiry_date) return true;
      const daysToExpiry = Math.ceil(
        (new Date(item.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)
      );
      const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
      return daysToExpiry >= 7 && daysLeft >= 3;
    }).length;

    const predictedSavings = totalItems > 0 ? Math.round(wellManagedItems * 5) : 0;
    const carbonReduced = totalItems > 0 ? Math.round(wellManagedItems * 0.5 * 100) / 100 : 0;

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
      const mlResponse = await fetch('http://127.0.0.1:8000/predict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items: formattedItems }),
      });

      if (mlResponse.ok) {
        const mlData = await mlResponse.json();
        mlData.is_ml = true;
        return res.json(mlData);
      } else {
        console.warn('ML Service returned error status:', mlResponse.status);
      }
    } catch (err) {
      console.warn('ML Service is offline or unreachable. Using fallback predictions. Error:', err.message);
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
        const daysToEmpty = item.quantity / item.daily_usage;
        const target = new Date();
        target.setDate(target.getDate() + Math.ceil(daysToEmpty));
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