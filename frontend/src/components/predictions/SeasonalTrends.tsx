import React from 'react';
import { ConsumptionHistoryEntry } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';
import { buildMonthBuckets, bucketRecords, hasAnyData } from '../../utils/history';

type Props = { consumptionHistory: ConsumptionHistoryEntry[] };

const MONTHS_SHOWN = 12;

/** A year of history before month-to-month comparison means anything. */
const MONTHS_FOR_SEASONALITY = 12;

/**
 * Month-by-month consumption over the past year.
 *
 * Previously this plotted `base * (1 + Math.cos(i) * 0.3 + (i % 3) * 0.05)`
 * across all twelve months — a cosine wave that responded only to how many
 * items existed, and would have looked identical for a household that had
 * never consumed anything. Real seasonality needs real history, so when
 * there isn't enough of it this now says so instead of drawing a curve.
 */
const SeasonalTrends: React.FC<Props> = ({ consumptionHistory }) => {
  const buckets = bucketRecords(
    buildMonthBuckets(MONTHS_SHOWN),
    consumptionHistory || [],
    (entry) => entry.quantityConsumed
  );

  const monthsWithData = buckets.filter((bucket) => bucket.value > 0).length;

  if (!hasAnyData(buckets)) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">Seasonal Trends</h4>
        <div className="flex items-center justify-center h-[140px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500 text-center px-4">
          No consumption history yet — seasonal patterns appear once you have
          recorded usage across several months.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-md font-medium mb-3">Seasonal Trends</h4>
      <SimpleLineChart
        labels={buckets.map((bucket) => bucket.label)}
        datasets={[
          {
            label: 'Units Consumed',
            data: buckets.map((bucket) => Math.round(bucket.value * 100) / 100),
            borderColor: '#34d399',
          },
        ]}
        height={140}
      />
      <p className="mt-2 text-xs text-gray-500">
        {monthsWithData < MONTHS_FOR_SEASONALITY
          ? `Based on ${monthsWithData} month${monthsWithData === 1 ? '' : 's'} of recorded usage — not yet a full year, so treat seasonal comparisons cautiously.`
          : 'Actual units consumed per month over the past year.'}
      </p>
    </div>
  );
};

export default SeasonalTrends;
