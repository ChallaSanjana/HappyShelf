import { supabase } from '../config/supabase.js';

// Dev fallback: simple in-memory store when SUPABASE_* are placeholders
const isDevFallback = () => {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  return url.includes('example') || key.includes('example');
};

const devInventory = new Map(); // userId -> [items]
let nextItemId = 1;

function ensureUserStore(userId) {
  if (!devInventory.has(userId)) devInventory.set(userId, []);
  return devInventory.get(userId);
}

export const getItems = async (req, res) => {
  try {
    if (isDevFallback()) {
      const userId = req.user.userId;
      const items = ensureUserStore(userId).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json({ items });
    }
    const { data: items, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

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

    if (isDevFallback()) {
      const userId = req.user.userId;
      const store = ensureUserStore(userId);
      const item = {
        id: nextItemId++,
        user_id: userId,
        name,
        category,
        quantity: parseInt(quantity),
        daily_usage: parseFloat(daily_usage),
        expiry_date: expiry_date || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.push(item);
      return res.status(201).json({ message: 'Item created successfully (dev)', item });
    }

    const { data: newItem, error } = await supabase
      .from('inventory_items')
      .insert([
        {
          user_id: req.user.userId,
          name,
          category,
          quantity: parseInt(quantity),
          daily_usage: parseFloat(daily_usage),
          expiry_date: expiry_date || null,
        },
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

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

    const updateData = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (quantity !== undefined) updateData.quantity = parseInt(quantity);
    if (daily_usage !== undefined) updateData.daily_usage = parseFloat(daily_usage);
    if (expiry_date !== undefined) updateData.expiry_date = expiry_date || null;

    if (isDevFallback()) {
      const userId = req.user.userId;
      const store = ensureUserStore(userId);
      const idx = store.findIndex((it) => String(it.id) === String(id));
      if (idx === -1) return res.status(404).json({ error: 'Item not found (dev)' });
      const item = store[idx];
      if (name !== undefined) item.name = name;
      if (category !== undefined) item.category = category;
      if (quantity !== undefined) item.quantity = parseInt(quantity);
      if (daily_usage !== undefined) item.daily_usage = parseFloat(daily_usage);
      if (expiry_date !== undefined) item.expiry_date = expiry_date || null;
      item.updated_at = new Date().toISOString();
      return res.json({ message: 'Item updated successfully (dev)', item });
    }

    const { data: updatedItem, error } = await supabase
      .from('inventory_items')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', req.user.userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

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
    if (isDevFallback()) {
      const userId = req.user.userId;
      const store = ensureUserStore(userId);
      const idx = store.findIndex((it) => String(it.id) === String(id));
      if (idx === -1) return res.status(404).json({ error: 'Item not found (dev)' });
      store.splice(idx, 1);
      return res.json({ message: 'Item deleted successfully (dev)' });
    }

    const { error } = await supabase
      .from('inventory_items')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.userId);

    if (error) {
      throw error;
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
    if (isDevFallback()) {
      const userId = req.user.userId;
      items = ensureUserStore(userId).slice();
    } else {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('user_id', req.user.userId);

      if (error) {
        throw error;
      }

      items = data;
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
