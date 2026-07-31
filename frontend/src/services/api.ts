import { apiRequest } from './httpClient';

export { API_URL, ApiError } from './httpClient';

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
  cost_per_unit?: number | null;
  created_at: string;
  updated_at: string;
}

export type NewInventoryItem = Omit<InventoryItem, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export interface Stats {
  totalItems: number;
  /** Items needing restock attention — both 'low' and already 'out'. */
  lowStockItems: number;
  outOfStockItems: number;
  /** Expiring within 7 days *or already expired*. */
  expiringSoon: number;
  categoryCounts: Record<string, number>;
  predictedSavings: number;
  carbonReduced: number;
}

export type StockStatusFilter = 'out' | 'low' | 'healthy';
export type ExpiryStatusFilter = 'expired' | 'expiring_soon' | 'healthy' | 'none';
export type ItemSortField = 'name' | 'quantity' | 'price' | 'totalValue' | 'expiryDate';
export type SortOrder = 'asc' | 'desc';

export interface ItemSearchParams {
  search?: string;
  category?: string;
  stockStatus?: StockStatusFilter;
  expiryStatus?: ExpiryStatusFilter;
  sortBy?: ItemSortField;
  sortOrder?: SortOrder;
  page?: number;
  limit?: number;
}

export interface ItemSearchResult {
  items: InventoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
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
  createdAt: string;
  updatedAt?: string;
}

export interface ConsumptionHistoryEntry {
  id: string;
  householdId: string;
  itemId: string;
  itemName: string;
  category: string;
  quantityConsumed: number;
  remainingQuantity: number;
  unit: string;
  consumedBy: string;
  createdAt: string;
  updatedAt?: string;
}

/** Per-row failure from a bulk import — `row` is 1-based to match a spreadsheet. */
export interface BulkImportError {
  row: number;
  name: string | null;
  error: string;
}

export interface BulkImportResult {
  message: string;
  created: number;
  items: InventoryItem[];
  errors: BulkImportError[];
}

/**
 * Window for a history request. Both default server-side to the previous
 * behaviour (newest 50, no date filter); the analytics views ask for a wider
 * window so their charts can be drawn from real records.
 */
export interface HistoryQuery {
  /** Max entries to return. Server caps this at 2000. */
  limit?: number;
  /** Only include entries from the last N days. */
  days?: number;
}

function historyQueryString({ limit, days }: HistoryQuery): string {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (days !== undefined) params.set('days', String(days));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const inventoryApi = {
  getItems: async (): Promise<InventoryItem[]> => {
    const data = await apiRequest<{ items: InventoryItem[] }>('/inventory/items', {
      fallbackError: 'Failed to fetch items',
    });
    return data.items;
  },

  createItem: async (item: NewInventoryItem): Promise<InventoryItem> => {
    const data = await apiRequest<{ item: InventoryItem }>('/inventory/items', {
      method: 'POST',
      body: item,
      fallbackError: 'Failed to create item',
    });
    return data.item;
  },

  /**
   * Creates many items in one request. The CSV/JSON import used to issue one
   * POST per row, so a 500-row file meant 500 sequential round trips.
   */
  bulkCreateItems: async (items: NewInventoryItem[]): Promise<BulkImportResult> =>
    apiRequest<BulkImportResult>('/inventory/items/bulk', {
      method: 'POST',
      body: { items },
      fallbackError: 'Failed to import items',
    }),

  updateItem: async (id: string, item: Partial<InventoryItem>): Promise<InventoryItem> => {
    const data = await apiRequest<{ item: InventoryItem }>(`/inventory/items/${id}`, {
      method: 'PUT',
      body: item,
      fallbackError: 'Failed to update item',
    });
    return data.item;
  },

  deleteItem: async (id: string): Promise<void> => {
    await apiRequest<void>(`/inventory/items/${id}`, {
      method: 'DELETE',
      fallbackError: 'Failed to delete item',
    });
  },

  reorderItem: async (
    id: string,
    quantity?: number
  ): Promise<{ item: InventoryItem; history: ReorderHistoryEntry }> => {
    const data = await apiRequest<{ item: InventoryItem; history: ReorderHistoryEntry }>(
      `/inventory/items/${id}/reorder`,
      {
        method: 'PATCH',
        body: quantity !== undefined ? { quantity } : {},
        fallbackError: 'Failed to reorder item',
      }
    );
    return { item: data.item, history: data.history };
  },

  consumeItem: async (
    id: string,
    quantity: number
  ): Promise<{ item: InventoryItem; history: ConsumptionHistoryEntry }> => {
    const data = await apiRequest<{ item: InventoryItem; history: ConsumptionHistoryEntry }>(
      `/inventory/items/${id}/consume`,
      {
        method: 'PATCH',
        body: { quantity },
        fallbackError: 'Failed to consume item',
      }
    );
    return { item: data.item, history: data.history };
  },

  getReorderHistory: async (options: HistoryQuery = {}): Promise<ReorderHistoryEntry[]> => {
    const data = await apiRequest<{ history: ReorderHistoryEntry[] }>(
      `/inventory/reorder-history${historyQueryString(options)}`,
      { fallbackError: 'Failed to fetch reorder history' }
    );
    return data.history;
  },

  getConsumptionHistory: async (options: HistoryQuery = {}): Promise<ConsumptionHistoryEntry[]> => {
    const data = await apiRequest<{ history: ConsumptionHistoryEntry[] }>(
      `/inventory/consumption-history${historyQueryString(options)}`,
      { fallbackError: 'Failed to fetch consumption history' }
    );
    return data.history;
  },

  searchItems: async (params: ItemSearchParams): Promise<ItemSearchResult> => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.category) query.set('category', params.category);
    if (params.stockStatus) query.set('stockStatus', params.stockStatus);
    if (params.expiryStatus) query.set('expiryStatus', params.expiryStatus);
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);
    query.set('page', String(params.page ?? 1));
    query.set('limit', String(params.limit ?? 10));

    return apiRequest<ItemSearchResult>(`/inventory/items?${query.toString()}`, {
      fallbackError: 'Failed to search items',
    });
  },

  getStats: async (): Promise<Stats> =>
    apiRequest<Stats>('/inventory/stats', { fallbackError: 'Failed to fetch stats' }),

  getPredictions: async (): Promise<PredictionsResponse> =>
    apiRequest<PredictionsResponse>('/inventory/predictions', {
      fallbackError: 'Failed to fetch predictions',
    }),
};

