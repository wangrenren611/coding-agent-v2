/**
 * 工具管理器
 *
 * 统一管理工具的注册、schema生成、执行
 */

import { z } from 'zod';
import type { Tool } from '../providers';
import type { ToolCall, ToolResult, ToolExecutionContext } from '../core/types';
import { BaseTool } from './base';
import type {
  ToolManagerConfig,
  ToolExecutionCallbacks,
  ToolConfirmRequest,
  ToolMeta,
  ToolParameterSchema,
  ToolStreamEventInput,
} from './types';

type ToolErrorStage =
  | 'lookup'
  | 'availability'
  | 'parse_args'
  | 'validation'
  | 'confirmation'
  | 'execution'
  | 'timeout';

interface ToolErrorLike extends Error {
  code?: string;
  recoverable?: boolean;
  data?: unknown;
}

interface ZodIssueLike {
  message: string;
  path?: Array<string | number>;
}

class ToolArgumentsParseError extends Error implements ToolErrorLike {
  code = 'TOOL_ARGUMENTS_PARSE_ERROR';
  recoverable = true;
}

class ToolExecutionTimeoutError extends Error implements ToolErrorLike {
  code = 'TOOL_TIMEOUT';
  recoverable = true;
}

const BASE_TOOL_DEFAULT_TIMEOUT_MS = 60_000;

export class ToolManager {
  private tools: Map<string, BaseTool<ToolParameterSchema>> = new Map();
  private config: Required<ToolManagerConfig>;

  constructor(config?: ToolManagerConfig) {
    this.config = {
      maxConcurrency: config?.maxConcurrency ?? 5,
      timeout: config?.timeout ?? 60000,
    };
  }

  // ===========================================================================
  // 工具注册
  // ===========================================================================

