import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar, Pie } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

type BaseProps = {
  labels: string[];
  datasets: {
    label?: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string;
  }[];
  height?: number;
};

export const SimpleLineChart: React.FC<BaseProps> = ({ labels, datasets, height = 160 }) => {
  const data = { labels, datasets };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' as const } },
  };
  return (
    <div style={{ height }}>
      <Line data={data} options={options} />
    </div>
  );
};

export const SimpleBarChart: React.FC<BaseProps> = ({ labels, datasets, height = 160 }) => {
  const data = { labels, datasets };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' as const } },
  };
  return (
    <div style={{ height }}>
      <Bar data={data} options={options} />
    </div>
  );
};

export const SimplePieChart: React.FC<BaseProps> = ({ labels, datasets, height = 160 }) => {
  const data = { labels, datasets };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'right' as const } },
  };
  return (
    <div style={{ height }}>
      <Pie data={data} options={options} />
    </div>
  );
};

export default SimpleLineChart;
