import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { inventoryApi, InventoryItem, Stats } from '../services/api';
import { StatCard } from './StatCard';
import { InventoryTable } from './InventoryTable';
import { ItemModal } from './ItemModal';
import { AlertCard } from './AlertCard';
import { ForecastChart } from './ForecastChart';
import { RecentActivity } from './RecentActivity';
import Sidebar from './Sidebar';
import AddMemberForm from './AddMemberForm';
// stats components
import UsageTrends from './stats/UsageTrends';
import StockLevelsChart from './stats/StockLevelsChart';
import CategoryInsights from './stats/CategoryInsights';
import ExpiryAnalysis from './stats/ExpiryAnalysis';
import CostAnalytics from './stats/CostAnalytics';
import { LogOut, Plus, Package, AlertTriangle, Leaf, Download, RefreshCw } from 'lucide-react';
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<string>('dashboard');
  const [teamMembers, setTeamMembers] = useState<Array<{id: string; name: string; role: string; access: string;}>>([
    { id: '1', name: 'Alice Johnson', role: 'Manager', access: 'admin' },
    { id: '2', name: 'Ben Carter', role: 'Staff', access: 'write' },
  ]);

  const [settingsState, setSettingsState] = useState({
    profileName: user?.name || '',
    emailNotifications: true,
    weeklySummary: false,
  });

  // Persist team members and settings per-user so records are not lost across sign-out/sign-in
  useEffect(() => {
    if (!user) return;
    const tmKey = `hs:user:${user.id}:teamMembers`;
    const stKey = `hs:user:${user.id}:settings`;
    try {
      const raw = localStorage.getItem(tmKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setTeamMembers(parsed);
      }
    } catch (e) {
      // ignore parse errors
    }

    try {
      const raw = localStorage.getItem(stKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setSettingsState((s) => ({ ...s, ...parsed }));
      }
    } catch (e) {
      // ignore parse errors
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const tmKey = `hs:user:${user.id}:teamMembers`;
    try {
      localStorage.setItem(tmKey, JSON.stringify(teamMembers));
    } catch (e) {
      // ignore
    }
  }, [teamMembers, user]);

  useEffect(() => {
    if (!user) return;
    const stKey = `hs:user:${user.id}:settings`;
    try {
      localStorage.setItem(stKey, JSON.stringify(settingsState));
    } catch (e) {
      // ignore
    }
  }, [settingsState, user]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [itemsData, statsData] = await Promise.all([
        inventoryApi.getItems(),
        inventoryApi.getStats(),
      ]);
      setItems(itemsData);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
      // update lastUpdated when load completes (covers initial load too)
      setLastUpdated(new Date().toLocaleString());
      setIsRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await loadData();
    } catch (e) {
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

  const handleReorder = async (item: InventoryItem) => {
    const qtyStr = prompt(`Enter reorder quantity for ${item.name}:`, '10');
    if (!qtyStr) return;
    const qty = Number(qtyStr);
    if (Number.isNaN(qty) || qty <= 0) {
      alert('Invalid quantity');
      return;
    }

    // prefer a backend endpoint if available
    if ((inventoryApi as any).createOrder) {
      try {
        await (inventoryApi as any).createOrder({ itemId: item.id, quantity: qty });
        alert('Reorder request submitted');
        return;
      } catch (e: any) {
        console.error('Order API failed', e);
        alert('Failed to submit reorder: ' + (e?.message || e));
        return;
      }
    }

    // fallback: create a simple note or show confirmation
    alert(`Reorder requested for ${item.name} (qty: ${qty}). Connect a backend order API to automate this.`);
  };

  const handleSaveItem = async (itemData: Partial<InventoryItem>) => {
    try {
      if (editingItem) {
        await inventoryApi.updateItem(editingItem.id, itemData);
      } else {
        await inventoryApi.createItem(itemData as any);
      }
      await loadData();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Failed to save item:', error);
      throw error;
    }
  };

  // CSV/JSON import helpers
  const fileInputRef = (window as any).__hs_file_input_ref || null;

  const handleImportClick = () => {
    const input = document.getElementById('hs-import-input') as HTMLInputElement | null;
    if (input) input.click();
  };

  const parseCSV = (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map((h) => h.trim());
    const rows = lines.slice(1).map((line) => {
      const values = line.split(',').map((v) => v.trim());
      const obj: any = {};
      headers.forEach((h, i) => {
        obj[h] = values[i] ?? '';
      });
      return obj;
    });
    return rows;
  };

  const handleFileChange = async (e: any) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      let itemsToCreate: any[] = [];
      if (f.type === 'application/json' || f.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) itemsToCreate = parsed;
        else if (parsed.items && Array.isArray(parsed.items)) itemsToCreate = parsed.items;
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
        // Map common fields; CSV headers should match these names: name, category, quantity, daily_usage, expiry_date
        const payload: any = {
          name: row.name || row.item || row.product || '',
          category: row.category || row.cat || 'Uncategorized',
          quantity: Number(row.quantity ?? row.qty ?? 0) || 0,
          daily_usage: Number(row.daily_usage ?? row.dailyUsage ?? row.usage ?? 0) || 0,
          expiry_date: row.expiry_date || row.expiry || row.expiryDate || null,
        };

        if (!payload.name) {
          errors.push('Missing name for one row; skipped');
          continue;
        }

        try {
          await inventoryApi.createItem(payload);
          created += 1;
        } catch (err: any) {
          errors.push(`Failed to create ${payload.name}: ${err?.message || err}`);
        }
      }

      await loadData();
      alert(`Import complete. Created ${created} items.${errors.length ? '\nErrors:\n' + errors.join('\n') : ''}`);
    } catch (err: any) {
      console.error('Import failed', err);
      alert('Import failed: ' + (err?.message || err));
    } finally {
      // reset input
      const input = e.target as HTMLInputElement | null;
      if (input) input.value = '';
    }
  };

  const getLowStockItems = () => {
    return items.filter((item) => {
      const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
      return daysLeft < 3;
    });
  };

  const getExpiringSoonItems = () => {
    return items.filter((item) => {
      if (!item.expiry_date) return false;
      const daysToExpiry = Math.ceil(
        (new Date(item.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );
      return daysToExpiry >= 0 && daysToExpiry < 7;
    });
  };

  const getOutOfStockItems = () => items.filter((i) => (i.quantity ?? 0) <= 0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar mobileOpen={false} onClose={() => {}} onNavigate={(k) => setView(k)} />

      <div className="flex-1 flex flex-col">
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center gap-3">
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
                    onClick={() => alert('Export not implemented')}
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
                <StatCard title="Supply Confidence" value={85} icon={<Download className="w-6 h-6" />} color="green" />
                <StatCard title="Predicted Shortages" value={stats?.lowStockItems || 0} icon={<AlertTriangle className="w-6 h-6" />} color="orange" />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 lg:col-span-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white p-4 rounded">
                    <DemandForecast items={items} stats={stats} />
                  </div>
                  <div className="bg-white p-4 rounded">
                    <LowStockForecast items={items} stats={stats} />
                  </div>
                  <div className="bg-white p-4 rounded">
                    <ExpiryForecast items={items} stats={stats} />
                  </div>
                  <div className="bg-white p-4 rounded">
                    <SeasonalTrends items={items} stats={stats} />
                  </div>
                </div>

                <div className="mt-6">
                  <div className="bg-white rounded-xl border p-4">
                    <h4 className="font-semibold mb-2">Model Outputs</h4>
                    <div className="text-sm text-gray-700">
                      <p><strong>Top predicted restocks:</strong> {items.slice(0,3).map(i=>i.name).join(', ') || '—'}</p>
                      <p><strong>Next peak demand:</strong> {(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)).toLocaleDateString()}</p>
                      <p><strong>Model confidence:</strong> 82%</p>
                      <p className="mt-2"><strong>Notes:</strong> These outputs are generated from simple heuristics locally. Connect a trained model/service to replace with production forecasts.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold mb-3">Recommendations</h3>
                <PurchaseRecommendations items={items} />
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
                <StatCard title="Recycling Rate" value={62} icon={<Package className="w-6 h-6" />} color="blue" />
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
                <div className="mt-4">
                  <button className="px-3 py-2 bg-green-600 text-white rounded">Create Action Plan</button>
                </div>
              </div>
            </div>
          </>
        )}

        {view === 'inventory' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-800">Inventory</h2>
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
            <InventoryTable
              items={items}
              onEdit={handleEditItem}
              onDelete={handleDeleteItem}
              onReorder={handleReorder}
            />
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
                  {teamMembers.map((m) => (
                    <div key={m.id} className="flex items-center justify-between border border-gray-100 rounded-lg p-3">
                      <div>
                        <div className="font-medium text-gray-800">{m.name}</div>
                        <div className="text-sm text-gray-500">Role: {m.role} • Access: {m.access}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={m.role}
                          onChange={(e) => setTeamMembers((s) => s.map((t) => t.id === m.id ? { ...t, role: e.target.value } : t))}
                          className="px-3 py-1 border rounded"
                        >
                          <option>Manager</option>
                          <option>Staff</option>
                          <option>Viewer</option>
                        </select>
                        <select
                          value={m.access}
                          onChange={(e) => setTeamMembers((s) => s.map((t) => t.id === m.id ? { ...t, access: e.target.value } : t))}
                          className="px-3 py-1 border rounded"
                        >
                          <option value="admin">Admin</option>
                          <option value="write">Write</option>
                          <option value="read">Read</option>
                        </select>
                        <button
                          onClick={() => setTeamMembers((s) => s.filter((t) => t.id !== m.id))}
                          className="text-sm text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <AddMemberForm onAdd={(name, role, access) => {
                setTeamMembers((s) => [...s, { id: Date.now().toString(), name, role, access }]);
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
    </div>
  );
};
