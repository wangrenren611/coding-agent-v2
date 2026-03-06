import type { Run, RunEvent, RunId, RunTerminalStatus } from '../types';

export interface RunControl {
  runId: RunId;
  cancelRequested: boolean;
}

export interface RunExecutionResult {
  status: RunTerminalStatus;
  output?: string;
  error?: string;
}

export interface RunExecutionAdapter {
  execute(
    run: Run,
    signal: AbortSignal,
    appendEvent: (event: Omit<RunEvent, 'seq'>) => Promise<void>
  ): Promise<RunExecutionResult>;
}

export interface TaskRunner {
  start(run: Run, adapter?: RunExecutionAdapter): Promise<void>;
  cancel(sessionId: string, runId: RunId): Promise<RunControl | null>;
  isActive(sessionId: string, runId: RunId): Promise<boolean>;
  recover(): Promise<void>;
}
