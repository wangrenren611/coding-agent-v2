'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

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

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6'];

export function ModelUsageTable({ data }: ModelUsageTableProps) {
  if (!data || data.length === 0) {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Token Usage by Model</h2>
        <div className="text-center py-8 text-muted-foreground">
          No model usage data found
        </div>
      </div>
    );
  }

  const totalTokens = data.reduce((sum, m) => sum + m.total_tokens, 0);

  return (
    <div className="space-y-6">
      {/* Chart */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Token Usage by Model</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="model"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickFormatter={(value) => (value / 1000).toFixed(0) + 'k'}
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
              <Bar dataKey="total_tokens" name="Total Tokens" fill="#3b82f6">
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Detailed Statistics</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Model</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Total Tokens</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Prompt</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Completion</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Messages</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Runs</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">%</th>
              </tr>
            </thead>
            <tbody>
              {data.map((model, index) => (
                <tr key={model.model} className="border-b border-border hover:bg-accent/50">
                  <td className="py-3 px-4 font-mono text-sm">{model.model}</td>
                  <td className="py-3 px-4 text-right font-mono">
                    {model.total_tokens.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right text-sm text-muted-foreground">
                    {model.prompt_tokens.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right text-sm text-muted-foreground">
                    {model.completion_tokens.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right text-sm">{model.message_count}</td>
                  <td className="py-3 px-4 text-right text-sm">{model.run_count}</td>
                  <td className="py-3 px-4 text-right">
                    <span className="badge bg-primary/20 text-primary">
                      {((model.total_tokens / totalTokens) * 100).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-3 px-4">Total</td>
                <td className="py-3 px-4 text-right font-mono text-purple-400">
                  {totalTokens.toLocaleString()}
                </td>
                <td className="py-3 px-4 text-right text-sm"></td>
                <td className="py-3 px-4 text-right text-sm"></td>
                <td className="py-3 px-4 text-right text-sm">
                  {data.reduce((sum, m) => sum + m.message_count, 0).toLocaleString()}
                </td>
                <td className="py-3 px-4 text-right text-sm">
                  {data.reduce((sum, m) => sum + m.run_count, 0)}
                </td>
                <td className="py-3 px-4 text-right">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
