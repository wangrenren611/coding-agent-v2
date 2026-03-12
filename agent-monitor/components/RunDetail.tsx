'use client';

import { useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { X, Clock, Hash, AlertCircle, CheckCircle, Activity } from 'lucide-react';

interface Run {
  execution_id: string;
  run_id: string;
  conversation_id: string;
  status: string;
  created_at_ms: number;
  updated_at_ms: number;
  step_index: number;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  terminal_reason: string | null;
  error_code: string | null;
  error_category: string | null;
  error_message: string | null;
}

interface RunStats {
  execution_id: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  duration_ms: number;
  message_count: number;
  tool_call_count: number;
}

interface RunLog {
  id: number;
  step_index: number | null;
  level: string;
  source: string;
  message: string;
  error_json: string | null;
  created_at_ms: number;
}

interface RunDetailProps {
  executionId: string;
  onClose: () => void;
}

export function RunDetail({ executionId, onClose }: RunDetailProps) {
  const [run, setRun] = useState<Run | null>(null);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logFilter, setLogFilter] = useState<string>('all');

  useEffect(() => {
    async function fetchRunDetail() {
      try {
        const [runRes, logsRes] = await Promise.all([
          fetch(`/api/runs?execution_id=${executionId}`),
          fetch(`/api/logs?execution_id=${executionId}&limit=100`),
        ]);

        const runData = await runRes.json();
        const logsData = await logsRes.json();

        setRun(runData.run);
        setStats(runData.stats);
        setLogs(logsData.logs);
      } catch (error) {
        console.error('Error fetching run detail:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchRunDetail();
  }, [executionId]);

  const filteredLogs = logs.filter(log => logFilter === 'all' || log.level === logFilter);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <div className="card">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!run) {
    return null;
  }

  const duration = stats?.duration_ms || 0;
  const durationStr =
    duration > 0
      ? `${(duration / 1000).toFixed(1)}s`
      : run.started_at_ms
        ? `${formatDistanceToNow(run.started_at_ms)} running`
        : 'N/A';

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-background w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-lg border border-border flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Run Details</h2>
            <p className="text-sm font-mono text-muted-foreground">{run.execution_id}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Status & Basic Info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="stat-card">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Status</span>
              </div>
              <span
                className={`badge ${
                  run.status === 'RUNNING'
                    ? 'badge-running'
                    : run.status === 'COMPLETED'
                      ? 'badge-completed'
                      : run.status === 'FAILED'
                        ? 'badge-failed'
                        : 'badge-cancelled'
                }`}
              >
                {run.status}
              </span>
            </div>

            <div className="stat-card">
              <div className="flex items-center gap-2 mb-2">
                <Hash className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Steps</span>
              </div>
              <p className="text-xl font-bold">{run.step_index}</p>
            </div>

            <div className="stat-card">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Duration</span>
              </div>
              <p className="text-xl font-bold">{durationStr}</p>
            </div>

            <div className="stat-card">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Messages</span>
              </div>
              <p className="text-xl font-bold">{stats?.message_count || 0}</p>
            </div>
          </div>

          {/* Token Stats */}
          {stats && (
            <div className="card">
              <h3 className="font-semibold mb-3">Token Usage</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Prompt</p>
                  <p className="text-lg font-mono">{stats.prompt_tokens.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Completion</p>
                  <p className="text-lg font-mono">{stats.completion_tokens.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-lg font-mono text-purple-400">
                    {stats.total_tokens.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Info */}
          {run.error_code && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-5 h-5 text-red-400" />
                <span className="font-semibold text-red-400">Error</span>
              </div>
              <p className="font-mono text-sm text-red-300">{run.error_code}</p>
              {run.error_message && (
                <p className="text-sm text-red-400 mt-1">{run.error_message}</p>
              )}
            </div>
          )}

          {/* Timestamps */}
          <div className="card">
            <h3 className="font-semibold mb-3">Timestamps</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span className="font-mono">
                  {format(run.created_at_ms, 'yyyy-MM-dd HH:mm:ss.SSS')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Started</span>
                <span className="font-mono">
                  {run.started_at_ms ? format(run.started_at_ms, 'yyyy-MM-dd HH:mm:ss.SSS') : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Completed</span>
                <span className="font-mono">
                  {run.completed_at_ms
                    ? format(run.completed_at_ms, 'yyyy-MM-dd HH:mm:ss.SSS')
                    : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Updated</span>
                <span className="font-mono">
                  {format(run.updated_at_ms, 'yyyy-MM-dd HH:mm:ss.SSS')}
                </span>
              </div>
            </div>
          </div>

          {/* Logs */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Logs</h3>
              <select
                value={logFilter}
                onChange={e => setLogFilter(e.target.value)}
                className="px-3 py-1 bg-muted border border-border rounded-md text-sm"
              >
                <option value="all">All Levels</option>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
              {filteredLogs.map(log => (
                <div
                  key={log.id}
                  className={`p-2 rounded ${
                    log.level === 'error'
                      ? 'bg-red-500/10'
                      : log.level === 'warn'
                        ? 'bg-yellow-500/10'
                        : 'hover:bg-accent/50'
                  }`}
                >
                  <span className="text-muted-foreground">
                    [{format(log.created_at_ms, 'HH:mm:ss.SSS')}]
                  </span>{' '}
                  <span
                    className={`${
                      log.level === 'error'
                        ? 'text-red-400'
                        : log.level === 'warn'
                          ? 'text-yellow-400'
                          : 'text-blue-400'
                    }`}
                  >
                    {log.level.toUpperCase()}
                  </span>{' '}
                  <span className="text-purple-400">[{log.source}]</span> <span>{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
