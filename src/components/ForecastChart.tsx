import React, { useMemo } from 'react';
import { InventoryItem } from '../services/api';
import {
  Chart as ChartJS,
  ChartData,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface Props {
  items: InventoryItem[];
}

export const ForecastChart: React.FC<Props> = ({ items }) => {
  // Aggregate current total stock and daily usage to build a simple forecast
  const { labels, actualData, predictedData } = useMemo(() => {
    const totalNow = items.reduce((s, it) => s + (it.quantity || 0), 0);
    const totalDailyUsage = items.reduce((s, it) => s + (it.daily_usage || 0), 0);

    const days = 14; // show two-week forecast
    const labels = Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });

    // actual: show current total for first 3 points, then nulls to let predicted line continue
    const actualData: (number | null)[] = Array.from({ length: days }, (_, i) => (i < 3 ? totalNow : null));

    const predictedData = labels.map((_, i) => {
      const day = i;
      const predicted = Math.max(0, totalNow - totalDailyUsage * day);
      return Number(predicted.toFixed(2));
    });

    return { labels, actualData, predictedData };
  }, [items]);

  const data: ChartData<'line', (number | null)[], string> = {
    labels,
    datasets: [
      {
        label: 'Actual Stock',
        data: actualData as (number | null)[],
        borderColor: '#0ea5e9',
        backgroundColor: 'rgba(14,165,233,0.1)',
        tension: 0.2,
        pointRadius: 3,
        spanGaps: true,
      },
      {
        label: 'Predicted Stock',
        data: predictedData as number[],
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,0.05)',
        tension: 0.2,
        pointRadius: 0,
        fill: true,
      },
      {
        label: 'Reorder Threshold',
        data: Array(labels.length).fill(50) as number[],
        borderColor: '#f97373',
        borderWidth: 1,
        borderDash: [6, 6],
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' as const },
      tooltip: { mode: 'index' as const, intersect: false },
      // custom plugin will draw the threshold label near the right edge
      thresholdLabel: {
        display: true,
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true },
    },
  };
  return (
    <div className="w-full h-72">
      <Line
        data={data}
        options={options}
        plugins={[
          {
            id: 'thresholdLabel',
            afterDraw: (chart) => {
              try {
                const ctx = chart.ctx;
                const datasets = chart.data.datasets || [];
                const idx = datasets.findIndex((d: any) => d.label === 'Reorder Threshold');
                if (idx === -1) return;
                const meta = chart.getDatasetMeta(idx);
                if (!meta || !meta.data || meta.data.length === 0) return;
                // draw label at right edge of the chart area
                const lastPoint = meta.data[meta.data.length - 1];
                const x = chart.chartArea.right - 6;
                const y = lastPoint.y;
                ctx.save();
                ctx.fillStyle = '#b91c1c';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText('Reorder Threshold', x, y - 8);
                ctx.restore();
              } catch (e) {
                // swallow draw errors to avoid breaking the chart
              }
            },
          },
        ]}
      />
    </div>
  );
};