/**
 * Where a demand forecast came from, most-specific first:
 *  - `household_history`    fitted on this household's own logged consumes
 *  - `pretrained_model`     the generic training-data model for that item name
 *  - `daily_usage_estimate` flat projection of the user's stated usage rate
 */
export type ForecastSource = 'household_history' | 'pretrained_model' | 'daily_usage_estimate';

export interface ItemPrediction {
  demand_forecast: number[];
  refill_date: string;
  expiry_risk: 'High' | 'Medium' | 'Low';
  low_stock_probability: number;
  forecast_source?: ForecastSource;
}

export interface ModelMetadata {
  /** Data-completeness score, not model accuracy — see ml_service/main.py. */
  model_confidence: number;
  next_peak_demand_date: string;
  /** How many items were forecast from each source. */
  forecast_sources?: Record<ForecastSource, number>;
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
    const data = await apiRequest<{ members: TeamMember[] }>('/team', {
      fallbackError: 'Failed to fetch team members',
    });
    return data.members;
  },

  addTeamMember: async (
    member: Omit<TeamMember, 'id' | 'householdId'> & { password?: string }
  ): Promise<TeamMember> => {
    const data = await apiRequest<{ member: TeamMember }>('/team', {
      method: 'POST',
      body: member,
      fallbackError: 'Failed to add team member',
    });
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
    const data = await apiRequest<{ member: TeamMember }>(`/team/${id}`, {
      method: 'PUT',
      body: member,
      fallbackError: 'Failed to update team member',
    });
    return data.member;
  },

  deleteTeamMember: async (id: string): Promise<void> => {
    await apiRequest<void>(`/team/${id}`, {
      method: 'DELETE',
      fallbackError: 'Failed to delete team member',
    });
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
    const data = await apiRequest<{ plans: ActionPlan[] }>('/action-plans', {
      fallbackError: 'Failed to fetch action plans',
    });
    return data.plans;
  },

  createActionPlan: async (title?: string): Promise<ActionPlan> => {
    const data = await apiRequest<{ plan: ActionPlan }>('/action-plans', {
      method: 'POST',
      body: title ? { title } : {},
      fallbackError: 'Failed to create action plan',
    });
    return data.plan;
  },

  updateTaskStatus: async (planId: string, taskId: string, done: boolean): Promise<ActionPlan> => {
    const data = await apiRequest<{ plan: ActionPlan }>(
      `/action-plans/${planId}/tasks/${taskId}`,
      { method: 'PATCH', body: { done }, fallbackError: 'Failed to update task' }
    );
    return data.plan;
  },

  deleteActionPlan: async (planId: string): Promise<void> => {
    await apiRequest<void>(`/action-plans/${planId}`, {
      method: 'DELETE',
      fallbackError: 'Failed to delete action plan',
    });
  },
};

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  householdId: string;
  emailNotifications: boolean;
}

export const authApi = {
  login: async (email: string, password: string): Promise<{ token: string; user: AuthUser }> =>
    apiRequest<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      fallbackError: 'Login failed',
      // A 401 here means "wrong password", not "your session died".
      skipAuthRedirect: true,
    }),

  register: async (
    email: string,
    password: string,
    name: string
  ): Promise<{ token: string; user: AuthUser }> =>
    apiRequest<{ token: string; user: AuthUser }>('/auth/register', {
      method: 'POST',
      body: { email, password, name },
      fallbackError: 'Registration failed',
      skipAuthRedirect: true,
    }),

  /** Re-reads the signed-in account, so a stale cached role can't linger. */
  getMe: async (): Promise<AuthUser> => {
    const data = await apiRequest<{ user: AuthUser }>('/auth/me', {
      fallbackError: 'Failed to load your profile',
    });
    return data.user;
  },

  updateMe: async (updates: { name?: string; emailNotifications?: boolean }): Promise<AuthUser> => {
    const data = await apiRequest<{ user: AuthUser }>('/auth/me', {
      method: 'PATCH',
      body: updates,
      fallbackError: 'Failed to update profile',
    });
    return data.user;
  },
};
