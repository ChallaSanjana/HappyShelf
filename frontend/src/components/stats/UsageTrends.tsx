import React from 'react';
import { ConsumptionHistoryEntry } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';
import { buildMonthBuckets, bucketRecords, hasAnyData } from '../../utils/history';

type Props = { consumptionHistory: ConsumptionHistoryEntry[] };

const MONTHS_SHOWN = 6;

/**
 * Actual units consumed per month, from the consumption log.
 *
 * This chart used to be titled "(historical)" while plotting
 * `totalDailyUsage * 30 * (0.85 + Math.sin(i) * 0.1)` across a hardcoded
 * Jan–Jul axis — a fixed wave with no connection to anything the household
 * had done. Every "Consume" action is timestamped, so the real series was
 * available the whole time.
 */
const UsageTrends: React.FC<Props> = ({ consumptionHistory }) => {
  const buckets = bucketRecords(
    buildMonthBuckets(MONTHS_SHOWN),
    consumptionHistory || [],
    (entry) => entry.quantityConsumed
  );

  if (!hasAnyData(buckets)) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Usage Trends</h4>
        <div className="flex items-center justify-center h-[220px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500 text-center px-4">
          No consumption recorded yet. Use the “Consume” action on an item and your
          usage over time will appear here.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Usage Trends</h4>
      <SimpleLineChart
        labels={buckets.map((bucket) => bucket.label)}
        datasets={[
          {
            label: 'Units Consumed',
            data: buckets.map((bucket) => Math.round(bucket.value * 100) / 100),
            borderColor: '#10B981',
          },
        ]}
        height={220}
      />
      <p className="mt-2 text-xs text-gray-500">
        Actual units consumed per month, from your consumption log.
      </p>
    </div>
  );
};

export default UsageTrends;
