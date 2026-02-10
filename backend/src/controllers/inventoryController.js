import mongoose from 'mongoose';
import Item from '../models/Item.js';

// In-memory storage fallback for development when MongoDB is unavailable
const devInventory = new Map(); // userId -> items[]
let nextItemId = 1;

function getUserItems(userId) {
  if (!devInventory.has(userId)) {
    devInventory.set(userId, []);
  }
  return devInventory.get(userId);
}

export const getItems = async (req, res) => {
  try {
    // Check MongoDB connection - use in-memory fallback if unavailable
    if (!mongoose.connection.readyState) {
      const items = getUserItems(req.user.userId);
      return res.json({ items: items.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) });
    }
    
    const items = await Item.find({ user_id: req.user.userId }).sort({ createdAt: -1 });
    res.json({ items });
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
};

export const createItem = async (req, res) => {
  try {
    const { name, category, quantity, daily_usage, expiry_date } = req.body;

    if (!name || !category || quantity === undefined || daily_usage === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check MongoDB connection - use in-memory fallback if unavailable
    if (!mongoose.connection.readyState) {
      const items = getUserItems(req.user.userId);
      const newItem = {
        id: `dev_${nextItemId++}`,
        user_id: req.user.userId,
        name,
        category,
        quantity: parseInt(quantity),
        daily_usage: parseFloat(daily_usage),
        expiry_date: expiry_date || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      items.push(newItem);
      console.log(`✓ Item created (in-memory): ${name}`);
      return res.status(201).json({ message: 'Item created successfully (dev mode)', item: newItem });
    }

    const newItem = await Item.create({
      user_id: req.user.userId,
      name,
      category,
      quantity: parseInt(quantity),
      daily_usage: parseFloat(daily_usage),
      expiry_date: expiry_date || null,
    });

    res.status(201).json({ message: 'Item created successfully', item: newItem });
  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({ error: 'Failed to create item' });
  }
};

export const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, quantity, daily_usage, expiry_date } = req.body;

    // Check MongoDB connection - use in-memory fallback if unavailable
    if (!mongoose.connection.readyState) {
      const items = getUserItems(req.user.userId);
      const item = items.find(it => it.id === id);
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }
      if (name !== undefined) item.name = name;
      if (category !== undefined) item.category = category;
      if (quantity !== undefined) item.quantity = parseInt(quantity);
      if (daily_usage !== undefined) item.daily_usage = parseFloat(daily_usage);
      if (expiry_date !== undefined) item.expiry_date = expiry_date || null;
      item.updated_at = new Date().toISOString();
      return res.json({ message: 'Item updated successfully (dev mode)', item });
    }

    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (quantity !== undefined) updateData.quantity = parseInt(quantity);
    if (daily_usage !== undefined) updateData.daily_usage = parseFloat(daily_usage);
    if (expiry_date !== undefined) updateData.expiry_date = expiry_date || null;

    const updatedItem = await Item.findOneAndUpdate(
      { _id: id, user_id: req.user.userId },
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

export const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;

    // Check MongoDB connection - use in-memory fallback if unavailable
    if (!mongoose.connection.readyState) {
      const items = getUserItems(req.user.userId);
      const index = items.findIndex(it => it.id === id);
      if (index === -1) {
        return res.status(404).json({ error: 'Item not found' });
      }
      items.splice(index, 1);
      return res.json({ message: 'Item deleted successfully (dev mode)' });
    }

    const deletedItem = await Item.findOneAndDelete({
      _id: id,
      user_id: req.user.userId,
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
    // Check MongoDB connection - use in-memory fallback if unavailable
    let items;
    if (!mongoose.connection.readyState) {
      items = getUserItems(req.user.userId);
    } else {
      // Fetch all items for the user (metrics calculated on-the-fly, not stored in DB)
      items = await Item.find({ user_id: req.user.userId });
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

    // Calculate predicted savings: based on well-managed items
    // Items not expiring soon and not low stock = prevented waste
    const wellManagedItems = items.filter((item) => {
      if (!item.expiry_date) return true; // No expiry concern
      const daysToExpiry = Math.ceil(
        (new Date(item.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)
      );
      const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
      return daysToExpiry >= 7 && daysLeft >= 3; // Not expiring soon and not low stock
    }).length;
    
    // Estimate: $5 average value per well-managed item
    const predictedSavings = totalItems > 0 ? Math.round(wellManagedItems * 5) : 0;
    
    // Calculate carbon reduced: based on waste prevention
    // Each item saved from waste = ~0.5kg CO2 reduction
    const carbonReduced = totalItems > 0 ? Math.round((wellManagedItems * 0.5) / 1000 * 100) / 100 : 0;

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
