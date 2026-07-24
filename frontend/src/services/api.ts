const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export interface InventoryItem {
  id: string;
  user_id: string;
  name: string;
  category: string;
  quantity: number;
  daily_usage: number;
  expiry_date: string | null;
  unit: 'pcs' | 'kg' | 'g' | 'L' | 'ml' | 'packs' | 'bottles' | 'boxes' | 'other';
  purchase_date?: string | null;
  min_stock_level?: number | null;
  storage_location?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Stats {
  totalItems: number;
  lowStockItems: number;
  expiringSoon: number;
  categoryCounts: Record<string, number>;
  predictedSavings: number;
  carbonReduced: number;
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

  getPredictions: async (): Promise<PredictionsResponse> => {
    const response = await fetch(`${API_URL}/inventory/predictions`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch predictions');
    return response.json();
  },
};

export interface ItemPrediction {
  demand_forecast: number[];
  refill_date: string;
  expiry_risk: 'High' | 'Medium' | 'Low';
  low_stock_probability: number;
}

export interface ModelMetadata {
  model_confidence: number;
  next_peak_demand_date: string;
}

export interface PredictionsResponse {
  predictions: Record<string, ItemPrediction>;
  model_metadata: ModelMetadata;
  is_ml?: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  householdId: string;
}

export const teamApi = {
  getTeamMembers: async (): Promise<TeamMember[]> => {
    const response = await fetch(`${API_URL}/team`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch team members');
    const data = await response.json();
    return data.members;
  },

  addTeamMember: async (member: Omit<TeamMember, 'id' | 'householdId'> & { password?: string }): Promise<TeamMember> => {
    const response = await fetch(`${API_URL}/team`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(member),
    });
    if (!response.ok) throw new Error('Failed to add team member');
    const data = await response.json();
    return data.member;
  },

  updateTeamMember: async (id: string, member: Partial<Omit<TeamMember, 'id' | 'householdId'>>): Promise<TeamMember> => {
    const response = await fetch(`${API_URL}/team/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(member),
    });
    if (!response.ok) throw new Error('Failed to update team member');
    const data = await response.json();
    return data.member;
  },

  deleteTeamMember: async (id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/team/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete team member');
  },
};
