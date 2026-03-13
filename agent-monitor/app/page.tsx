'use client';

import { useEffect, useState } from 'react';
import { StatCards } from '@/components/StatCards';
import { RunTable } from '@/components/RunTable';
import { TokenUsageChart } from '@/components/TokenUsageChart';
import { ModelUsageTable } from '@/components/ModelUsageTable';
import { ErrorList } from '@/components/ErrorList';
import { RunDetail } from '@/components/RunDetail';
import { RefreshCw, Activity } from 'lucide-react';

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

interface Run {
  execution_id: string;
  status: string;
  created_at_ms: number;
  step_index: number;
  terminal_reason: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface DailyStats {
  date: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  run_count: number;
}

interface ErrorLog {
  id: number;
  execution_id: string;
  step_index: number | null;
  level: string;
  code: string | null;
  source: string;
  message: string;
  error_json: string | null;
  created_at_ms: number;
}

interface ModelUsage {
  model: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  message_count: number;
  run_count: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<AggregateStats | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [dailyUsage, setDailyUsage] = useState<DailyStats[]>([]);
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  async function fetchData() {
    try {
      const [statsRes, runsRes, dailyRes, errorsRes, modelRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/runs?limit=50'),
        fetch('/api/stats?type=daily'),
        fetch('/api/errors?limit=10'),
        fetch('/api/stats?type=models'),
      ]);

      const statsData = await statsRes.json();
      const runsData = await runsRes.json();
      const dailyData = await dailyRes.json();
      const errorsData = await errorsRes.json();
      const modelData = await modelRes.json();

      setStats(statsData.stats);
      setRuns(runsData.runs);
      setDailyUsage(dailyData.daily_stats);
      setErrors(errorsData.errors);
      setModelUsage(modelData.model_usage);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
            <Activity className="w-6 h-6 text-primary animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">
            Loading dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                <Activity className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-foreground">
                  Agent Monitor
                </h1>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Database runs, errors & statistics
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground hidden md:block">
                Last sync: {lastRefresh.toLocaleTimeString('en-US', { hour12: false })}
              </span>
              <button onClick={fetchData} className="btn-secondary text-sm">
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
        {/* Stats Row */}
        {stats && <StatCards stats={stats} />}

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TokenUsageChart data={dailyUsage} />
          <ModelUsageTable data={modelUsage} />
        </div>

        {/* Table and Errors Row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            <RunTable runs={runs} onSelectRun={setSelectedRun} />
          </div>
          <div>
            <ErrorList errors={errors} />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-8">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Agent Monitor</span>
            <span>Auto-refresh: 30s</span>
          </div>
        </div>
      </footer>

      {/* Run Detail Modal */}
      {selectedRun && (
        <RunDetail executionId={selectedRun} onClose={() => setSelectedRun(null)} />
      )}
    </div>
  );
}