  /**
   * 注册工具（支持单个或批量）
   */
  register(toolOrTools: BaseTool<ToolParameterSchema> | BaseTool<ToolParameterSchema>[]): this {
    const tools = Array.isArray(toolOrTools) ? toolOrTools : [toolOrTools];
    for (const tool of tools) {
      const name = tool.name;
      if (this.tools.has(name)) {
        console.warn(`[ToolManager] Tool "${name}" already registered, will be overwritten`);
      }
      this.tools.set(name, tool);
    }
    return this;
  }

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }
  /**
   * 获取工具
   */
  getTool<T extends ToolParameterSchema = ToolParameterSchema>(
    name: string
  ): BaseTool<T> | undefined {
    return this.tools.get(name) as BaseTool<T> | undefined;
  }

  /**
   * 检查工具是否存在
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取所有工具名称
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 获取所有工具
   */

  getTools(): BaseTool<ToolParameterSchema>[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具数量
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 按分类获取工具
   */

  getToolsByCategory(category: string): BaseTool<ToolParameterSchema>[] {
    return this.getTools().filter((tool) => tool.meta.category === category);
  }

  /**
   * 获取危险工具
   */

  getDangerousTools(): BaseTool<ToolParameterSchema>[] {
    return this.getTools().filter((tool) => tool.meta.dangerous);
  }

  // ===========================================================================
  // Schema 生成
  // ===========================================================================

  /**
   * 生成 LLM Provider 需要的 Tool Schema 列表
   */
  toToolsSchema(): Tool[] {
    return this.getTools()
      .filter((tool) => tool.meta.enabled !== false)
      .map((tool) => tool.toToolSchema());
  }

  /**
   * 获取所有工具的元数据
   */
  getToolsMeta(): ToolMeta[] {
    return this.getTools()
      .filter((tool) => tool.meta.enabled !== false)
      .map((tool) => tool.meta);
  }

  /**
   * 执行单个工具
   */
  async executeTool<T extends ToolParameterSchema = ToolParameterSchema>(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    callbacks?: ToolExecutionCallbacks
  ): Promise<ToolResult> {
    const tool = this.tools.get(name) as BaseTool<T> | undefined;
    if (!tool) {
      return this.createErrorResult({
        toolName: name,
        stage: 'lookup',
        code: 'TOOL_NOT_FOUND',
        message: `Tool not found: ${name}`,
      });
    }

    // 检查是否启用
    if (tool.meta.enabled === false) {
      return this.createErrorResult({
        toolName: name,
        stage: 'availability',
        code: 'TOOL_DISABLED',
        message: `Tool is disabled: ${name}`,
      });
    }

    // 参数校验
    let validatedArgs: z.infer<T>;
    try {
      validatedArgs = tool.validateArgs(args);
    } catch (error) {
      let errorMessage = 'Invalid arguments';
      let issues: Array<{ message: string; path?: string }> | undefined;
      if (error instanceof z.ZodError) {
        const extracted = this.getZodIssues(error);
        issues = extracted.map((issue) => ({
          message: issue.message,
          path: issue.path?.length ? issue.path.join('.') : undefined,
        }));
        errorMessage = `Invalid arguments: ${extracted.map((e) => e.message).join(', ')}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }

      return this.createErrorResult({
        toolName: name,
        stage: 'validation',
        code: 'TOOL_VALIDATION_ERROR',
        message: errorMessage,
        details: issues ? { issues } : undefined,
      });
    }

    const confirmRequirement = await this.resolveToolConfirmRequirement(
      tool,
      validatedArgs,
      context
    );
    if (confirmRequirement.required) {
      const confirmRequest: ToolConfirmRequest = {
        toolCallId: context.toolCallId,
        toolName: name,
        args: validatedArgs as Record<string, unknown>,
        rawArgs: args,
        reason: confirmRequirement.reason,
      };

      const onToolConfirm = callbacks?.onToolConfirm;
      if (!onToolConfirm) {
        return this.createErrorResult({
          toolName: name,
          stage: 'confirmation',
          code: 'TOOL_CONFIRMATION_REQUIRED',
          message: `Tool "${name}" requires user confirmation before execution`,
          details: confirmRequest,
        });
      }

      const decision = await onToolConfirm(confirmRequest);
      if (decision !== 'approve') {
        return this.createErrorResult({
          toolName: name,
          stage: 'confirmation',
          code: 'TOOL_CONFIRMATION_DENIED',
          message: `Tool "${name}" execution was denied by user`,
          details: confirmRequest,
        });
      }
    }

    try {
      const result = await this.executeToolCore(tool, validatedArgs, context);
      if (result.success) {
        return result;
      }
      return this.normalizeToolFailure(name, result, 'execution', 'TOOL_EXECUTION_ERROR');
    } catch (error) {
      const err = this.toError(error);
      if (tool.onError) {
        try {
          const handled = await tool.onError(err, validatedArgs, context);
          if (handled) {
            if (handled.success) {
              return handled;
            }
            return this.normalizeToolFailure(name, handled, 'execution', 'TOOL_EXECUTION_ERROR');
          }
        } catch (onErrorFailure) {
          return this.createErrorResult({
            toolName: name,
            stage: 'execution',
            code: 'TOOL_ONERROR_FAILED',
            message: this.toError(onErrorFailure).message,
            details: {
              original_error: this.serializeError(err),
              on_error_failure: this.serializeError(onErrorFailure),
            },
          });
        }
      }

      const stage = this.inferErrorStage(err);
      return this.createErrorResult({
        toolName: name,
        stage,
        code: this.extractErrorCode(
          err,
          stage === 'timeout' ? 'TOOL_TIMEOUT' : 'TOOL_EXECUTION_ERROR'
        ),
        message: err.message || 'Tool execution failed',
        recoverable: err.recoverable,
        details: {
          name: err.name,
          ...(err.code ? { code: err.code } : {}),
          ...(err.data !== undefined ? { data: err.data } : {}),
        },
      });
    }
  }

  /**
   * 批量执行工具（并发）
   */
  async executeTools(
    toolCalls: ToolCall[],
    context: Omit<ToolExecutionContext, 'toolCallId'>,
    callbacks?: ToolExecutionCallbacks
  ): Promise<Array<{ toolCallId: string; result: ToolResult }>> {
    if (toolCalls.length === 0) {
      return [];
    }

    // 如果工具数量小于等于最大并发数，直接并发执行
    if (toolCalls.length <= this.config.maxConcurrency) {
      return this.executeToolBatch(toolCalls, context, callbacks);
    }

    // 分批执行
    const results: Array<{ toolCallId: string; result: ToolResult }> = [];
    for (let i = 0; i < toolCalls.length; i += this.config.maxConcurrency) {
      const batch = toolCalls.slice(i, i + this.config.maxConcurrency);
      const batchResults = await this.executeToolBatch(batch, context, callbacks);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 执行一批工具调用（并发）
   */
  private async executeToolBatch(
    toolCalls: ToolCall[],
    context: Omit<ToolExecutionContext, 'toolCallId'>,
    callbacks?: ToolExecutionCallbacks
  ): Promise<Array<{ toolCallId: string; result: ToolResult }>> {
    const promises = toolCalls.map((toolCall) =>
      this.executeSingleToolWithTimeout(toolCall, context, callbacks)
    );
    const results = await Promise.all(promises);
    return results.map((r) => ({ toolCallId: r.toolCallId, result: r.result }));
  }

  /**
   * 执行单个工具调用（带超时）
   */
  private async executeSingleToolWithTimeout(
    toolCall: ToolCall,
    context: Omit<ToolExecutionContext, 'toolCallId'>,
    callbacks?: ToolExecutionCallbacks
  ): Promise<{ toolCallId: string; result: ToolResult }> {
    const emitToolEvent = this.createToolEventEmitter(toolCall, callbacks);
    const timeoutController = new AbortController();
    const fullContext: ToolExecutionContext = {
      ...context,
      toolCallId: toolCall.id,
      agentContext: {
        sessionId: context.agentContext?.sessionId ?? context.agent.getSessionId(),
        loopIndex: context.loopIndex,
        stepIndex: context.stepIndex,
        emitToolEvent,
      },
      emitToolEvent,
      toolAbortSignal: timeoutController.signal,
    };

    try {
      await this.safeEmitToolEvent(emitToolEvent, {
        type: 'start',
        data: {
          toolName: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      });

      const args = this.parseToolArgs(toolCall.function.arguments);
      const timeoutMs = this.resolveTimeoutMs(toolCall.function.name, args);
      const result = await this.withTimeout(
        this.executeTool(toolCall.function.name, args, fullContext, callbacks),
        timeoutMs,
        toolCall.function.name,
        () => timeoutController.abort()
      );

      if (!result.success) {
        await this.safeEmitToolEvent(emitToolEvent, {
          type: 'error',
          data: {
            error: result.error ?? `Tool "${toolCall.function.name}" failed`,
            result,
          },
        });
      }
      await this.safeEmitToolEvent(emitToolEvent, {
        type: 'end',
        data: {
          success: result.success,
          result,
        },
      });

      return { toolCallId: toolCall.id, result };
    } catch (error) {
      const err = this.toError(error);
      const stage = this.inferErrorStage(err);
      const result = this.createErrorResult({
        toolName: toolCall.function.name,
        stage,
        code: this.extractErrorCode(
          err,
          stage === 'timeout' ? 'TOOL_TIMEOUT' : 'TOOL_EXECUTION_ERROR'
        ),
        message: err.message || `Tool "${toolCall.function.name}" failed`,
        recoverable: err.recoverable,
        details: {
          name: err.name,
          ...(err.code ? { code: err.code } : {}),
          ...(err.data !== undefined ? { data: err.data } : {}),
        },
      });
      await this.safeEmitToolEvent(emitToolEvent, {
        type: 'error',
        data: {
          error: result.error,
          result,
        },
      });
      await this.safeEmitToolEvent(emitToolEvent, {
        type: 'end',
        data: {
          success: false,
          result,
        },
      });
      return {
        toolCallId: toolCall.id,
        result,
      };
    }
  }

  /**
   * 解析工具参数
   */
  private parseToolArgs(argsString: string): Record<string, unknown> {
    if (!argsString || !argsString.trim()) {
      return {};
    }
    try {
      const parsed = JSON.parse(argsString);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ToolArgumentsParseError('Tool arguments must be a JSON object');
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ToolArgumentsParseError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new ToolArgumentsParseError(`Invalid tool arguments JSON: ${message}`);
    }
  }

  private resolveTimeoutMs(toolName: string, args: Record<string, unknown>): number {
    const tool = this.tools.get(toolName);
    const toolTimeout = tool?.getTimeoutMs();
    const normalizedToolTimeout =
      typeof toolTimeout === 'number' && Number.isFinite(toolTimeout) && toolTimeout > 0
        ? Math.floor(toolTimeout)
        : undefined;
    const hasCustomToolTimeout =
      normalizedToolTimeout !== undefined && normalizedToolTimeout !== BASE_TOOL_DEFAULT_TIMEOUT_MS;

    let timeoutMs = hasCustomToolTimeout ? normalizedToolTimeout : this.config.timeout;

    const rawTimeout = args['timeout'];
    if (typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) && rawTimeout > 0) {
      timeoutMs = Math.min(timeoutMs, Math.floor(rawTimeout));
    }

    return timeoutMs;
  }

  private async resolveToolConfirmRequirement<T extends ToolParameterSchema>(
    tool: BaseTool<T>,
    args: z.infer<T>,
    context: ToolExecutionContext
  ): Promise<{ required: boolean; reason?: string }> {
    if (tool.shouldConfirm) {
      const result = await tool.shouldConfirm(args, context);
      if (typeof result === 'boolean') {
        return { required: result };
      }
      if (result && typeof result === 'object') {
        return {
          required: result.required === true,
          reason: typeof result.reason === 'string' ? result.reason : undefined,
        };
      }
    }

    return {
      required: tool.meta.requireConfirm === true,
    };
  }

  private createToolEventEmitter(
    toolCall: ToolCall,
    callbacks?: ToolExecutionCallbacks
  ): ((event: ToolStreamEventInput) => Promise<void>) | undefined {
    const onToolEvent = callbacks?.onToolEvent;
    if (!onToolEvent) {
      return undefined;
    }

    let sequence = 0;
    return async (event: ToolStreamEventInput) => {
      const providedSequence = event.sequence;
      if (
        typeof providedSequence === 'number' &&
        Number.isFinite(providedSequence) &&
        providedSequence > sequence
      ) {
        sequence = providedSequence;
      } else {
        sequence += 1;
      }

      await onToolEvent({
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        type: event.type,
        sequence,
        timestamp: event.timestamp ?? Date.now(),
        content: event.content,
        data: event.data,
      });
    };
  }

  private async safeEmitToolEvent(
    emitToolEvent: ((event: ToolStreamEventInput) => Promise<void>) | undefined,
    event: ToolStreamEventInput
  ): Promise<void> {
    if (!emitToolEvent) {
      return;
    }
    try {
      await emitToolEvent(event);
    } catch {
      // 工具流事件失败不应影响主流程
    }
  }

  /**
   * 带超时的 Promise 执行
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    toolName: string,
    onTimeout?: () => void
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // 通知工具尽快停止内部执行（若工具支持信号中断）
        try {
          onTimeout?.();
        } catch {
          // ignore timeout hook errors
        }
        reject(
          new ToolExecutionTimeoutError(`Tool "${toolName}" execution timed out after ${ms}ms`)
        );
      }, ms);
      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private async executeToolCore<T extends ToolParameterSchema>(
    tool: BaseTool<T>,
    validatedArgs: z.infer<T>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    let args = validatedArgs;
    if (tool.beforeExecute) {
      const modifiedArgs = await tool.beforeExecute(args, context);
      if (modifiedArgs) {
        args = modifiedArgs;
      }
    }

    let result = await tool.execute(args, context);
    if (tool.afterExecute) {
      result = await tool.afterExecute(result, args, context);
    }
    return result;
  }

  private getZodIssues(error: z.ZodError): ZodIssueLike[] {
    const errorWithIssues = error as { issues?: ZodIssueLike[]; errors?: ZodIssueLike[] };
    return errorWithIssues.issues ?? errorWithIssues.errors ?? [];
  }

  private normalizeToolFailure(
    toolName: string,
    result: ToolResult,
    stage: ToolErrorStage,
    fallbackCode: string
  ): ToolResult {
    const existingData =
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : {};
    const code = this.extractErrorCode(existingData, fallbackCode);
    const message =
      (typeof existingData.message === 'string' && existingData.message.trim()) ||
      (typeof result.error === 'string' && result.error.trim()) ||
      'Tool execution failed';
    const recoverable =
      typeof existingData.recoverable === 'boolean' ? existingData.recoverable : true;

    return {
      success: false,
      error: this.composeErrorMessage(code, message),
      data: {
        ...existingData,
        error: code,
        code,
        message,
        tool: toolName,
        stage,
        recoverable,
      },
      metadata: result.metadata,
    };
  }

  private createErrorResult(params: {
    toolName: string;
    stage: ToolErrorStage;
    code: string;
    message: string;
    recoverable?: boolean;
    details?: unknown;
  }): ToolResult {
    const errorData: Record<string, unknown> = {
      error: params.code,
      code: params.code,
      message: params.message,
      tool: params.toolName,
      stage: params.stage,
      recoverable: params.recoverable ?? true,
    };
    if (params.details !== undefined) {
      errorData.details = params.details;
    }

    return {
      success: false,
      error: this.composeErrorMessage(params.code, params.message),
      data: errorData,
    };
  }

  private composeErrorMessage(code: string, message: string): string {
    const normalizedMessage = message.trim();
    if (normalizedMessage.toUpperCase().startsWith(`${code}:`)) {
      return normalizedMessage;
    }
    return `${code}: ${normalizedMessage}`;
  }

  private extractErrorCode(source: unknown, fallbackCode: string): string {
    const record =
      source && typeof source === 'object' && !Array.isArray(source)
        ? (source as Record<string, unknown>)
        : undefined;
    const fromData =
      this.normalizeErrorCode(record?.code) ??
      this.normalizeErrorCode(record?.error) ??
      this.normalizeErrorCode((source as { code?: unknown } | undefined)?.code);
    if (fromData) {
      return fromData;
    }

    const message =
      (typeof source === 'string' && source) ||
      (source instanceof Error ? source.message : undefined) ||
      (typeof record?.message === 'string' ? record.message : undefined);
    if (message) {
      const matched = message.trim().match(/^([A-Z][A-Z0-9_]{2,})(?::|\s|$)/);
      const fromMessage = this.normalizeErrorCode(matched?.[1]);
      if (fromMessage) {
        return fromMessage;
      }
    }
    return fallbackCode;
  }

  private normalizeErrorCode(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(normalized)) {
      return undefined;
    }
    return normalized;
  }

  private inferErrorStage(error: unknown): ToolErrorStage {
    const code = this.extractErrorCode(error, '');
    if (code === 'TOOL_TIMEOUT') {
      return 'timeout';
    }
    if (code === 'TOOL_ARGUMENTS_PARSE_ERROR') {
      return 'parse_args';
    }
    return 'execution';
  }

  private toError(error: unknown): ToolErrorLike {
    if (error instanceof Error) {
      return error as ToolErrorLike;
    }
    return new Error(String(error));
  }

  private serializeError(error: unknown): Record<string, unknown> {
    const err = this.toError(error);
    return {
      name: err.name,
      message: err.message,
      code: err.code,
    };
  }
}

// =============================================================================
// 便捷函数
// =============================================================================

/**
 * 创建工具管理器
 */
export function createToolManager(config?: ToolManagerConfig): ToolManager {
  return new ToolManager(config);
}
