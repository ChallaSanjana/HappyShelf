import React from 'react';
import { InventoryItem } from '../../services/api';
import { getDaysLeft } from '../../utils/stock';

type Props = { items: InventoryItem[] };

/**
 * How much runway an item can have and still be worth recommending action on.
 *
 * Deliberately wider than LOW_STOCK_DAYS (3): this panel is a "plan your week"
 * nudge, not the low-stock alert, so it surfaces things that will need
 * attention soon rather than only what is already critical.
 */
const RECOMMENDATION_WINDOW_DAYS = 7;

const SmartRecommendations: React.FC<Props> = ({ items }) => {
  // Days of runway comes from the shared getDaysLeft rather than a local
  // `quantity / daily_usage` copy. Rounding happens before filtering (not
  // after) so the list and the "N days left" label always agree — an item
  // shown as "7 days left" is one that qualified as 7.
  const recs = items
    .map((item) => ({ item, daysLeft: Math.round(getDaysLeft(item)) }))
    .filter((rec) => rec.daysLeft <= RECOMMENDATION_WINDOW_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 6);

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Action-driven Recommendations</h4>
      {recs.length ? (
        <ul className="list-disc list-inside text-sm text-gray-700">
          {recs.map(({ item, daysLeft }) => (
            <li key={item.id}>
              {item.name} — {daysLeft} days left — <strong>Action:</strong> Consider reorder or
              reprioritize usage
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-gray-500">No urgent actions recommended.</div>
      )}
    </div>
  );
};

export default SmartRecommendations;
