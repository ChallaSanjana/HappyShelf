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

export interface ReorderHistoryEntry {
  id: string;
  householdId: string;
  itemId: string;
  itemName: string;
  category: string;
  quantityAdded: number;
  newQuantity: number;
  unit: string;
  reorderedBy: string;
  created_at: string;
  updated_at?: string;
}

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
};

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

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

  reorderItem: async (id: string, quantity?: number): Promise<{ item: InventoryItem; history: ReorderHistoryEntry }> => {
    const response = await fetch(`${API_URL}/inventory/items/${id}/reorder`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(quantity !== undefined ? { quantity } : {}),
    });
    if (!response.ok) throw new Error(await parseErrorMessage(response, 'Failed to reorder item'));
    const data = await response.json();
    return { item: data.item, history: data.history };
  },

  getReorderHistory: async (): Promise<ReorderHistoryEntry[]> => {
    const response = await fetch(`${API_URL}/inventory/reorder-history`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseErrorMessage(response, 'Failed to fetch reorder history'));
    const data = await response.json();
    return data.history;
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
  avatarUrl?: string | null;
  isActive?: boolean;
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

  // `password` is write-only (never comes back from the API) and `isActive`
  // is included so the last-Admin safeguard on the backend has something to
  // reject when it applies — both are optional partial updates just like
  // the rest of the fields.
  updateTeamMember: async (
    id: string,
    member: Partial<Omit<TeamMember, 'id' | 'householdId'>> & { password?: string }
  ): Promise<TeamMember> => {
    const response = await fetch(`${API_URL}/team/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(member),
    });
    if (!response.ok) {
      let message = 'Failed to update team member';
      try {
        const data = await response.json();
        message = data.error || message;
      } catch {
        // ignore parse errors, use default message
      }
      throw new Error(message);
    }
    const data = await response.json();
    return data.member;
  },

  deleteTeamMember: async (id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/team/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      let message = 'Failed to delete team member';
      try {
        const data = await response.json();
        message = data.error || message;
      } catch {
        // ignore parse errors, use default message
      }
      throw new Error(message);
    }
  },
};

export interface ActionPlanTask {
  id: string;
  type: 'restock' | 'use_soon';
  itemName: string;
  description: string;
  done: boolean;
}

export interface ActionPlan {
  id: string;
  householdId: string;
  createdBy: string;
  title: string;
  tasks: ActionPlanTask[];
  created_at: string;
  updated_at: string;
}

export const actionPlanApi = {
  getActionPlans: async (): Promise<ActionPlan[]> => {
    const response = await fetch(`${API_URL}/action-plans`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseErrorMessage(response, 'Failed to fetch action plans'));
    const data = await response.json();
    return data.plans;
  },

  createActionPlan: async (title?: string): Promise<ActionPlan> => {
    const response = await fetch(`${API_URL}/action-plans`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(title ? { title } : {}),
    });
    if (!response.ok) throw new Error(await parseErrorMessage(response, 'Failed to create action plan'));
    const data = await response.json();
    return data.plan;
  },

  updateTaskStatus: async (planId: string, taskId: string, done: boolean): Promise<ActionPlan> => {
    const response = await fetch(`${API_URL}/action-plans/${planId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ done }),
    });
    if (!response.ok) throw new Error(await parseErrorMessage(response, 'Failed to update task'));
    const data = await response.json();
    return data.plan;
  },

  deleteActionPlan: async (planId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/action-plans/${planId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseErrorMessage(response, 'Failed to delete action plan'));
  },
};