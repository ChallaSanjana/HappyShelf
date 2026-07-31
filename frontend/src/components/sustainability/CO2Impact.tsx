import React from 'react';
import { InventoryItem, ConsumptionHistoryEntry } from '../../services/api';
import { SimpleLineChart } from '../charts/SimpleChart';
import { buildWeekBuckets, bucketRecords, hasAnyData } from '../../utils/history';
import { getConsumedCO2, getItemWasteCO2, isWasted } from '../../utils/sustainability';

type Props = { items: InventoryItem[]; consumptionHistory: ConsumptionHistoryEntry[] };

const WEEKS_SHOWN = 8;

/**
 * CO2e avoided per week by actually using stock, plus the CO2e currently at
 * risk from waste.
 *
 * The old chart plotted `totalWastedCO2 * (0.6 + i * 0.1)` over five week
 * labels — a fixed upward ramp derived from a single present-day snapshot,
 * implying a history that was never recorded. Waste events aren't logged, but
 * *consumption* is, and consumed stock is precisely the stock that didn't get
 * thrown away — so the avoided-emissions series is real data. Current waste
 * is shown as a figure rather than a fake trend.
 */
const CO2Impact: React.FC<Props> = ({ items, consumptionHistory }) => {
  const buckets = bucketRecords(
    buildWeekBuckets(WEEKS_SHOWN),
    consumptionHistory || [],
    getConsumedCO2
  );

  const wastedItems = (items || []).filter(isWasted);
  const wastedCO2 = wastedItems.reduce((sum, item) => sum + getItemWasteCO2(item), 0);

  if (!hasAnyData(buckets)) {
    return (
      <div>
        <h4 className="text-md font-medium mb-3">CO₂ Impact (kg)</h4>
        <div className="flex items-center justify-center h-[140px] border border-dashed border-gray-200 rounded-lg text-sm text-gray-500 text-center px-4">
          {wastedCO2 > 0
            ? `No consumption recorded yet. Around ${wastedCO2.toFixed(1)} kg CO₂e is currently at risk from expired or out-of-stock items.`
            : 'No consumption recorded yet — use the “Consume” action and your avoided emissions will appear here.'}
        </div>
      </div>
    );
  }

  const totalAvoided = buckets.reduce((sum, bucket) => sum + bucket.value, 0);

  return (
    <div>
      <h4 className="text-md font-medium mb-3">CO₂ Impact (kg)</h4>
      <SimpleLineChart
        labels={buckets.map((bucket) => bucket.label)}
        datasets={[
          {
            label: 'CO₂e Avoided (kg)',
            data: buckets.map((bucket) => Math.round(bucket.value * 10) / 10),
            borderColor: '#84cc16',
          },
        ]}
        height={140}
      />
      <div className="mt-2 text-sm text-gray-600">
        ~{totalAvoided.toFixed(1)} kg CO₂e avoided by using stock instead of wasting it.
        {wastedCO2 > 0 && (
          <span className="text-red-600">
            {' '}
            ~{wastedCO2.toFixed(1)} kg currently at risk from {wastedItems.length} expired or
            out-of-stock item{wastedItems.length === 1 ? '' : 's'}.
          </span>
        )}
      </div>
    </div>
  );
};

export default CO2Impact;
