'use client';

import { Activity, CheckCircle, XCircle, AlertCircle, Clock, TrendingUp } from 'lucide-react';

interface AggregateStats {
  total_runs: number;
  running_runs: number;
  completed_runs: number;
  failed_runs: number;
  cancelled_runs: number;
  total_tokens: number;
  avg_duration_ms: number;
  total_errors: number;
}

interface StatCardsProps {
  stats: AggregateStats;
}

export function StatCards({ stats }: StatCardsProps) {
  const statItems = [
    {
      label: 'Total Runs',
      value: stats.total_runs,
      icon: Activity,
      color: 'text-blue-400',
      bgColor: 'bg-blue-400/10',
    },
    {
      label: 'Running',
      value: stats.running_runs,
      icon: Clock,
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-400/10',
    },
    {
      label: 'Completed',
      value: stats.completed_runs,
      icon: CheckCircle,
      color: 'text-green-400',
      bgColor: 'bg-green-400/10',
    },
    {
      label: 'Failed',
      value: stats.failed_runs,
      icon: XCircle,
      color: 'text-red-400',
      bgColor: 'bg-red-400/10',
    },
    {
      label: 'Total Tokens',
      value: stats.total_tokens.toLocaleString(),
      icon: TrendingUp,
      color: 'text-purple-400',
      bgColor: 'bg-purple-400/10',
    },
    {
      label: 'Errors',
      value: stats.total_errors,
      icon: AlertCircle,
      color: 'text-orange-400',
      bgColor: 'bg-orange-400/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {statItems.map(item => (
        <div key={item.label} className="stat-card">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${item.bgColor}`}>
              <item.icon className={`w-5 h-5 ${item.color}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-xl font-bold">{item.value}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
