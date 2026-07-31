import { InventoryItem } from '../services/api';
import { Pencil, Trash2 } from 'lucide-react';
import { getDaysToExpiry } from '../utils/expiry';
import { getDaysLeft, getStockStatus } from '../utils/stock';

const getCategoryColor = (category: string): string => {
  const colors: Record<string, string> = {
    'Food': 'bg-amber-100 text-amber-700 border-amber-200',
    'Beverages': 'bg-blue-100 text-blue-700 border-blue-200',
    'Dairy': 'bg-cyan-100 text-cyan-700 border-cyan-200',
    'Meat': 'bg-red-100 text-red-700 border-red-200',
    'Produce': 'bg-green-100 text-green-700 border-green-200',
    'Bakery': 'bg-orange-100 text-orange-700 border-orange-200',
    'Frozen': 'bg-sky-100 text-sky-700 border-sky-200',
    'Snacks': 'bg-yellow-100 text-yellow-700 border-yellow-200',
    'Cleaning': 'bg-purple-100 text-purple-700 border-purple-200',
    'Personal Care': 'bg-pink-100 text-pink-700 border-pink-200',
    'Supplies': 'bg-slate-100 text-slate-700 border-slate-200',
    'Other': 'bg-gray-100 text-gray-700 border-gray-200',
  };
  return colors[category] || 'bg-gray-100 text-gray-700 border-gray-200';
};

interface InventoryTableProps {
  items: InventoryItem[];
  onEdit: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
  onReorder?: (item: InventoryItem) => void;
  onConsume?: (item: InventoryItem) => void;
  readOnly?: boolean;
}

type StockStatus = 'out' | 'critical' | 'warning' | 'good';
type ExpiryStatus = 'expired' | 'critical' | 'warning' | 'good' | 'none';

export const InventoryTable = ({ items, onEdit, onDelete, onReorder, onConsume, readOnly = false }: InventoryTableProps) => {
  const calculateDaysLeft = (item: InventoryItem) => {
    const daysLeft = getDaysLeft(item);
    return Number.isFinite(daysLeft) ? daysLeft.toFixed(1) : 'N/A';
  };

  // Stock status depends only on quantity/daily_usage/min_stock_level —
  // completely independent of expiry. This is what a reorder actually
  // affects, so it's the badge that should visibly change immediately after
  // restocking.
  //
  // The out/low decision is delegated to the shared getStockStatus in
  // utils/stock.ts so this badge can't drift from the dashboard counts or
  // the backend's alert emails. The extra "warning" tier is display-only:
  // a heads-up band between "low" and "good" that exists on this table
  // alone, so it stays local.
  const getBadgeStatus = (item: InventoryItem): StockStatus => {
    const shared = getStockStatus(item);
    if (shared === 'out') return 'out';
    if (shared === 'low') return 'critical';
    return getDaysLeft(item) < 7 ? 'warning' : 'good';
  };

  // Expiry status depends only on expiry_date — reordering never changes
  // this, since adding more units of the same batch doesn't push out its
  // expiry date. Kept as a separate badge so it can't mask a healthy stock
  // level (or vice versa) the way a single merged "Status" column used to.
  const getExpiryStatus = (item: InventoryItem): ExpiryStatus => {
    const daysToExpiry = getDaysToExpiry(item.expiry_date);
    if (daysToExpiry === null) return 'none';
    if (daysToExpiry < 0) return 'expired';
    if (daysToExpiry < 7) return 'critical';
    if (daysToExpiry < 14) return 'warning';
    return 'good';
  };

  const stockStyles: Record<StockStatus, string> = {
    out: 'bg-red-100 text-red-700',
    critical: 'bg-red-100 text-red-700',
    warning: 'bg-orange-100 text-orange-700',
    good: 'bg-green-100 text-green-700',
  };

  // Labeled to match the dashboard/alerts terminology (Dashboard.tsx's
  // getLowStockItems() and the backend's getStats both flag "Low Stock" at
  // the same daysLeft < 3 threshold as this "critical" tier) — previously
  // this tier was labeled "Critical" while the *3-7 day* tier was labeled
  // "Low", so the badge a user would look for to match the "Low Stock
  // Items" alert wasn't the one that actually corresponded to it.
  const stockLabels: Record<StockStatus, string> = {
    out: 'Out of stock',
    critical: 'Low Stock',
    warning: 'Watch',
    good: 'Good',
  };

  const expiryStyles: Record<Exclude<ExpiryStatus, 'none'>, string> = {
    expired: 'bg-red-100 text-red-700',
    critical: 'bg-red-100 text-red-700',
    warning: 'bg-orange-100 text-orange-700',
    good: 'bg-green-100 text-green-700',
  };

  const expiryLabels: Record<Exclude<ExpiryStatus, 'none'>, string> = {
    expired: 'Expired',
    critical: 'Expiring soon',
    warning: 'Use soon',
    good: 'Good',
  };

  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No items in inventory. Add your first item to get started!
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Name</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Category</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Quantity</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Daily Usage</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Cost/Unit</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Days Left</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Expiry Date</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Stock Status</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Expiry Status</th>
            {!readOnly && <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Actions</th>}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map((item) => {
            const stockStatus = getBadgeStatus(item);
            const expiryStatus = getExpiryStatus(item);
            return (
              <tr key={item.id} className="hover:bg-gray-50 transition">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{item.name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2.5 py-1 inline-flex text-xs font-medium rounded-full border ${getCategoryColor(item.category)}`}>
                    {item.category}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{item.quantity}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{item.daily_usage}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    {item.cost_per_unit !== null && item.cost_per_unit !== undefined ? `₹${item.cost_per_unit}` : '—'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{calculateDaysLeft(item)}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    {item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : 'N/A'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${stockStyles[stockStatus]}`}>
                    {stockLabels[stockStatus]}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {expiryStatus !== 'none' ? (
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${expiryStyles[expiryStatus]}`}>
                      {expiryLabels[expiryStatus]}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">No expiry</span>
                  )}
                </td>
                {!readOnly && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => onEdit(item)}
                      className="text-green-600 hover:text-green-900 mr-3"
                      aria-label={`Edit ${item.name}`}
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                    </button>
                    {/* Disabled rather than alerting when no handler is wired
                        up — an unusable control should look unusable. */}
                    <button
                      onClick={() => onReorder?.(item)}
                      disabled={!onReorder}
                      className="text-blue-600 hover:text-blue-900 mr-3 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label={`Reorder ${item.name}`}
                    >
                      Reorder
                    </button>
                    <button
                      onClick={() => onConsume?.(item)}
                      disabled={!onConsume || (item.quantity ?? 0) <= 0}
                      className="text-orange-600 hover:text-orange-900 mr-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-orange-600"
                      aria-label={`Consume ${item.name}`}
                    >
                      Consume
                    </button>
                    <button
                      onClick={() => onDelete(item.id)}
                      className="text-red-600 hover:text-red-900"
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};