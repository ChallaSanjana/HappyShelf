import React from 'react';
import { InventoryItem, ReorderHistoryEntry } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';
import {
  buildWeekBuckets,
  bucketRecords,
  hasAnyData,
  buildCostLookup,
  getReorderSpend,
} from '../../utils/history';

type Props = { items: InventoryItem[]; reorderHistory: ReorderHistoryEntry[] };

const WEEKS_SHOWN = 8;

/**
 * Actual restocking spend per week, from the reorder log.
 *
 * The previous version back-projected `quantity + daily_usage * daysAgo` and
 * labelled it "Week -4 … This Week", which assumed perfectly linear
 * consumption and that no restock had ever happened — so it drew a smooth
 * ramp that no household would ever produce. Every reorder is logged with a
 * quantity and a timestamp, which is what actual spend looks like.
 *
 * Reorders are valued at the item's *current* cost_per_unit: history rows
 * don't store the price paid, so this is an approximation, and it's stated as
 * one in the caption.
 */
const CostAnalytics: React.FC<Props> = ({ items, reorderHistory }) => {
  const costLookup = buildCostLookup(items || []);

  const buckets = bucketRecords(buildWeekBuckets(WEEKS_SHOWN), reorderHistory || [], (entry) =>
    getReorderSpend(entry, costLookup)
  );

  const itemsWithCost = (items || []).filter(
    (item) => item.cost_per_unit !== null && item.cost_per_unit !== undefined
  );
  const missingCostCount = (items || []).length - itemsWithCost.length;

  if (!hasAnyData(buckets)) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Restocking Spend</h4>
        <div className="flex items-center justify-center h-[180px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500 text-center px-4">
          {reorderHistory && reorderHistory.length > 0
            ? 'Reorders recorded, but none of those items have a cost per unit set — add one in Edit Item to see spend.'
            : 'No reorders recorded yet. Use the “Reorder” action and your spend will appear here.'}
        </div>
      </div>
    );
  }

  const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0);

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Restocking Spend</h4>
      <SimpleLineChart
        labels={buckets.map((bucket) => bucket.label)}
        datasets={[
          {
            label: 'Spend (₹)',
            data: buckets.map((bucket) => Math.round(bucket.value)),
            borderColor: '#EF4444',
          },
        ]}
        height={180}
      />
      <p className="mt-2 text-xs text-gray-500">
        ₹{Math.round(total).toLocaleString('en-IN')} across the last {WEEKS_SHOWN} weeks, valued at
        each item&apos;s current cost per unit.
        {missingCostCount > 0 &&
          ` ${missingCostCount} item${missingCostCount === 1 ? '' : 's'} ${missingCostCount === 1 ? 'has' : 'have'} no cost recorded and count as ₹0.`}
      </p>
    </div>
  );
};

export default CostAnalytics;
