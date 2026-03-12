'use client';

import { formatDistanceToNow } from 'date-fns';
import { ChevronRight, Search } from 'lucide-react';
import { useState } from 'react';

interface Run {
  execution_id: string;
  status: string;
  created_at_ms: number;
  step_index: number;
  terminal_reason: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface RunTableProps {
  runs: Run[];
  onSelectRun: (executionId: string) => void;
}

function getStatusBadge(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'badge-running';
    case 'COMPLETED':
      return 'badge-completed';
    case 'FAILED':
      return 'badge-failed';
    case 'CANCELLED':
      return 'badge-cancelled';
    default:
      return 'badge';
  }
}

export function RunTable({ runs, onSelectRun }: RunTableProps) {
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredRuns = runs.filter(run => {
    const matchesSearch = run.execution_id.toLowerCase().includes(filter.toLowerCase());
    const matchesStatus = statusFilter === 'all' || run.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Recent Runs</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search execution ID..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="pl-9 pr-4 py-2 bg-muted border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-muted border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All Status</option>
            <option value="RUNNING">Running</option>
            <option value="COMPLETED">Completed</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Status
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Execution ID
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Steps
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Time
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                Error
              </th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRuns.map(run => (
              <tr
                key={run.execution_id}
                className="border-b border-border hover:bg-accent/50 cursor-pointer transition-colors"
                onClick={() => onSelectRun(run.execution_id)}
              >
                <td className="py-3 px-4">
                  <span className={`badge ${getStatusBadge(run.status)}`}>{run.status}</span>
                </td>
                <td className="py-3 px-4 font-mono text-sm">{run.execution_id}</td>
                <td className="py-3 px-4 text-sm">{run.step_index}</td>
                <td className="py-3 px-4 text-sm text-muted-foreground">
                  {formatDistanceToNow(run.created_at_ms, { addSuffix: true })}
                </td>
                <td className="py-3 px-4 text-sm">
                  {run.error_code ? (
                    <span
                      className="text-red-400 truncate max-w-xs block"
                      title={run.error_message || ''}
                    >
                      {run.error_code}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredRuns.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">No runs found</div>
      )}
    </div>
  );
}
