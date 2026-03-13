'use client';

import { Activity, CheckCircle, XCircle, AlertCircle, Clock, Cpu } from 'lucide-react';

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
      value: stats.total_runs.toLocaleString(),
      icon: Activity,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      label: 'Running',
      value: stats.running_runs,
      icon: Clock,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      pulse: stats.running_runs > 0,
    },
    {
      label: 'Completed',
      value: stats.completed_runs.toLocaleString(),
      icon: CheckCircle,
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-500/10',
    },
    {
      label: 'Failed',
      value: stats.failed_runs,
      icon: XCircle,
      color: 'text-destructive',
      bgColor: 'bg-destructive/10',
    },
    {
      label: 'Total Tokens',
      value: formatTokens(stats.total_tokens),
      icon: Cpu,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
    },
    {
      label: 'Errors',
      value: stats.total_errors,
      icon: AlertCircle,
      color: 'text-destructive',
      bgColor: 'bg-destructive/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {statItems.map((item, index) => (
        <div 
          key={item.label} 
          className="stat-card animate-fade-in"
          style={{ animationDelay: `${index * 40}ms` }}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <div className={`p-1.5 rounded-md ${item.bgColor}`}>
              <item.icon className={`w-4 h-4 ${item.color} ${item.pulse ? 'animate-pulse' : ''}`} />
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              {item.label}
            </span>
          </div>
          <p className="text-2xl font-bold text-foreground tracking-tight">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return (tokens / 1_000_000).toFixed(1) + 'M';
  }
  if (tokens >= 1_000) {
    return (tokens / 1_000).toFixed(1) + 'K';
  }
  return tokens.toString();
}
