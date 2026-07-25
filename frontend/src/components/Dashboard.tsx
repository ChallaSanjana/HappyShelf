import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { inventoryApi, teamApi, TeamMember, InventoryItem, Stats, PredictionsResponse, actionPlanApi, ActionPlan, ReorderHistoryEntry } from '../services/api';
import { calculateMetrics } from '../utils/metricsCalculator';
import { StatCard } from './StatCard';
import { InventoryTable } from './InventoryTable';
import { ItemModal } from './ItemModal';
import { AlertCard } from './AlertCard';
import { ForecastChart } from './ForecastChart';
import { RecentActivity } from './RecentActivity';
import Sidebar from './Sidebar';
import AddMemberForm from './AddMemberForm';
import { ReorderModal } from './ReorderModal';
import { isExpiredOrExpiringSoon } from '../utils/expiry';
// stats components
import UsageTrends from './stats/UsageTrends';
import StockLevelsChart from './stats/StockLevelsChart';
import CategoryInsights from './stats/CategoryInsights';
import ExpiryAnalysis from './stats/ExpiryAnalysis';
import CostAnalytics from './stats/CostAnalytics';
import { LogOut, Plus, Package, AlertTriangle, Leaf, Download, RefreshCw, Menu } from 'lucide-react';
// sustainability
import FoodWasteTracker from './sustainability/FoodWasteTracker';
import CO2Impact from './sustainability/CO2Impact';
import SmartRecommendations from './sustainability/SmartRecommendations';
import SustainabilityScore from './sustainability/SustainabilityScore';
import ExpiryToUsageEfficiency from './sustainability/ExpiryToUsageEfficiency';
// predictions
import DemandForecast from './predictions/DemandForecast';
import LowStockForecast from './predictions/LowStockForecast';
import ExpiryForecast from './predictions/ExpiryForecast';
import PurchaseRecommendations from './predictions/PurchaseRecommendations';
import SeasonalTrends from './predictions/SeasonalTrends';

