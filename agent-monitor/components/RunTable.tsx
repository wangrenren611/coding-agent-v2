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
    <div className="card animate-fade-in">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-foreground">Recent Runs</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search execution ID..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="input-field pl-8 w-48 text-sm"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="select-field text-sm"
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
        <table className="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Execution ID</th>
              <th>Steps</th>
              <th>Time</th>
              <th>Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredRuns.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                  No matching runs found
                </td>
              </tr>
            ) : (
              filteredRuns.map(run => (
                <tr
                  key={run.execution_id}
                  onClick={() => onSelectRun(run.execution_id)}
                  className="cursor-pointer"
                >
                  <td>
                    <span className={getStatusBadge(run.status)}>
                      {run.status}
                    </span>
                  </td>
                  <td>
                    <code className="text-xs font-mono text-foreground bg-muted px-1.5 py-0.5 rounded">
                      {run.execution_id.slice(0, 16)}...
                    </code>
                  </td>
                  <td className="font-mono text-sm text-muted-foreground">
                    {run.step_index}
                  </td>
                  <td className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(run.created_at_ms), { addSuffix: true })}
                  </td>
                  <td className="text-sm text-muted-foreground max-w-[200px] truncate">
                    {run.terminal_reason || '—'}
                  </td>
                  <td className="text-right">
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
