'use client';

import { useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { X, AlertCircle, Activity, ChevronDown } from 'lucide-react';

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

interface MessageUsageRecord {
  message_id: string;
  step_index: number | null;
  role: string;
  type: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  created_at_ms: number;
}

interface RunDetailProps {
  executionId: string;
  onClose: () => void;
}

const MESSAGES_PAGE_SIZE = 20;
const LOGS_PAGE_SIZE = 50;

export function RunDetail({ executionId, onClose }: RunDetailProps) {
  const [run, setRun] = useState<Run | null>(null);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [messageRecords, setMessageRecords] = useState<MessageUsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [messageOffset, setMessageOffset] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [logsOffset, setLogsOffset] = useState(0);
  const [logFilter, setLogFilter] = useState<string>('all');

  async function fetchMessageRecords(offset: number, append: boolean) {
    setMessageLoading(true);
    try {
      const res = await fetch(
        `/api/messages?execution_id=${executionId}&limit=${MESSAGES_PAGE_SIZE + 1}&offset=${offset}`
      );
      const data = await res.json();

      const fetched = Array.isArray(data.records) ? data.records : [];
      const hasMore = fetched.length > MESSAGES_PAGE_SIZE;
      const pageData = fetched.slice(0, MESSAGES_PAGE_SIZE);

      setHasMoreMessages(hasMore);
      setMessageOffset(offset + pageData.length);
      setMessageRecords(prev => (append ? [...prev, ...pageData] : pageData));
    } catch (error) {
      console.error('Error fetching message usage records:', error);
      if (!append) {
        setMessageRecords([]);
      }
      setHasMoreMessages(false);
    } finally {
      setMessageLoading(false);
    }
  }

  async function fetchLogs(offset: number, append: boolean) {
    setLogsLoading(true);
    try {
      const res = await fetch(
        `/api/logs?execution_id=${executionId}&limit=${LOGS_PAGE_SIZE + 1}&offset=${offset}`
      );
      const data = await res.json();

      const fetched = Array.isArray(data.logs) ? data.logs : [];
      const hasMore = fetched.length > LOGS_PAGE_SIZE;
      const pageData = fetched.slice(0, LOGS_PAGE_SIZE);

      setHasMoreLogs(hasMore);
      setLogsOffset(offset + pageData.length);
      setLogs(prev => (append ? [...prev, ...pageData] : pageData));
    } catch (error) {
      console.error('Error fetching logs:', error);
      if (!append) {
        setLogs([]);
      }
      setHasMoreLogs(false);
    } finally {
      setLogsLoading(false);
    }
  }

  useEffect(() => {
    async function fetchRunDetail() {
      setLoading(true);
      setRun(null);
      setStats(null);
      setLogs([]);
      setMessageRecords([]);
      setHasMoreLogs(false);
      setHasMoreMessages(false);
      setLogsOffset(0);
      setMessageOffset(0);

      try {
        const runRes = await fetch(`/api/runs?execution_id=${executionId}`);
        const runData = await runRes.json();

        setRun(runData.run || null);
        setStats(runData.stats || null);

        if (runData.run) {
          void fetchLogs(0, false);
          void fetchMessageRecords(0, false);
        }
      } catch (error) {
        console.error('Error fetching run detail:', error);
        setRun(null);
        setStats(null);
      } finally {
        setLoading(false);
      }
    }

    fetchRunDetail();
  }, [executionId]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const filteredLogs = logs.filter(log => {
    if (logFilter === 'all') { return true; }
    return log.level === logFilter;
  });

  function getStatusBadgeClass(status: string) {
    switch (status) {
      case 'RUNNING': return 'badge-running';
      case 'COMPLETED': return 'badge-completed';
      case 'FAILED': return 'badge-failed';
      case 'CANCELLED': return 'badge-cancelled';
      default: return 'badge';
    }
  }

  function getLogLevelClass(level: string) {
    switch (level) {
      case 'error': { return 'log-error'; }
      case 'warning': { return 'log-warning'; }
      default: { return 'log-info'; }
    }
  }

  function formatDuration(ms: number | null) {
    if (!ms) { return '—'; }
    if (ms < 1000) { return `${ms}ms`; }
    if (ms < 60000) { return `${(ms / 1000).toFixed(1)}s`; }
    return `${(ms / 60000).toFixed(1)}m`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay" onClick={onClose}>
      <div 
        className="modal-content w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-fade-in m-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Run Details
            </h2>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {executionId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <Activity className="w-8 h-8 text-primary mx-auto mb-3 animate-pulse" />
                <p className="text-sm text-muted-foreground">Loading...</p>
              </div>
            </div>
          ) : run ? (
            <div className="p-5 space-y-5">
              {/* Status & Meta */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-muted/50 p-3 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground mb-1">Status</p>
                  <span className={getStatusBadgeClass(run.status)}>{run.status}</span>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground mb-1">Steps</p>
                  <p className="text-sm font-mono font-medium text-foreground">{run.step_index}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground mb-1">Duration</p>
                  <p className="text-sm font-mono font-medium text-foreground">
                    {stats ? formatDuration(stats.duration_ms) : '—'}
                  </p>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground mb-1">Created</p>
                  <p className="text-sm font-mono font-medium text-foreground">
                    {formatDistanceToNow(new Date(run.created_at_ms), { addSuffix: true })}
                  </p>
                </div>
              </div>

              {/* IDs */}
              <div className="bg-muted/50 p-3 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground mb-2 font-medium">Identifiers</p>
                <div className="space-y-1 text-xs font-mono">
                  <p><span className="text-muted-foreground">Run ID:</span> <span className="text-foreground">{run.run_id}</span></p>
                  <p><span className="text-muted-foreground">Conversation:</span> <span className="text-foreground">{run.conversation_id}</span></p>
                </div>
              </div>

              {/* Token Stats */}
              {stats && (
                <div className="bg-muted/50 p-3 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground mb-3 font-medium">Token Usage</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="text-lg font-mono font-semibold text-foreground">{stats.total_tokens.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Prompt</p>
                      <p className="text-lg font-mono font-semibold text-foreground">{stats.prompt_tokens.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Completion</p>
                      <p className="text-lg font-mono font-semibold text-foreground">{stats.completion_tokens.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Messages</p>
                      <p className="text-lg font-mono font-semibold text-foreground">{stats.message_count}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Info */}
              {run.error_message && (
                <div className="bg-destructive/5 p-3 rounded-lg border border-destructive/20">
                  <p className="text-xs text-destructive font-medium mb-2 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Error Details
                  </p>
                  <p className="text-sm text-destructive">{run.error_message}</p>
                  {run.error_code && (
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                      Code: {run.error_code} | Category: {run.error_category || '—'}
                    </p>
                  )}
                </div>
              )}

              {/* Message Usage Records */}
              <div className="bg-muted/50 rounded-lg border border-border overflow-hidden">
                <div className="p-3 border-b border-border">
                  <p className="text-xs text-muted-foreground font-medium">
                    Message Usage Records ({messageRecords.length})
                  </p>
                </div>
                <div className="max-h-72 overflow-y-auto text-sm">
                  {messageRecords.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground text-sm">
                      {messageLoading ? 'Loading message usage records...' : 'No message usage records'}
                    </div>
                  ) : (
                    messageRecords.map(record => (
                      <div
                        key={record.message_id}
                        className="px-4 py-3 border-b border-border last:border-0 hover:bg-muted/50"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
                          <span className="font-mono text-muted-foreground">
                            {format(new Date(record.created_at_ms), 'yyyy-MM-dd HH:mm:ss')}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground uppercase">
                            {record.role}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                            {record.type}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <p className="text-xs text-muted-foreground">Model</p>
                            <p className="text-sm font-mono text-foreground break-all">{record.model}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Input</p>
                            <p className="text-sm font-mono text-foreground">{record.input_tokens.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Output</p>
                            <p className="text-sm font-mono text-foreground">{record.output_tokens.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Cached</p>
                            <p className="text-sm font-mono text-foreground">{record.cached_tokens.toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {(hasMoreMessages || messageLoading) && (
                  <div className="p-3 border-t border-border flex justify-center">
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => fetchMessageRecords(messageOffset, true)}
                      disabled={messageLoading}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                      {messageLoading ? 'Loading...' : 'Load More'}
                    </button>
                  </div>
                )}
              </div>

              {/* Logs */}
              <div className="bg-muted/50 rounded-lg border border-border overflow-hidden">
                <div className="flex items-center justify-between p-3 border-b border-border">
                  <p className="text-xs text-muted-foreground font-medium">
                    Logs ({filteredLogs.length})
                  </p>
                  <div className="flex gap-1">
                    {['all', 'info', 'warning', 'error'].map(level => (
                      <button
                        key={level}
                        onClick={() => setLogFilter(level)}
                        className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                          logFilter === level
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        }`}
                      >
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto text-sm">
                  {filteredLogs.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground text-sm">
                      No logs matching filter
                    </div>
                  ) : (
                    filteredLogs.map(log => (
                      <div 
                        key={log.id} 
                        className="px-4 py-2 border-b border-border last:border-0 hover:bg-muted/50"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-xs text-muted-foreground flex-shrink-0 font-mono">
                            {format(new Date(log.created_at_ms), 'HH:mm:ss')}
                          </span>
                          <span className={`text-xs uppercase font-medium flex-shrink-0 ${
                            log.level === 'error' ? 'text-destructive' : 
                            log.level === 'warning' ? 'text-amber-500' : 
                            'text-muted-foreground'
                          }`}>
                            {log.level}
                          </span>
                          <span className={getLogLevelClass(log.level)}>
                            {log.message}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {(hasMoreLogs || logsLoading) && (
                  <div className="p-3 border-t border-border flex justify-center">
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => fetchLogs(logsOffset, true)}
                      disabled={logsLoading}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                      {logsLoading ? 'Loading...' : 'Load More Logs'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-3" />
                <p className="text-sm text-destructive">Failed to load run data</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Press ESC to close
          </p>
          <p className="text-xs text-muted-foreground">
            {run && `Updated ${formatDistanceToNow(new Date(run.updated_at_ms), { addSuffix: true })}`}
          </p>
        </div>
      </div>
    </div>
  );
}
