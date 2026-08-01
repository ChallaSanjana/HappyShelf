import { useState } from 'react';
import { InventoryItem } from '../services/api';
import { AlertTriangle, Calendar, PackageX } from 'lucide-react';
import { formatExpiryLabel } from '../utils/expiry';
import { getDaysLeft, getSurplusAtExpiry, getWasteRiskRatio } from '../utils/stock';

interface AlertCardProps {
  title: string;
  items: InventoryItem[];
  type: 'stock' | 'expiry' | 'waste';
}

export const AlertCard = ({ title, items, type }: AlertCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const getItemDescription = (item: InventoryItem) => {
    if (type === 'stock') {
      if ((item.quantity ?? 0) <= 0) return 'Out of stock';
      // getDaysLeft returns Infinity for an item that is never consumed, which
      // has no meaningful "days remaining" to show.
      const daysLeft = getDaysLeft(item);
      return Number.isFinite(daysLeft) ? `${daysLeft.toFixed(1)} days remaining` : 'N/A days remaining';
    }
    if (type === 'waste') {
      // The useful number is how much is projected to go unused, not the
      // date or the runway — both of those look fine for these items.
      const surplus = Math.round(getSurplusAtExpiry(item) * 10) / 10;
      const pct = Math.round(getWasteRiskRatio(item) * 100);
      return `~${surplus} ${item.unit} (${pct}%) may go unused`;
    }
    // formatExpiryLabel correctly handles items that are already past their
    // expiry date ("Expired 3 days ago") instead of showing a nonsensical
    // negative day count like "Expires in -3 days".
    return formatExpiryLabel(item.expiry_date);
  };

  const Icon = type === 'stock' ? AlertTriangle : type === 'waste' ? PackageX : Calendar;
  const bgColor = type === 'stock' ? 'bg-orange-50' : type === 'waste' ? 'bg-amber-50' : 'bg-red-50';
  const borderColor = type === 'stock' ? 'border-orange-200' : type === 'waste' ? 'border-amber-200' : 'border-red-200';
  const iconColor = type === 'stock' ? 'text-orange-600' : type === 'waste' ? 'text-amber-600' : 'text-red-600';

  return (
    <div className={`${bgColor} border ${borderColor} rounded-xl p-6`}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className={`w-5 h-5 ${iconColor}`} />
        <h3 className="font-semibold text-gray-800">{title}</h3>
      </div>
      <div className="space-y-3">
        {(expanded ? items : items.slice(0, 5)).map((item) => (
          <div key={item.id} className="flex justify-between items-center">
            <div>
              <p className="font-medium text-gray-800">{item.name}</p>
              <p className="text-sm text-gray-600">{item.category}</p>
            </div>
            <p className={`text-sm font-medium ${iconColor}`}>{getItemDescription(item)}</p>
          </div>
        ))}
        {items.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-sm text-gray-600 pt-2 hover:underline hover:text-gray-800"
          >
            {expanded ? 'Show less' : `+${items.length - 5} more item${items.length - 5 !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>
    </div>
  );
};