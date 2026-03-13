'use client';

import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

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
}

export function ErrorList({ errors }: ErrorListProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (errors.length === 0) {
    return (
      <div className="card animate-fade-in">
        <div className="panel-header">
          <h2 className="text-sm font-semibold text-foreground">Recent Errors</h2>
        </div>
        <div className="panel-body">
          <div className="text-center py-8 text-muted-foreground">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted mb-3">
              <AlertTriangle className="w-5 h-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm">No errors found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card animate-fade-in">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-foreground">Recent Errors</h2>
        <span className="text-xs text-muted-foreground">{errors.length} entries</span>
      </div>
      <div className="divide-y divide-border">
        {errors.map(error => {
          let errorData = null;
          if (error.error_json) {
            try {
              errorData = JSON.parse(error.error_json);
            } catch {
              // Ignore parse errors
            }
          }

          const isExpanded = expandedId === error.id;

          return (
            <div 
              key={error.id} 
              className="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => setExpandedId(isExpanded ? null : error.id)}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex-shrink-0">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
                    <span className="text-sm font-medium text-destructive truncate">
                      {error.code || error.message}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>
                      <span className="text-muted-foreground/70">Exec:</span>{' '}
                      <code className="font-mono">{error.execution_id.slice(0, 12)}...</code>
                      {error.step_index !== null && (
                        <>
                          {' '}
                          <span className="text-muted-foreground/70 ml-1">Step:</span> {error.step_index}
                        </>
                      )}
                    </p>
                    <p>
                      <span className="text-muted-foreground/70">Source:</span> {error.source}{' '}
                      <span className="text-muted-foreground/70 ml-2">Time:</span>{' '}
                      {formatDistanceToNow(new Date(error.created_at_ms), { addSuffix: true })}
                    </p>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 p-3 bg-muted rounded-lg border border-border">
                      <p className="text-sm text-foreground mb-2">
                        {error.message}
                      </p>
                      {errorData && (
                        <pre className="text-xs text-muted-foreground overflow-x-auto font-mono bg-background p-2 rounded border border-border">
                          {JSON.stringify(errorData, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
