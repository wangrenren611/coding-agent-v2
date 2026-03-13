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
    <div className="card animate-fade-in">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-foreground">Token Usage</h2>
        <span className="text-xs text-muted-foreground">Last 7 days</span>
      </div>
      <div className="panel-body">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={formattedData}>
              <defs>
                <linearGradient id="colorPrompt" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorCompletion" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis 
                dataKey="date" 
                stroke="var(--muted-foreground)" 
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={value => (value / 1000).toFixed(0) + 'k'}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  fontSize: '0.875rem',
                  boxShadow: '0 4px 6px -1px oklch(0 0 0 / 0.1)',
                }}
                labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
                itemStyle={{ color: 'var(--muted-foreground)' }}
              />
              <Legend 
                wrapperStyle={{ fontSize: '0.75rem', paddingTop: '0.5rem' }}
              />
              <Area
                type="monotone"
                dataKey="prompt_tokens"
                name="Prompt"
                stroke="var(--chart-2)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorPrompt)"
              />
              <Area
                type="monotone"
                dataKey="completion_tokens"
                name="Completion"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorCompletion)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
