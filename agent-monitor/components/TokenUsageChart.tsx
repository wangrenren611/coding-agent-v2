'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface DailyStats {
  date: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  run_count: number;
}

interface TokenUsageChartProps {
  data: DailyStats[];
}

export function TokenUsageChart({ data }: TokenUsageChartProps) {
  const formattedData = data.map(d => ({
    ...d,
    date: new Date(d.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
  }));

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">Token Usage (Last 7 Days)</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={formattedData}>
            <defs>
              <linearGradient id="colorPrompt" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorCompletion" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickFormatter={value => (value / 1000).toFixed(0) + 'k'}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--muted))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 'var(--radius)',
              }}
              labelStyle={{ color: 'hsl(var(--foreground))' }}
              formatter={(value: number) => value.toLocaleString()}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="prompt_tokens"
              name="Prompt Tokens"
              stroke="#3b82f6"
              fillOpacity={1}
              fill="url(#colorPrompt)"
            />
            <Area
              type="monotone"
              dataKey="completion_tokens"
              name="Completion Tokens"
              stroke="#8b5cf6"
              fillOpacity={1}
              fill="url(#colorCompletion)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
