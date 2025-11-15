const API_URL = import.meta.env.VITE_API_URL;

export interface InventoryItem {
  id: string;
  user_id: string;
  name: string;
  category: string;
  quantity: number;
  daily_usage: number;
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Stats {
  totalItems: number;
  lowStockItems: number;
  expiringSoon: number;
  categoryCounts: Record<string, number>;
}

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
};

export const inventoryApi = {
  getItems: async (): Promise<InventoryItem[]> => {
    const response = await fetch(`${API_URL}/inventory/items`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch items');
    const data = await response.json();
    return data.items;
  },

  createItem: async (item: Omit<InventoryItem, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<InventoryItem> => {
    const response = await fetch(`${API_URL}/inventory/items`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(item),
    });
    if (!response.ok) throw new Error('Failed to create item');
    const data = await response.json();
    return data.item;
  },

  updateItem: async (id: string, item: Partial<InventoryItem>): Promise<InventoryItem> => {
    const response = await fetch(`${API_URL}/inventory/items/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(item),
    });
    if (!response.ok) throw new Error('Failed to update item');
    const data = await response.json();
    return data.item;
  },

  deleteItem: async (id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/inventory/items/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete item');
  },

  getStats: async (): Promise<Stats> => {
    const response = await fetch(`${API_URL}/inventory/stats`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch stats');
    return response.json();
  },
};
