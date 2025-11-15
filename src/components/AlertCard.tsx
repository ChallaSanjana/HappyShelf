import { InventoryItem } from '../services/api';
import { AlertTriangle, Calendar } from 'lucide-react';

interface AlertCardProps {
  title: string;
  items: InventoryItem[];
  type: 'stock' | 'expiry';
}

export const AlertCard = ({ title, items, type }: AlertCardProps) => {
  const getItemDescription = (item: InventoryItem) => {
    if (type === 'stock') {
      if ((item.quantity ?? 0) <= 0) return 'Out of stock';
      const daysLeft = item.daily_usage > 0 ? (item.quantity / item.daily_usage).toFixed(1) : 'N/A';
      return `${daysLeft} days remaining`;
    } else {
      const daysToExpiry = Math.ceil(
        (new Date(item.expiry_date!).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );
      return `Expires in ${daysToExpiry} day${daysToExpiry !== 1 ? 's' : ''}`;
    }
  };

  const Icon = type === 'stock' ? AlertTriangle : Calendar;
  const bgColor = type === 'stock' ? 'bg-orange-50' : 'bg-red-50';
  const borderColor = type === 'stock' ? 'border-orange-200' : 'border-red-200';
  const iconColor = type === 'stock' ? 'text-orange-600' : 'text-red-600';

  return (
    <div className={`${bgColor} border ${borderColor} rounded-xl p-6`}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className={`w-5 h-5 ${iconColor}`} />
        <h3 className="font-semibold text-gray-800">{title}</h3>
      </div>
      <div className="space-y-3">
        {items.slice(0, 5).map((item) => (
          <div key={item.id} className="flex justify-between items-center">
            <div>
              <p className="font-medium text-gray-800">{item.name}</p>
              <p className="text-sm text-gray-600">{item.category}</p>
            </div>
            <p className={`text-sm font-medium ${iconColor}`}>{getItemDescription(item)}</p>
          </div>
        ))}
        {items.length > 5 && (
          <p className="text-sm text-gray-600 pt-2">
            +{items.length - 5} more item{items.length - 5 !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
};
