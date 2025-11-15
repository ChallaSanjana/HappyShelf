import React from 'react';
import { InventoryItem, Stats } from '../services/api';

interface Activity {
  id: string | number;
  title: string;
  desc?: string;
  status: 'pending' | 'acknowledged' | 'completed';
  time: string;
}

interface Props {
  items: InventoryItem[];
  stats?: Stats | null;
}

export const RecentActivity: React.FC<Props> = ({ items, stats }) => {
  const activities: Activity[] = [];

  // Low stock items (days left < 3)
  const low = items
    .map((it) => ({
      item: it,
      daysLeft: it.daily_usage > 0 ? it.quantity / it.daily_usage : Infinity,
    }))
    .filter((x) => x.daysLeft < 3)
    .slice(0, 5);

  low.forEach((l) => {
    activities.push({
      id: `low-${l.item.id}`,
      title: `${l.item.name} reorder suggested`,
      desc: `Stock will run out in ${Math.ceil(l.daysLeft)} days. Recommended order: ${Math.max(1, Math.ceil(l.item.quantity || 0))} units.`,
      status: 'pending',
      time: `${Math.max(1, Math.ceil(l.daysLeft))} days left`,
    });
  });

  // Expiring soon (within 7 days)
  const expiring = items
    .filter((it) => it.expiry_date)
    .map((it) => ({
      item: it,
      daysToExpiry: Math.ceil((new Date(it.expiry_date!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    }))
    .filter((x) => x.daysToExpiry >= 0 && x.daysToExpiry < 7)
    .slice(0, 5);

  expiring.forEach((e) => {
    activities.push({
      id: `exp-${e.item.id}`,
      title: `${e.item.name} expiring soon`,
      desc: `Expires in ${e.daysToExpiry} day${e.daysToExpiry === 1 ? '' : 's'}`,
      status: 'pending',
      time: `${e.daysToExpiry} days`,
    });
  });

  // A summary activity using stats
  if (stats) {
    activities.push({
      id: 'summary',
      title: 'Inventory summary updated',
      desc: `Total items: ${stats.totalItems}. Critical: ${stats.lowStockItems}. Expiring soon: ${stats.expiringSoon}.`,
      status: 'completed',
      time: 'just now',
    });
  }

  // Sort: pending first, then acknowledged, then completed
  activities.sort((a, b) => {
    const order = { pending: 0, acknowledged: 1, completed: 2 } as const;
    return order[a.status] - order[b.status];
  });

  if (activities.length === 0) {
    return <div className="text-gray-600">No recent activity</div>;
  }

  return (
    <div className="space-y-4">
      {activities.map((a) => (
        <div key={a.id} className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                a.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : a.status === 'acknowledged' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
              }`}
            >
              {a.status === 'pending' ? '!' : a.status === 'acknowledged' ? 'i' : '✓'}
            </div>
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-800">{a.title}</h4>
              <span className="text-xs text-gray-500">{a.time}</span>
            </div>
            {a.desc && <p className="text-sm text-gray-600">{a.desc}</p>}
          </div>
        </div>
      ))}
    </div>
  );
};
