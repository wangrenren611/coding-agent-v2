'use client';

import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, X } from 'lucide-react';

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

interface ErrorListProps {
  errors: ErrorLog[];
  onDismiss?: (id: number) => void;
}

export function ErrorList({ errors, onDismiss }: ErrorListProps) {
  if (errors.length === 0) {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Recent Errors</h2>
        <div className="text-center py-8 text-muted-foreground">
          <AlertTriangle className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No errors found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">Recent Errors</h2>
      <div className="space-y-3">
        {errors.map(error => {
          let errorData = null;
          if (error.error_json) {
            try {
              errorData = JSON.parse(error.error_json);
            } catch {
              // Ignore parse errors
            }
          }

          return (
            <div key={error.id} className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-red-400">
                      {error.code || error.message}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>
                      <span className="font-mono">{error.execution_id}</span>
                      {error.step_index !== null && <span> • Step {error.step_index}</span>}
                    </p>
                    <p>
                      Source: {error.source} •{' '}
                      {formatDistanceToNow(error.created_at_ms, {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  {errorData?.stack && (
                    <details className="mt-2">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        Show stack trace
                      </summary>
                      <pre className="mt-2 p-2 bg-black/30 rounded text-xs overflow-x-auto text-red-300">
                        {errorData.stack}
                      </pre>
                    </details>
                  )}
                </div>
                {onDismiss && (
                  <button
                    onClick={() => onDismiss(error.id)}
                    className="p-1 hover:bg-red-500/20 rounded transition-colors"
                  >
                    <X className="w-4 h-4 text-red-400" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
