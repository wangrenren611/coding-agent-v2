/**
 * 远程命令执行器
 */

import type {
  CommandExecutionCallbacks,
  CommandExecutionEvent,
  CommandExecutionRequest,
  CommandExecutionResult,
  CommandExecutor,
} from './command';
import type { ExecutionTarget } from './types';

type FetchLike = typeof fetch;

interface RemoteExecuteResponseBody {
  success?: boolean;
  exitCode?: number;
  output?: string;
  streamed?: boolean;
  backgroundTask?: CommandExecutionResult['backgroundTask'];
  metadata?: Record<string, unknown>;
  events?: CommandExecutionEvent[];
}

export interface RemoteCommandExecutorOptions {
  id?: string;
  endpoint: string;
  target?: Extract<ExecutionTarget, 'remote' | 'sandbox' | 'custom'>;
  fetchImpl?: FetchLike;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
}

/**
 * HTTP 远程执行器
 *
 * 约定：
 * - POST endpoint
 * - body: CommandExecutionRequest
 * - response: RemoteExecuteResponseBody
 */
export class RemoteCommandExecutor implements CommandExecutor {
  readonly id: string;
  readonly target: Extract<ExecutionTarget, 'remote' | 'sandbox' | 'custom'>;

  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;
  private readonly requestTimeoutMs?: number;

  constructor(options: RemoteCommandExecutorOptions) {
    this.id = options.id ?? 'remote-default';
    this.endpoint = options.endpoint;
    this.target = options.target ?? 'remote';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.headers = options.headers ?? {};
    this.requestTimeoutMs = options.requestTimeoutMs;
  }

  canExecute(request: CommandExecutionRequest): boolean {
    return request.target === this.target;
  }

  async execute(
    request: CommandExecutionRequest,
    callbacks?: CommandExecutionCallbacks
  ): Promise<CommandExecutionResult> {
    const timeoutMs = this.requestTimeoutMs ?? Math.max(request.timeoutMs + 2000, 5000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Remote executor request failed: HTTP ${response.status} ${text}`);
      }

      const body = (await response.json()) as RemoteExecuteResponseBody;
      for (const event of body.events ?? []) {
        this.emit(callbacks, event);
      }

      const result: CommandExecutionResult = {
        success: body.success ?? (body.exitCode ?? 1) === 0,
        exitCode: body.exitCode ?? 1,
        output: body.output ?? '',
        streamed: body.streamed,
        backgroundTask: body.backgroundTask,
        metadata: body.metadata,
      };

      this.emit(callbacks, {
        type: 'end',
        data: { success: result.success, exitCode: result.exitCode },
      });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit(callbacks, { type: 'error', content: err.message });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private emit(
    callbacks: CommandExecutionCallbacks | undefined,
    event: CommandExecutionEvent
  ): void {
    const onEvent = callbacks?.onEvent;
    if (!onEvent) {
      return;
    }
    void Promise.resolve(onEvent(event)).catch(() => {
      // 事件回调失败不应影响执行逻辑
    });
  }
}
