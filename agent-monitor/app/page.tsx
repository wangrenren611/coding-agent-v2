'use client';

import { useEffect, useState } from 'react';
import { StatCards } from '@/components/StatCards';
import { RunTable } from '@/components/RunTable';
import { TokenUsageChart } from '@/components/TokenUsageChart';
import { ModelUsageTable } from '@/components/ModelUsageTable';
import { ErrorList } from '@/components/ErrorList';
import { RunDetail } from '@/components/RunDetail';
import { RefreshCw } from 'lucide-react';

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
      const [statsRes, runsRes, dailyRes, errorsRes, modelsRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/runs?limit=50'),
        fetch('/api/stats?type=daily&days=7'),
        fetch('/api/errors?limit=10'),
        fetch('/api/models'),
      ]);

      const statsData = await statsRes.json();
      const runsData = await runsRes.json();
      const dailyData = await dailyRes.json();
      const errorsData = await errorsRes.json();
      const modelsData = await modelsRes.json();

      setStats(statsData.aggregate || null);
      setRuns(runsData.runs || []);
      setDailyUsage(dailyData.daily || []);
      setErrors(errorsData.logs || []);
      setModelUsage(modelsData.byModel || []);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Agent Monitor</h1>
            <p className="text-muted-foreground mt-1">
              Agent DB Dashboard • Last refreshed: {lastRefresh.toLocaleTimeString()}
            </p>
          </div>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="space-y-6">
        {/* Stats Overview */}
        {stats && <StatCards stats={stats} />}

        {/* Token Usage Chart */}
        {dailyUsage && dailyUsage.length > 0 && <TokenUsageChart data={dailyUsage} />}

        {/* Model Usage Statistics */}
        {modelUsage && modelUsage.length > 0 && <ModelUsageTable data={modelUsage} />}

        {/* Two Column Layout */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Run Table - Takes 2 columns */}
          <div className="lg:col-span-2">
            <RunTable runs={runs} onSelectRun={setSelectedRun} />
          </div>

          {/* Error List - Takes 1 column */}
          <div>
            <ErrorList errors={errors} />
          </div>
        </div>
      </main>

      {/* Run Detail Modal */}
      {selectedRun && <RunDetail executionId={selectedRun} onClose={() => setSelectedRun(null)} />}
    </div>
  );
}
