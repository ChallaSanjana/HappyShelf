import { useEffect, useMemo, useRef, useState } from 'react';
import {
  inventoryApi,
  InventoryItem,
  ItemSearchResult,
  ItemSortField,
  SortOrder,
  StockStatusFilter,
  ExpiryStatusFilter,
} from '../services/api';
import { InventoryTable } from './InventoryTable';
import { Search, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface InventoryExplorerProps {
  allItems: InventoryItem[];
  onEdit: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
  onReorder?: (item: InventoryItem) => void;
  onConsume?: (item: InventoryItem) => void;
  readOnly?: boolean;
}

const SORT_OPTIONS: { value: ItemSortField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'price', label: 'Price' },
  { value: 'totalValue', label: 'Total Value' },
  { value: 'expiryDate', label: 'Expiry Date' },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const DEBOUNCE_MS = 350;

export const InventoryExplorer = ({ allItems, onEdit, onDelete, onReorder, onConsume, readOnly = false }: InventoryExplorerProps) => {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stockStatus, setStockStatus] = useState<StockStatusFilter | ''>('');
  const [expiryStatus, setExpiryStatus] = useState<ExpiryStatusFilter | ''>('');
  const [sortBy, setSortBy] = useState<ItemSortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const [result, setResult] = useState<ItemSearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const requestIdRef = useRef(0);

  // Debounce the free-text search so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const categoryOptions = useMemo(
    () => Array.from(new Set(allItems.map((item) => item.category))).sort((a, b) => a.localeCompare(b)),
    [allItems]
  );

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError('');

    inventoryApi
      .searchItems({
        search: debouncedSearch || undefined,
        category: category || undefined,
        stockStatus: stockStatus || undefined,
        expiryStatus: expiryStatus || undefined,
        sortBy,
        sortOrder,
        page,
        limit,
      })
      .then((data) => {
        if (requestId !== requestIdRef.current) return; // stale response, a newer request is in flight
        setResult(data);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load inventory');
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setIsLoading(false);
      });
    // allItems is included so this refetches after any add/edit/delete/reorder/consume
    // elsewhere on the Dashboard, keeping the current filtered/sorted page in sync.
  }, [debouncedSearch, category, stockStatus, expiryStatus, sortBy, sortOrder, page, limit, allItems]);

  const hasActiveFilters =
    searchInput !== '' || category !== '' || stockStatus !== '' || expiryStatus !== '' || sortBy !== 'name' || sortOrder !== 'asc';

  const handleFilterChange = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setCategory('');
    setStockStatus('');
    setExpiryStatus('');
    setSortBy('name');
    setSortOrder('asc');
    setPage(1);
  };

  const totalPages = result?.totalPages ?? 1;
  const total = result?.total ?? 0;

  return (
    <div>
      <div className="p-4 sm:p-6 border-b border-gray-200 bg-gray-50/60 space-y-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
              placeholder="Search by name, category, or storage location..."
              className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none text-sm"
            />
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput('');
                  setPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 whitespace-nowrap"
            >
              <X className="w-4 h-4" />
              Reset Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <select
            value={category}
            onChange={(e) => handleFilterChange(() => setCategory(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
          >
            <option value="">All Categories</option>
            {categoryOptions.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            value={stockStatus}
            onChange={(e) => handleFilterChange(() => setStockStatus(e.target.value as StockStatusFilter | ''))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
          >
            <option value="">All Stock Statuses</option>
            <option value="healthy">Healthy</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>

          <select
            value={expiryStatus}
            onChange={(e) => handleFilterChange(() => setExpiryStatus(e.target.value as ExpiryStatusFilter | ''))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
          >
            <option value="">All Expiry Statuses</option>
            <option value="expired">Expired</option>
            <option value="expiring_soon">Expiring Soon</option>
            <option value="healthy">Healthy</option>
            <option value="none">No Expiry Date</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => handleFilterChange(() => setSortBy(e.target.value as ItemSortField))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort: {opt.label}
              </option>
            ))}
          </select>

          <select
            value={sortOrder}
            onChange={(e) => handleFilterChange(() => setSortOrder(e.target.value as SortOrder))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>

          <select
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="m-4 sm:m-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
            <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
          </div>
        )}

        {allItems.length > 0 && result && result.items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No items match your current filters.{' '}
            <button onClick={handleResetFilters} className="text-green-600 hover:text-green-700 font-medium underline">
              Reset filters
            </button>
          </div>
        ) : (
          <InventoryTable
            items={result?.items ?? []}
            onEdit={onEdit}
            onDelete={onDelete}
            onReorder={onReorder}
            onConsume={onConsume}
            readOnly={readOnly}
          />
        )}
      </div>

      {result && result.items.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 py-4 border-t border-gray-200 text-sm text-gray-600">
          <div>
            Showing {(result.page - 1) * result.limit + 1}
            {'–'}
            {Math.min(result.page * result.limit, total)} of {total} item{total !== 1 ? 's' : ''}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
            >
              <ChevronLeft className="w-4 h-4" />
              Prev
            </button>
            <span className="px-2">
              Page {result.page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
