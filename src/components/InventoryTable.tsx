import { InventoryItem } from '../services/api';
import { Pencil, Trash2 } from 'lucide-react';

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
}

export const InventoryTable = ({ items, onEdit, onDelete }: InventoryTableProps) => {
  const calculateDaysLeft = (item: InventoryItem) => {
    if (item.daily_usage <= 0) return 'N/A';
    return (item.quantity / item.daily_usage).toFixed(1);
  };

  const getDaysToExpiry = (expiryDate: string | null) => {
    if (!expiryDate) return 'N/A';
    const days = Math.ceil(
      (new Date(expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );
    return days;
  };

  const getStatusColor = (item: InventoryItem) => {
    if ((item.quantity ?? 0) <= 0) return 'bg-red-100 text-red-700';
    const daysLeft = item.daily_usage > 0 ? item.quantity / item.daily_usage : 999;
    const daysToExpiry = getDaysToExpiry(item.expiry_date);

    if (daysLeft < 3 || (typeof daysToExpiry === 'number' && daysToExpiry >= 0 && daysToExpiry < 7)) {
      return 'bg-red-100 text-red-700';
    }
    if (daysLeft < 7 || (typeof daysToExpiry === 'number' && daysToExpiry >= 0 && daysToExpiry < 14)) {
      return 'bg-orange-100 text-orange-700';
    }
    return 'bg-green-100 text-green-700';
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
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Name
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Category
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Quantity
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Daily Usage
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Days Left
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Expiry Date
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map((item) => (
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
                <div className="text-sm text-gray-900">{calculateDaysLeft(item)}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900">
                  {item.expiry_date
                    ? new Date(item.expiry_date).toLocaleDateString()
                    : 'N/A'}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span
                  className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                    item
                  )}`}
                >
                  { (item.quantity ?? 0) <= 0 ? 'Out of stock' : (getStatusColor(item).includes('red') ? 'Critical' : getStatusColor(item).includes('orange') ? 'Warning' : 'Good') }
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button
                  onClick={() => onEdit(item)}
                  className="text-green-600 hover:text-green-900 mr-3"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onReorder ? onReorder(item) : alert('Reorder not available')}
                  className="text-blue-600 hover:text-blue-900 mr-3"
                >
                  Reorder
                </button>
                <button
                  onClick={() => onDelete(item.id)}
                  className="text-red-600 hover:text-red-900"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
