'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface ModelUsage {
  model: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  message_count: number;
  run_count: number;
}

interface ModelUsageTableProps {
  data: ModelUsage[];
}

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export function ModelUsageTable({ data }: ModelUsageTableProps) {
  if (!data || data.length === 0) {
    return (
      <div className="card animate-fade-in">
        <div className="panel-header">
          <h2 className="text-sm font-semibold text-foreground">Token Usage by Model</h2>
        </div>
        <div className="panel-body">
          <div className="text-center py-8 text-muted-foreground text-sm">
            No model usage data found
          </div>
        </div>
      </div>
    );
  }

  const totalTokens = data.reduce((sum, m) => sum + m.total_tokens, 0);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Chart */}
      <div className="card">
        <div className="panel-header">
          <h2 className="text-sm font-semibold text-foreground">Token Usage by Model</h2>
        </div>
        <div className="panel-body">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="model"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  angle={-20}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => (value / 1000).toFixed(0) + 'k'}
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
                  formatter={(value: number) => [value.toLocaleString(), 'Tokens']}
                />
                <Bar dataKey="total_tokens" radius={[4, 4, 0, 0]}>
                  {data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Model</th>
                <th className="text-right">Total</th>
                <th className="text-right">Prompt</th>
                <th className="text-right">Completion</th>
                <th className="text-right">Messages</th>
                <th className="text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {data.map((model, index) => (
                <tr key={model.model}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span 
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0" 
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="font-medium text-foreground">{model.model}</span>
                    </div>
                  </td>
                  <td className="text-right font-mono text-sm text-foreground">
                    {model.total_tokens.toLocaleString()}
                  </td>
                  <td className="text-right font-mono text-sm text-muted-foreground">
                    {model.prompt_tokens.toLocaleString()}
                  </td>
                  <td className="text-right font-mono text-sm text-muted-foreground">
                    {model.completion_tokens.toLocaleString()}
                  </td>
                  <td className="text-right font-mono text-sm text-muted-foreground">
                    {model.message_count}
                  </td>
                  <td className="text-right font-mono text-sm text-muted-foreground">
                    {((model.total_tokens / totalTokens) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/50">
                <td className="font-semibold text-foreground">Total</td>
                <td className="text-right font-mono text-sm font-semibold text-foreground">
                  {totalTokens.toLocaleString()}
                </td>
                <td className="text-right font-mono text-sm font-semibold text-muted-foreground">
                  {data.reduce((sum, m) => sum + m.prompt_tokens, 0).toLocaleString()}
                </td>
                <td className="text-right font-mono text-sm font-semibold text-muted-foreground">
                  {data.reduce((sum, m) => sum + m.completion_tokens, 0).toLocaleString()}
                </td>
                <td className="text-right font-mono text-sm font-semibold text-muted-foreground">
                  {data.reduce((sum, m) => sum + m.message_count, 0)}
                </td>
                <td className="text-right font-mono text-sm font-semibold text-muted-foreground">
                  100%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
