import { useState, useEffect } from 'react';
import { InventoryItem } from '../services/api';
import { X } from 'lucide-react';

const CATEGORIES = [
  'Food',
  'Beverages',
  'Dairy',
  'Meat',
  'Produce',
  'Bakery',
  'Frozen',
  'Snacks',
  'Cleaning',
  'Personal Care',
  'Supplies',
  'Other',
];

interface ItemModalProps {
  item: InventoryItem | null;
  onSave: (item: Partial<InventoryItem>) => Promise<void>;
  onClose: () => void;
}

export const ItemModal = ({ item, onSave, onClose }: ItemModalProps) => {
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    quantity: '',
    daily_usage: '',
    expiry_date: '',
    unit: 'pcs',
    purchase_date: '',
    min_stock_level: '',
    storage_location: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return '';
      return d.toISOString().substring(0, 10);
    } catch {
      return '';
    }
  };

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name,
        category: item.category,
        quantity: item.quantity.toString(),
        daily_usage: item.daily_usage.toString(),
        expiry_date: formatDate(item.expiry_date),
        unit: item.unit || 'pcs',
        purchase_date: formatDate(item.purchase_date),
        min_stock_level: item.min_stock_level ? item.min_stock_level.toString() : '',
        storage_location: item.storage_location || '',
      });
    }
  }, [item]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const quantityVal = parseInt(formData.quantity, 10);
    const dailyUsageVal = parseFloat(formData.daily_usage);

    // Validate Quantity and Daily Usage are positive
    if (Number.isNaN(quantityVal) || quantityVal <= 0) {
      setError('Quantity must be a positive number greater than 0.');
      setIsLoading(false);
      return;
    }

    if (Number.isNaN(dailyUsageVal) || dailyUsageVal <= 0) {
      setError('Daily Usage must be a positive number greater than 0.');
      setIsLoading(false);
      return;
    }

    // Minimum Stock <= Quantity
    let minStockVal: number | null = null;
    if (formData.min_stock_level !== '') {
      minStockVal = parseInt(formData.min_stock_level, 10);
      if (Number.isNaN(minStockVal) || minStockVal < 0) {
        setError('Minimum Stock Level must be a non-negative number.');
        setIsLoading(false);
        return;
      }
      if (minStockVal > quantityVal) {
        setError('Minimum Stock Level cannot exceed Quantity.');
        setIsLoading(false);
        return;
      }
    }

    // Purchase Date not in the future
    if (formData.purchase_date) {
      const purchaseDateObj = new Date(formData.purchase_date);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (purchaseDateObj > today) {
        setError('Purchase Date cannot be in the future.');
        setIsLoading(false);
        return;
      }
    }

    // Expiry Date is after Purchase Date
    if (formData.expiry_date && formData.purchase_date) {
      if (new Date(formData.expiry_date) <= new Date(formData.purchase_date)) {
        setError('Expiry Date must be after the Purchase Date.');
        setIsLoading(false);
        return;
      }
    }

    // Per-category Expiry Date checks
    const isPerishableCategory = !['Cleaning', 'Personal Care'].includes(formData.category);
    if (isPerishableCategory && !formData.expiry_date) {
      setError('Expiry Date is required for the selected category.');
      setIsLoading(false);
      return;
    }

    try {
      await onSave({
        name: formData.name,
        category: formData.category,
        quantity: quantityVal,
        daily_usage: dailyUsageVal,
        expiry_date: formData.expiry_date || null,
        unit: formData.unit as InventoryItem['unit'],
        purchase_date: formData.purchase_date || null,
        min_stock_level: minStockVal,
        storage_location: formData.storage_location || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">
            {item ? 'Edit Item' : 'Add New Item'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Item Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Organic Milk"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category *
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none bg-white"
                required
              >
                <option value="">Select a category</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Unit *
              </label>
              <select
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none bg-white"
                required
              >
                <option value="pcs">pcs</option>
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="L">L</option>
                <option value="ml">ml</option>
                <option value="packs">packs</option>
                <option value="bottles">bottles</option>
                <option value="boxes">boxes</option>
                <option value="other">other</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quantity *
              </label>
              <input
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                placeholder="e.g., 5"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                min="1"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Daily Usage ({formData.unit}/day) *
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.daily_usage}
                onChange={(e) => setFormData({ ...formData, daily_usage: e.target.value })}
                placeholder="e.g., 0.5"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                min="0.1"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Minimum Stock
              </label>
              <input
                type="number"
                value={formData.min_stock_level}
                onChange={(e) => setFormData({ ...formData, min_stock_level: e.target.value })}
                placeholder="e.g., 1"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Storage Location
              </label>
              <input
                type="text"
                value={formData.storage_location}
                onChange={(e) => setFormData({ ...formData, storage_location: e.target.value })}
                placeholder="e.g., Pantry Shelf A"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Purchase Date
              </label>
              <input
                type="date"
                value={formData.purchase_date}
                onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Expiry Date {!['Cleaning', 'Personal Care'].includes(formData.category) && '*'}
              </label>
              <input
                type="date"
                value={formData.expiry_date}
                onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                required={!['Cleaning', 'Personal Care'].includes(formData.category)}
              />
            </div>
          </div>

          {['Cleaning', 'Personal Care'].includes(formData.category) && (
            <div className="text-xs text-gray-500 mt-1 italic">
              Expiry date is optional for cleaning products and personal care items.
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