export const Dashboard = () => {
  const { user, logout } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [predictions, setPredictions] = useState<PredictionsResponse | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<string>('dashboard');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [actionPlans, setActionPlans] = useState<ActionPlan[]>([]);
  const [isCreatingActionPlan, setIsCreatingActionPlan] = useState(false);
  const [reorderHistory, setReorderHistory] = useState<ReorderHistoryEntry[]>([]);
  const [reorderingItem, setReorderingItem] = useState<InventoryItem | null>(null);
  const [settingsState, setSettingsState] = useState({
    profileName: user?.name || '',
    emailNotifications: true,
    weeklySummary: false,
  });

  const skipSaveRef = useRef<{ settings: boolean }>({ settings: true });

  useEffect(() => {
    skipSaveRef.current = { settings: true };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const stKey = `hs:user:${user.id}:settings`;
    try {
      const raw = localStorage.getItem(stKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setSettingsState((s) => ({ ...s, ...parsed }));
      }
    } catch {
      // ignore parse errors
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (skipSaveRef.current.settings) {
      skipSaveRef.current.settings = false;
      return;
    }
    const stKey = `hs:user:${user.id}:settings`;
    try {
      localStorage.setItem(stKey, JSON.stringify(settingsState));
    } catch {
      // ignore
    }
  }, [settingsState, user]);

  const role = user?.role || 'Viewer';

  // Mirrors the backend's canAssignRole/canActOnMember rules in
  // teamController.js: a Manager may only assign or act on Staff/Viewer
  // members, never Admin/Manager. Keeping this in sync with the backend is
  // just a UX nicety — the server is the actual enforcement point.
  const assignableRoles = role === 'Admin' ? ['Admin', 'Manager', 'Staff', 'Viewer'] : ['Staff', 'Viewer'];
  const canActOnMemberRole = (memberRole: string) =>
    role === 'Admin' || (role === 'Manager' && (memberRole === 'Staff' || memberRole === 'Viewer'));

  // How many active Admins are currently on the team — mirrors the
  // backend's last-Admin safeguard in teamController.js so the UI can grey
  // out the risky option instead of letting the user hit a 403.
  const activeAdminCount = teamMembers.filter((m) => m.role === 'Admin' && m.isActive !== false).length;
  const isSoleRemainingAdmin = (member: TeamMember) => member.role === 'Admin' && activeAdminCount <= 1;

  // Self-service profile editing (name/email/password/avatar) is open to
  // any team member editing their own row. Role and active-status are
  // deliberately kept out of this form — those go through the role
  // dropdown below, which already enforces who can touch what.
  const [editingSelfProfile, setEditingSelfProfile] = useState(false);
  const [selfProfileForm, setSelfProfileForm] = useState({ name: '', email: '', password: '', avatarUrl: '' });
  const [isSavingSelfProfile, setIsSavingSelfProfile] = useState(false);

  const startEditingSelfProfile = (member: TeamMember) => {
    setSelfProfileForm({ name: member.name, email: member.email, password: '', avatarUrl: member.avatarUrl || '' });
    setEditingSelfProfile(true);
  };

  const saveSelfProfile = async (member: TeamMember) => {
    if (!selfProfileForm.name.trim()) return alert('Enter a name');
    if (!selfProfileForm.email.trim()) return alert('Enter an email');
    if (selfProfileForm.password && selfProfileForm.password.length < 8) {
      return alert('New password must be at least 8 characters');
    }
    setIsSavingSelfProfile(true);
    try {
      // Only send fields that actually changed (and never role/isActive —
      // this form can't touch those, by design).
      const updates: Partial<TeamMember> & { password?: string } = {};
      if (selfProfileForm.name.trim() !== member.name) updates.name = selfProfileForm.name.trim();
      if (selfProfileForm.email.trim() !== member.email) updates.email = selfProfileForm.email.trim();
      if (selfProfileForm.avatarUrl.trim() !== (member.avatarUrl || '')) updates.avatarUrl = selfProfileForm.avatarUrl.trim();
      if (selfProfileForm.password) updates.password = selfProfileForm.password;

      if (Object.keys(updates).length === 0) {
        setEditingSelfProfile(false);
        return;
      }

      await teamApi.updateTeamMember(member.id, updates);
      await fetchTeamMembers();
      setEditingSelfProfile(false);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      alert(error.message || 'Failed to update your profile');
    } finally {
      setIsSavingSelfProfile(false);
    }
  };

  const fetchTeamMembers = useCallback(async () => {
    if (!user || (role !== 'Admin' && role !== 'Manager')) return;
    try {
      const members = await teamApi.getTeamMembers();
      setTeamMembers(members);
    } catch (err) {
      console.error('Failed to load team members:', err);
    }
  }, [user, role]);

  const fetchActionPlans = useCallback(async () => {
    if (!user) return;
    try {
      const plans = await actionPlanApi.getActionPlans();
      setActionPlans(plans);
    } catch (err) {
      console.error('Failed to load action plans:', err);
    }
  }, [user]);

  const handleCreateActionPlan = async () => {
    setIsCreatingActionPlan(true);
    try {
      await actionPlanApi.createActionPlan();
      await fetchActionPlans();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      alert(error.message || 'Failed to create action plan');
    } finally {
      setIsCreatingActionPlan(false);
    }
  };

  const handleToggleActionPlanTask = async (planId: string, taskId: string, done: boolean) => {
    // Optimistic update so checking a box feels instant; re-synced from the
    // server response (or rolled back via fetchActionPlans on failure).
    setActionPlans((prev) =>
      prev.map((p) =>
        p.id !== planId ? p : { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, done } : t)) }
      )
    );
    try {
      await actionPlanApi.updateTaskStatus(planId, taskId, done);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      alert(error.message || 'Failed to update task');
      fetchActionPlans();
    }
  };

  const handleDeleteActionPlan = async (planId: string) => {
    if (!confirm('Delete this action plan?')) return;
    try {
      await actionPlanApi.deleteActionPlan(planId);
      await fetchActionPlans();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      alert(error.message || 'Failed to delete action plan');
    }
  };

  useEffect(() => {
    if (view === 'team') {
      fetchTeamMembers();
    }
    if (view === 'sustainability') {
      fetchActionPlans();
    }
  }, [view, fetchTeamMembers, fetchActionPlans]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  // Sidebar.tsx already implements the slide-in/overlay behavior for mobile
  // (translate-x-0 vs -translate-x-full based on `mobileOpen`), but nothing
  // previously set it to true — there was no way to open the nav on a
  // viewport where it's hidden by default. This state + the header button
  // below wire that up.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  // Recalculate metrics whenever items change
  useEffect(() => {
    const calculatedStats = calculateMetrics(items);
    setStats(calculatedStats as Stats);
  }, [items]);

  const loadData = async () => {
    try {
      const itemsData = await inventoryApi.getItems();
      setItems(itemsData);

      try {
        const predictionsData = await inventoryApi.getPredictions();
        setPredictions(predictionsData);
      } catch (predError) {
        console.warn('Failed to load ML predictions:', predError);
        setPredictions(null);
      }

      try {
        const historyData = await inventoryApi.getReorderHistory();
        setReorderHistory(historyData);
      } catch (histError) {
        console.warn('Failed to load reorder history:', histError);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
      setLastUpdated(new Date().toLocaleString());
      setIsRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await loadData();
    } catch {
      // loadData already logs errors
    } finally {
      setIsRefreshing(false);
      setLastUpdated(new Date().toLocaleString());
    }
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setIsModalOpen(true);
  };

  const handleEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    try {
      await inventoryApi.deleteItem(id);
      await loadData();
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  const handleReorder = (item: InventoryItem) => {
    setReorderingItem(item);
  };

  const handleConfirmReorder = async (quantity: number) => {
    if (!reorderingItem) return;
    const { item: updatedItem, history: historyEntry } = await inventoryApi.reorderItem(reorderingItem.id, quantity);

    // Instant UI update — no need to wait for a full reload
    setItems((prev) => prev.map((it) => (it.id === updatedItem.id ? updatedItem : it)));
    setReorderHistory((prev) => [historyEntry, ...prev].slice(0, 50));
    setReorderingItem(null);

    // Refresh predictions/stats in the background so forecasts reflect the new stock
    loadData();
  };

  const handleSaveItem = async (itemData: Partial<InventoryItem>) => {
    try {
      if (editingItem) {
        await inventoryApi.updateItem(editingItem.id, itemData);
      } else {
        await inventoryApi.createItem(itemData as Omit<InventoryItem, 'id' | 'user_id' | 'created_at' | 'updated_at'>);
      }
      await loadData();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Failed to save item:', error);
      throw error;
    }
  };

  const handleExport = () => {
    if (!items || items.length === 0) {
      alert('No items to export');
      return;
    }

    const headers = [
      'Name',
      'Category',
      'Quantity',
      'Unit',
      'Daily Usage',
      'Min Stock Level',
      'Expiry Date',
      'Purchase Date',
      'Storage Location'
    ];

    const escapeCSV = (val: unknown) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [
      headers.join(','),
      ...items.map(item => [
        escapeCSV(item.name),
        escapeCSV(item.category),
        escapeCSV(item.quantity),
        escapeCSV(item.unit),
        escapeCSV(item.daily_usage),
        escapeCSV(item.min_stock_level),
        escapeCSV(item.expiry_date),
        escapeCSV(item.purchase_date),
        escapeCSV(item.storage_location)
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `happyshelf_inventory_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // CSV/JSON import helpers

  const handleImportClick = () => {
    const input = document.getElementById('hs-import-input') as HTMLInputElement | null;
    if (input) input.click();
  };

  const parseCSV = (text: string): Record<string, string>[] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return [];

    // Minimal quoted-field-aware CSV split (handles "a, b", "He said ""hi""")
    const splitCsvLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current);
      return result.map((v) => v.trim());
    };

    // Normalize headers so "Quantity", "quantity", " Quantity " etc. all match
    const rawHeaders = splitCsvLine(lines[0]);
    const headers = rawHeaders.map((h) => h.trim().toLowerCase());

    const rows = lines.slice(1).map((line) => {
      const values = splitCsvLine(line);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = values[i] ?? '';
      });
      return obj;
    });
    return rows;
  };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      let itemsToCreate: Record<string, unknown>[] = [];
      if (f.type === 'application/json' || f.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) itemsToCreate = parsed as Record<string, unknown>[];
        else if (parsed.items && Array.isArray(parsed.items)) itemsToCreate = parsed.items as Record<string, unknown>[];
      } else {
        // assume CSV
        itemsToCreate = parseCSV(text);
      }

      if (!itemsToCreate.length) {
        alert('No items found in the imported file.');
        return;
      }



      let created = 0;
      const errors: string[] = [];
      for (const row of itemsToCreate) {
        // Normalize keys so JSON imports match the same way CSV headers do
        const normalized: Record<string, unknown> = {};
        Object.entries(row).forEach(([k, v]) => {
          normalized[k.trim().toLowerCase()] = v;
        });

        const rowName =
          typeof normalized.name === 'string' ? normalized.name :
            typeof normalized.item === 'string' ? normalized.item :
              typeof normalized.product === 'string' ? normalized.product : '';

        const rowCategory =
          typeof normalized.category === 'string' ? normalized.category :
            typeof normalized.cat === 'string' ? normalized.cat : 'Uncategorized';

        const rowQty = Number(
          normalized.quantity ?? normalized.qty ?? normalized['stock'] ?? 0
        ) || 0;

        const rowUsage = Number(
          normalized.daily_usage ?? normalized.dailyusage ?? normalized['daily usage'] ?? normalized.usage ?? 0
        ) || 0;

        const rowExpiry =
          typeof normalized.expiry_date === 'string' ? normalized.expiry_date :
            typeof normalized.expiry === 'string' ? normalized.expiry :
              typeof normalized.expirydate === 'string' ? normalized.expirydate :
                typeof normalized['expiry date'] === 'string' ? (normalized['expiry date'] as string) : null;

        const payload: Omit<InventoryItem, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
          name: rowName,
          category: rowCategory,
          quantity: rowQty,
          daily_usage: rowUsage,
          expiry_date: rowExpiry || null,
          unit: (normalized.unit as InventoryItem['unit']) || 'pcs',
        };

        if (!payload.name) {
          errors.push('Missing name for one row; skipped');
          continue;
        }

        if (payload.quantity <= 0) {
          errors.push(`${payload.name}: quantity must be greater than 0 (got "${row.quantity ?? row.qty ?? ''}")`);
          continue;
        }

        if (payload.daily_usage <= 0) {
          errors.push(`${payload.name}: daily usage must be greater than 0 (got "${row.daily_usage ?? row.usage ?? ''}")`);
          continue;
        }

        try {
          await inventoryApi.createItem(payload);
          created += 1;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          errors.push(`Failed to create ${payload.name}: ${error.message}`);
        }
      }
      await loadData();
      alert(`Import complete. Created ${created} items.${errors.length ? '\nErrors:\n' + errors.join('\n') : ''}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('Import failed', error);
      alert('Import failed: ' + error.message);
    } finally {
      // reset input
      e.target.value = '';
    }
  };

  const getLowStockItems = () => {
    return items.filter((item) => {
      const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
      return daysLeft < 3;
    });
  };

  const getExpiringSoonItems = () => {
    // Includes items that have already expired, not just ones expiring in
    // the next 7 days — an expired item is the last thing this alert
    // should miss.
    return items.filter((item) => isExpiredOrExpiringSoon(item.expiry_date, 7));
  };

  const getOutOfStockItems = () => items.filter((i) => (i.quantity ?? 0) <= 0);

  const supplyConfidence = items.length === 0 ? 0 : Math.max(0, Math.min(100, Math.round(((items.length - getLowStockItems().length - getOutOfStockItems().length) / items.length) * 100)));
  const completeItemsCount = items.filter(it => (it.daily_usage || 0) > 0 && it.expiry_date).length;
  const modelConfidence = items.length === 0 ? 0 : Math.max(0, Math.min(100, Math.round(70 + (completeItemsCount / items.length) * 25)));
  const recyclableCount = items.filter(it => ['produce', 'dairy', 'bakery', 'fruits', 'vegetables'].some(cat => it.category?.toLowerCase().includes(cat))).length;
  const recyclingRate = items.length === 0 ? 0 : Math.max(0, Math.min(100, Math.round((recyclableCount / items.length) * 100)));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        onNavigate={(k) => { setView(k); setMobileSidebarOpen(false); }}
      />

      <div className="flex-1 flex flex-col">
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMobileSidebarOpen(true)}
                  className="md:hidden p-2 -ml-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition"
                  aria-label="Open navigation menu"
                >
                  <Menu className="w-6 h-6" />
                </button>
                <div className="bg-green-100 p-2 rounded-lg">
                  <Leaf className="w-6 h-6 text-green-600" />
                </div>
                <h1 className="text-xl font-bold text-gray-800">HappyShelf</h1>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-gray-700 hidden md:inline">Welcome, {user?.name}</span>
                <button
                  onClick={logout}
                  className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            </div>
          </div>
        </nav>

        <main className="flex-1 overflow-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Render different views based on sidebar selection */}
          {view === 'dashboard' && (
            <>
              {/* Top stat cards + toolbar */}
              <div className="mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  <StatCard
                    title="Total Items"
                    value={stats?.totalItems || 0}
                    icon={<Package className="w-6 h-6" />}
                    color="green"
                  />
                  <StatCard
                    title="Critical Stock"
                    value={stats?.lowStockItems || 0}
                    icon={<AlertTriangle className="w-6 h-6" />}
                    color="orange"
                  />
                  <StatCard
                    title="Predicted Savings"
                    value={stats?.predictedSavings || 0}
                    icon={<Download className="w-6 h-6" />}
                    color="green"
                    prefix="$"
                  />
                  <StatCard
                    title="Carbon Reduced"
                    value={stats?.carbonReduced || 0}
                    icon={<Leaf className="w-6 h-6" />}
                    color="green"
                    suffix="kg CO₂"
                  />
                </div>

                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-gray-500">Last updated: {lastUpdated ?? 'just now'}</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      className={`flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 ${isRefreshing ? 'opacity-75 cursor-not-allowed' : ''}`}
                    >
                      <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                      {isRefreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                      onClick={handleExport}
                      className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50"
                    >
                      <Download className="w-4 h-4" />
                      Export
                    </button>
                    <button
                      onClick={handleAddItem}
                      className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition"
                    >
                      <Plus className="w-5 h-5" />
                      Add Item
                    </button>
                  </div>
                </div>
              </div>

              {/* Recent activity (no graphs on dashboard) */}
              <div className="grid grid-cols-1 gap-6 mb-8">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
                  <RecentActivity items={items} stats={stats} />
                </div>
              </div>

              {(getLowStockItems().length > 0 || getExpiringSoonItems().length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  {getLowStockItems().length > 0 && (
                    <AlertCard title="Low Stock Items" items={getLowStockItems()} type="stock" />
                  )}
                  {getExpiringSoonItems().length > 0 && (
                    <AlertCard title="Expiring Soon" items={getExpiringSoonItems()} type="expiry" />
                  )}
                </div>
              )}
            </>
          )}

          {view === 'stats' && (
            <>
              <div className="mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  <StatCard title="Total Items" value={stats?.totalItems || 0} icon={<Package className="w-6 h-6" />} color="green" />
                  <StatCard title="Critical Stock" value={stats?.lowStockItems || 0} icon={<AlertTriangle className="w-6 h-6" />} color="orange" />
                  <StatCard title="Predicted Savings" value={stats?.predictedSavings || 0} icon={<Download className="w-6 h-6" />} color="green" prefix="$" />
                  <StatCard title="Carbon Reduced" value={stats?.carbonReduced || 0} icon={<Leaf className="w-6 h-6" />} color="green" suffix="kg CO₂" />
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                <h3 className="text-lg font-semibold mb-4">Inventory Forecast</h3>
                <ForecastChart items={items} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <UsageTrends items={items} stats={stats} />
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <StockLevelsChart items={items} stats={stats} />
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <CategoryInsights items={items} stats={stats} />
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <ExpiryAnalysis items={items} stats={stats} />
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 lg:col-span-2">
                  <CostAnalytics items={items} stats={stats} />
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold mb-3">Historical reporting & descriptive analytics</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 border rounded">
                      <div className="text-sm text-gray-500">Total Items</div>
                      <div className="text-2xl font-bold">{stats?.totalItems ?? items.length}</div>
                    </div>
                    <div className="p-4 border rounded">
                      <div className="text-sm text-gray-500">Low stock items</div>
                      <div className="text-2xl font-bold">{stats?.lowStockItems ?? getLowStockItems().length}</div>
                    </div>
                    <div className="p-4 border rounded">
                      <div className="text-sm text-gray-500">Expiring soon</div>
                      <div className="text-2xl font-bold">{stats?.expiringSoon ?? getExpiringSoonItems().length}</div>
                    </div>
                  </div>

                  <div className="mt-4 text-sm text-gray-700">
                    <p>Historical summary based on available inventory records: average daily usage, category trends, and expiry rates are shown above in charts. Use the date filters (coming soon) to refine reports.</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {view === 'predictions' && (
            <>
              <div className="mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  <StatCard title="Demand Forecast" value={stats?.totalItems || 0} icon={<Package className="w-6 h-6" />} color="blue" />
                  <StatCard title="Supply Confidence" value={supplyConfidence} icon={<Download className="w-6 h-6" />} color="green" suffix="%" />
                  <StatCard title="Predicted Shortages" value={stats?.lowStockItems || 0} icon={<AlertTriangle className="w-6 h-6" />} color="orange" />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 lg:col-span-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white p-4 rounded">
                      <DemandForecast items={items} stats={stats} predictions={predictions} />
                    </div>
                    <div className="bg-white p-4 rounded">
                      <LowStockForecast items={items} stats={stats} predictions={predictions} />
                    </div>
                    <div className="bg-white p-4 rounded">
                      <ExpiryForecast items={items} stats={stats} predictions={predictions} />
                    </div>
                    <div className="bg-white p-4 rounded">
                      <SeasonalTrends items={items} stats={stats} predictions={predictions} />
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="bg-white rounded-xl border p-4">
                      <h4 className="font-semibold mb-2">ML Model Outputs</h4>
                      <div className="text-sm text-gray-700">
                        <p><strong>Top predicted restocks:</strong> {
                          Object.entries(predictions?.predictions || {})
                            .filter(([, pred]) => pred.low_stock_probability > 0.5)
                            .map(([id]) => items.find(i => i.id === id)?.name)
                            .filter(Boolean)
                            .slice(0, 3)
                            .join(', ') || 'None'
                        }</p>
                        <p><strong>Next peak demand:</strong> {predictions?.model_metadata?.next_peak_demand_date ? new Date(predictions.model_metadata.next_peak_demand_date).toLocaleDateString() : 'N/A'}</p>
                        <p><strong>Model confidence:</strong> {predictions?.model_metadata?.model_confidence ?? modelConfidence}%</p>
                        <p className="mt-2 text-xs text-gray-500"><strong>Notes:</strong> These outputs are generated by the Python ML service (scikit-learn LinearRegression & DecisionTree models) running live.</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <h3 className="text-lg font-semibold mb-3">Recommendations</h3>
                  <PurchaseRecommendations items={items} predictions={predictions} />
                  <div className="mt-4 text-sm text-gray-600">
                    <p>Use these recommendations to generate purchase orders or adjust reorder points.</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {view === 'sustainability' && (
            <>
              <div className="mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  <StatCard title="Waste Reduced" value={stats?.totalItems ? Math.max(0, Math.round((stats.totalItems - (stats.expiringSoon || 0)) * 0.1)) : 0} icon={<Leaf className="w-6 h-6" />} color="green" />
                  <StatCard title="Eco Score" value={stats ? Math.max(0, Math.round(((stats.totalItems - (stats.expiringSoon || 0)) / Math.max(1, stats.totalItems)) * 100)) : 0} icon={<Leaf className="w-6 h-6" />} color="green" />
                  <StatCard title="Expiries Prevented" value={stats?.expiringSoon || getExpiringSoonItems().length} icon={<AlertTriangle className="w-6 h-6" />} color="orange" />
                  <StatCard title="Recycling Rate" value={recyclingRate} icon={<Package className="w-6 h-6" />} color="blue" suffix="%" />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold mb-4">Sustainability Overview</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white p-4 rounded">
                      <FoodWasteTracker items={items} stats={stats} />
                    </div>
                    <div className="bg-white p-4 rounded">
                      <CO2Impact items={items} stats={stats} />
                    </div>
                    <div className="bg-white p-4 rounded">
                      <ExpiryToUsageEfficiency items={items} />
                    </div>
                    <div className="bg-white p-4 rounded">
                      <SustainabilityScore items={items} stats={stats} />
                    </div>
                  </div>

                  <div className="mt-6">
                    <h4 className="font-semibold mb-2">Action-driven Recommendations</h4>
                    <div className="bg-white border rounded p-4">
                      <SmartRecommendations items={items} />
                      <div className="mt-3 text-sm text-gray-600">These recommendations are heuristic-driven. For production, connect with inventory usage / procurement workflows to auto-create purchase actions.</div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <h3 className="text-lg font-semibold mb-3">Sustainability Actions</h3>
                  <ul className="list-disc list-inside text-sm text-gray-700">
                    <li>Prioritize items expiring soon for consumption.</li>
                    <li>Adjust reorder points for high-waste categories.</li>
                    <li>Enable alerts for items approaching expiry with promo suggestions.</li>
                  </ul>
                  {role !== 'Viewer' && (
                    <div className="mt-4">
                      <button
                        onClick={handleCreateActionPlan}
                        disabled={isCreatingActionPlan}
                        className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        {isCreatingActionPlan ? 'Creating...' : 'Create Action Plan'}
                      </button>
                      <div className="text-xs text-gray-500 mt-2">
                        Builds a checklist from items that are low/out of stock or expiring soon.
                      </div>
                    </div>
                  )}

                  {actionPlans.length > 0 && (
                    <div className="mt-6 space-y-4">
                      {actionPlans.map((plan) => {
                        const doneCount = plan.tasks.filter((t) => t.done).length;
                        return (
                          <div key={plan.id} className="border border-gray-100 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <div className="font-medium text-gray-800">{plan.title}</div>
                                <div className="text-xs text-gray-500">{doneCount}/{plan.tasks.length} done</div>
                              </div>
                              {role !== 'Viewer' && (
                                <button
                                  onClick={() => handleDeleteActionPlan(plan.id)}
                                  className="text-sm text-red-600 hover:underline"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                            <ul className="space-y-2">
                              {plan.tasks.map((task) => (
                                <li key={task.id} className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    checked={task.done}
                                    disabled={role === 'Viewer'}
                                    onChange={(e) => handleToggleActionPlanTask(plan.id, task.id, e.target.checked)}
                                    className="mt-1"
                                  />
                                  <span className={`text-sm ${task.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                                    <span
                                      className={`inline-block px-1.5 py-0.5 rounded text-xs mr-2 ${task.type === 'restock' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                                        }`}
                                    >
                                      {task.type === 'restock' ? 'Restock' : 'Use soon'}
                                    </span>
                                    {task.description}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {view === 'inventory' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-800">Inventory</h2>
                {role !== 'Viewer' && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddItem}
                      className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition"
                    >
                      <Plus className="w-5 h-5" />
                      Add Item
                    </button>
                    <button
                      onClick={handleImportClick}
                      className="ml-2 flex items-center gap-2 bg-white border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50"
                    >
                      Import
                    </button>
                    <input id="hs-import-input" type="file" accept=".csv,application/json,.json" onChange={handleFileChange} className="hidden" />
                  </div>
                )}
              </div>
              <InventoryTable
                items={items}
                onEdit={handleEditItem}
                onDelete={handleDeleteItem}
                onReorder={handleReorder}
                readOnly={role === 'Viewer'}
              />

              {reorderHistory.length > 0 && (
                <div className="p-6 border-t border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">Recent Reorders</h3>
                  <div className="space-y-3">
                    {reorderHistory.slice(0, 8).map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
                        <div>
                          <p className="font-medium text-gray-800">{entry.itemName}</p>
                          <p className="text-sm text-gray-500">{entry.category}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-green-600">
                            +{entry.quantityAdded} {entry.unit}
                          </p>
                          <p className="text-xs text-gray-500">
                            New total: {entry.newQuantity} {entry.unit}
                          </p>
                          <p className="text-xs text-gray-400">
                            {new Date(entry.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {view === 'alerts' && (
            <div className="mb-6">
              <div className="flex items-center justify-between p-6 bg-white rounded-t-xl border border-b-0 border-gray-200">
                <h2 className="text-xl font-semibold text-gray-800">Alerts</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className={`flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 ${isRefreshing ? 'opacity-75 cursor-not-allowed' : ''}`}
                  >
                    <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    {isRefreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-b-xl shadow-sm border border-t-0 border-gray-200 p-6">
                {(getLowStockItems().length > 0 || getExpiringSoonItems().length > 0 || getOutOfStockItems().length > 0) ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {getOutOfStockItems().length > 0 && (
                      <AlertCard title="Out of Stock" items={getOutOfStockItems()} type="stock" />
                    )}
                    {getLowStockItems().length > 0 && (
                      <AlertCard title="Low Stock Items" items={getLowStockItems()} type="stock" />
                    )}
                    {getExpiringSoonItems().length > 0 && (
                      <AlertCard title="Expiring Soon" items={getExpiringSoonItems()} type="expiry" />
                    )}
                  </div>
                ) : (
                  <div className="text-gray-600">No active alerts at the moment.</div>
                )}
              </div>
            </div>
          )}

          {view === 'team' && (
            <div className="mb-6">
              <div className="flex items-center justify-between p-6 bg-white rounded-t-xl border border-b-0 border-gray-200">
                <h2 className="text-xl font-semibold text-gray-800">Team</h2>
                <div className="text-sm text-gray-500">Manage team members and access</div>
              </div>

              <div className="bg-white rounded-b-xl shadow-sm border border-t-0 border-gray-200 p-6">
                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-2">Team Members</h3>
                  <div className="space-y-3">
                    {teamMembers.map((m) => {
                      const isSelf = m.id === user?.id;
                      // A Manager can never edit their own role/active-status
                      // from here (mirrors the backend), and even an Admin
                      // can't touch their own role/active-status if they're
                      // the last remaining Admin.
                      const roleEditableForSelf = role === 'Admin' && !isSoleRemainingAdmin(m);
                      const roleSelectVisible = isSelf ? roleEditableForSelf : canActOnMemberRole(m.role);
                      const removeVisible = !isSelf && canActOnMemberRole(m.role) && !isSoleRemainingAdmin(m);

                      return (
                        <div key={m.id} className="border border-gray-100 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {m.avatarUrl ? (
                                <img src={m.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-500">
                                  {m.name.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <div>
                                <div className="font-medium text-gray-800">
                                  {m.name} {isSelf && <span className="text-xs text-gray-400">(you)</span>}
                                  {m.isActive === false && <span className="ml-2 text-xs text-red-500">Deactivated</span>}
                                </div>
                                <div className="text-sm text-gray-500">Email: {m.email} • Role: {m.role}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {roleSelectVisible ? (
                                <select
                                  value={m.role}
                                  onChange={async (e) => {
                                    try {
                                      await teamApi.updateTeamMember(m.id, { role: e.target.value });
                                      fetchTeamMembers();
                                    } catch (err) {
                                      const error = err instanceof Error ? err : new Error(String(err));
                                      alert(error.message || 'Failed to update member role');
                                    }
                                  }}
                                  className="px-3 py-1 border rounded text-sm"
                                >
                                  {/* Always include the member's current role even if it's
                                      outside assignableRoles, so the select doesn't silently
                                      jump to a different value than what's actually stored. */}
                                  {(assignableRoles.includes(m.role) ? assignableRoles : [m.role, ...assignableRoles]).map((r) => (
                                    <option key={r}>{r}</option>
                                  ))}
                                </select>
                              ) : (
                                <span
                                  className="px-3 py-1 text-sm text-gray-500"
                                  title={
                                    isSelf
                                      ? isSoleRemainingAdmin(m)
                                        ? 'You are the only Admin — promote another member to Admin first.'
                                        : 'You cannot change your own role from the Team panel. Ask an Admin.'
                                      : "Only an Admin can change this member's role"
                                  }
                                >
                                  {m.role}
                                </span>
                              )}
                              {isSelf && (
                                <button
                                  onClick={() => startEditingSelfProfile(m)}
                                  className="text-sm text-blue-600 hover:underline px-2 py-1"
                                >
                                  Edit profile
                                </button>
                              )}
                              {removeVisible && (
                                <button
                                  onClick={async () => {
                                    if (confirm(`Remove ${m.name}?`)) {
                                      try {
                                        await teamApi.deleteTeamMember(m.id);
                                        fetchTeamMembers();
                                      } catch (err) {
                                        const error = err instanceof Error ? err : new Error(String(err));
                                        alert(error.message || 'Failed to remove team member');
                                      }
                                    }
                                  }}
                                  className="text-sm text-red-600 hover:underline px-2 py-1"
                                >
                                  Remove
                                </button>
                              )}
                              {!isSelf && m.role === 'Admin' && isSoleRemainingAdmin(m) && (
                                <span className="text-xs text-gray-400" title="At least one Admin must always remain on the team">
                                  Last Admin
                                </span>
                              )}
                            </div>
                          </div>

                          {isSelf && editingSelfProfile && (
                            <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <input
                                value={selfProfileForm.name}
                                onChange={(e) => setSelfProfileForm((s) => ({ ...s, name: e.target.value }))}
                                placeholder="Full name"
                                className="px-3 py-2 border rounded text-sm w-full"
                              />
                              <input
                                type="email"
                                value={selfProfileForm.email}
                                onChange={(e) => setSelfProfileForm((s) => ({ ...s, email: e.target.value }))}
                                placeholder="Email address"
                                className="px-3 py-2 border rounded text-sm w-full"
                              />
                              <input
                                type="password"
                                value={selfProfileForm.password}
                                onChange={(e) => setSelfProfileForm((s) => ({ ...s, password: e.target.value }))}
                                placeholder="New password (leave blank to keep current)"
                                className="px-3 py-2 border rounded text-sm w-full"
                              />
                              <input
                                value={selfProfileForm.avatarUrl}
                                onChange={(e) => setSelfProfileForm((s) => ({ ...s, avatarUrl: e.target.value }))}
                                placeholder="Avatar image URL"
                                className="px-3 py-2 border rounded text-sm w-full"
                              />
                              <div className="sm:col-span-2 flex items-center gap-2 justify-end">
                                <button
                                  onClick={() => setEditingSelfProfile(false)}
                                  className="px-3 py-2 text-sm rounded border hover:bg-gray-50"
                                  disabled={isSavingSelfProfile}
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => saveSelfProfile(m)}
                                  className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                  disabled={isSavingSelfProfile}
                                >
                                  {isSavingSelfProfile ? 'Saving...' : 'Save profile'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <AddMemberForm assignableRoles={assignableRoles} onAdd={async (name, email, password, role) => {
                  try {
                    await teamApi.addTeamMember({ name, email, password, role });
                    fetchTeamMembers();
                  } catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    alert(error.message || 'Failed to add member');
                  }
                }} />
              </div>
            </div>
          )}

          {view === 'settings' && (
            <div className="mb-6">
              <div className="flex items-center justify-between p-6 bg-white rounded-t-xl border border-b-0 border-gray-200">
                <h2 className="text-xl font-semibold text-gray-800">Settings</h2>
                <div className="text-sm text-gray-500">Profile, account and notification settings</div>
              </div>

              <div className="bg-white rounded-b-xl shadow-sm border border-t-0 border-gray-200 p-6 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Profile</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                      value={settingsState.profileName}
                      onChange={(e) => setSettingsState((s) => ({ ...s, profileName: e.target.value }))}
                      className="px-4 py-2 border rounded"
                      placeholder="Your name"
                    />
                    <div className="text-sm text-gray-500">Email: {user?.email}</div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-2">Notifications</h3>
                  <div className="flex flex-col gap-3">
                    <label className="flex items-center gap-3">
                      <input type="checkbox" checked={settingsState.emailNotifications} onChange={(e) => setSettingsState((s) => ({ ...s, emailNotifications: e.target.checked }))} />
                      <span className="text-sm">Email notifications</span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input type="checkbox" checked={settingsState.weeklySummary} onChange={(e) => setSettingsState((s) => ({ ...s, weeklySummary: e.target.checked }))} />
                      <span className="text-sm">Weekly summary</span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => alert('Settings saved (local only)')}
                    className="px-4 py-2 bg-green-600 text-white rounded"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {isModalOpen && (
        <ItemModal
          item={editingItem}
          onSave={handleSaveItem}
          onClose={() => setIsModalOpen(false)}
        />
      )}

      {reorderingItem && (
        <ReorderModal
          item={reorderingItem}
          onConfirm={handleConfirmReorder}
          onClose={() => setReorderingItem(null)}
        />
      )}
    </div>
  );
};