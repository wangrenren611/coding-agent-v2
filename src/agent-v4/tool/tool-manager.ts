/**
 * Tool Manager 工具管理器
 * 参考: ENTERPRISE_REALTIME.md
 */

import {
  LLMTool,
  ToolCall,
  ToolConcurrencyPolicy,
  ToolConfirmInfo,
  ToolPolicyCheckInfo,
  ToolPolicyDecision,
  ToolExecutionContext,
} from './types';
import { BaseTool, ToolConfirmDetails } from './base-tool';
import { ToolResult } from './base-tool';
import {
  EmptyToolNameError,
  InvalidArgumentsError,
  ToolNotFoundError,
  ToolValidationError,
  ToolDeniedError,
  ToolExecutionError,
  ToolPolicyDeniedError,
} from './error';
import * as path from 'node:path';

interface BashRule {
  id: string;
  pattern: RegExp;
  message: string;
}

export interface ToolManagerConfig {
  enableBuiltInPolicy?: boolean;
  dangerousBashRules?: BashRule[];
  restrictedWritePathPrefixes?: string[];
}

const DEFAULT_DANGEROUS_BASH_RULES: BashRule[] = [
  {
    id: 'rm_root',
    pattern: /(^|[;&|]\s*)rm\s+-rf\s+\/(\s|$)/i,
    message: 'Dangerous destructive root deletion command is blocked',
  },
  {
    id: 'disk_format',
    pattern: /\bmkfs(\.[a-z0-9]+)?\b/i,
    message: 'Disk formatting command is blocked',
  },
  {
    id: 'fork_bomb',
    pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\};:/,
    message: 'Fork bomb pattern is blocked',
  },
];

const DEFAULT_RESTRICTED_WRITE_PREFIXES = [
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/System',
  '/private/etc',
];

export interface ToolManager {
  execute(toolCall: ToolCall, options?: ToolExecutionContext): Promise<ToolResult>;
  registerTool(tool: BaseTool): void;
  getTools(): BaseTool[];
  getConcurrencyPolicy?(toolCall: ToolCall): ToolConcurrencyPolicy;
}

/**
 * 默认工具管理器实现
 */
export class DefaultToolManager implements ToolManager {
  private tools: Map<string, BaseTool> = new Map();
  private readonly enableBuiltInPolicy: boolean;
  private readonly dangerousBashRules: BashRule[];
  private readonly restrictedWritePathPrefixes: string[];

  constructor(config: ToolManagerConfig = {}) {
    this.enableBuiltInPolicy = config.enableBuiltInPolicy ?? true;
    this.dangerousBashRules = config.dangerousBashRules ?? DEFAULT_DANGEROUS_BASH_RULES;
    this.restrictedWritePathPrefixes = (
      config.restrictedWritePathPrefixes ?? DEFAULT_RESTRICTED_WRITE_PREFIXES
    ).map((prefix) => path.resolve(prefix));
  }

  async execute(toolCall: ToolCall, options: ToolExecutionContext): Promise<ToolResult> {
    const toolName = toolCall.function.name;

    if (!toolName) {
      const err = new EmptyToolNameError();
      return {
        success: false,
        error: err,
        output: err.message,
      };
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch (error) {
      const err = new InvalidArgumentsError(toolName, (error as Error).message);
      return {
        success: false,
        error: err,
        output: err.message,
      };
    }

    const handler = this.tools.get(toolName);

    if (!handler) {
      const err = new ToolNotFoundError(toolName);
      return {
        success: false,
        error: err,
        output: err.message,
      };
    }

    const validationResult = handler.safeValidateArgs(args);

    if ('error' in validationResult) {
      const err = new ToolValidationError(toolName, validationResult.error.issues);
      return {
        success: false,
        error: err,
        output: err.message,
      };
    }

    const policyCheckInfo: ToolPolicyCheckInfo = {
      toolCallId: toolCall.id,
      toolName,
      arguments: toolCall.function.arguments,
      parsedArguments: validationResult.data as Record<string, unknown>,
    };

    if (options?.onPolicyCheck) {
      const policyDecision = await options.onPolicyCheck(policyCheckInfo);
      if (!policyDecision.allowed) {
        return this.buildPolicyDeniedResult(toolName, toolCall.id, policyDecision, 'callback');
      }
    }

    const builtInDecision = this.evaluateBuiltInPolicy(policyCheckInfo);
    if (!builtInDecision.allowed) {
      return this.buildPolicyDeniedResult(toolName, toolCall.id, builtInDecision, 'builtin');
    }

    const confirmDetails = handler.getConfirmDetails(validationResult.data);
    const needsConfirm = handler.shouldConfirm(validationResult.data) || Boolean(confirmDetails);
    let executionContext = options;

    if (needsConfirm && options?.onConfirm) {
      const confirmInfo: ToolConfirmInfo = {
        toolCallId: toolCall.id,
        toolName,
        arguments: toolCall.function.arguments,
        ...this.normalizeConfirmDetails(confirmDetails),
      };

      const decision = await options.onConfirm(confirmInfo);

      if (!decision.approved) {
        const err = new ToolDeniedError(toolName, decision.message);
        return {
          success: false,
          error: err,
          output: err.message,
        };
      }

      executionContext = {
        ...options,
        confirmationApproved: true,
      };
    }

    try {
      const result = await handler.execute(validationResult.data, executionContext);
      return result;
    } catch (error) {
      const err = new ToolExecutionError((error as Error).message);
      options?.onChunk?.({ type: 'stderr', data: err.message });
      return {
        success: false,
        error: err,
        output: err.message,
      };
    }
  }

  registerTool(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }

  toToolsSchema(): LLMTool[] {
    return this.getTools().map((tool) => tool.toToolSchema());
  }

  getTools(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  getConcurrencyPolicy(toolCall: ToolCall): ToolConcurrencyPolicy {
    const toolName = toolCall.function.name;
    const handler = this.tools.get(toolName);
    if (!handler) {
      return { mode: 'exclusive' };
    }

    let rawArgs: Record<string, unknown> = {};
    try {
      rawArgs = JSON.parse(toolCall.function.arguments);
    } catch {
      return { mode: 'exclusive' };
    }

    const validated = handler.safeValidateArgs(rawArgs);
    if (!validated.success) {
      return { mode: 'exclusive' };
    }

    const mode = handler.getConcurrencyMode(validated.data);
    const lockKey = handler.getConcurrencyLockKey(validated.data);
    return lockKey ? { mode, lockKey } : { mode };
  }

  private buildPolicyDeniedResult(
    toolName: string,
    toolCallId: string,
    decision: ToolPolicyDecision,
    source: 'callback' | 'builtin'
  ): ToolResult {
    const audit = {
      toolCallId,
      toolName,
      source,
      timestamp: Date.now(),
      ...(decision.audit || {}),
    };
    const err = new ToolPolicyDeniedError(
      toolName,
      decision.code || 'POLICY_DENIED',
      decision.message,
      audit
    );
    return {
      success: false,
      error: err,
      output: err.message,
    };
  }

  private normalizeConfirmDetails(details: ToolConfirmDetails | null): Partial<ToolConfirmInfo> {
    if (!details) {
      return {};
    }
    return {
      ...(details.reason ? { reason: details.reason } : {}),
      ...(details.metadata ? { metadata: details.metadata } : {}),
    };
  }

  private evaluateBuiltInPolicy(info: ToolPolicyCheckInfo): ToolPolicyDecision {
    if (!this.enableBuiltInPolicy) {
      return { allowed: true };
    }

    if (info.toolName === 'bash') {
      const command = info.parsedArguments.command;
      if (typeof command === 'string') {
        for (const rule of this.dangerousBashRules) {
          if (rule.pattern.test(command)) {
            return {
              allowed: false,
              code: 'DANGEROUS_COMMAND',
              message: rule.message,
              audit: {
                ruleId: rule.id,
                matchedValue: command.slice(0, 200),
              },
            };
          }
        }
      }
    }

    if (info.toolName === 'write_file') {
      const targetPath = info.parsedArguments.path;
      if (typeof targetPath === 'string') {
        const resolvedPath = path.resolve(targetPath);
        for (const restrictedPrefix of this.restrictedWritePathPrefixes) {
          if (
            resolvedPath === restrictedPrefix ||
            resolvedPath.startsWith(`${restrictedPrefix}${path.sep}`)
          ) {
            return {
              allowed: false,
              code: 'PATH_NOT_ALLOWED',
              message: `Path targets restricted location: ${targetPath}`,
              audit: {
                ruleId: 'restricted_write_path',
                matchedValue: resolvedPath,
              },
            };
          }
        }
      }
    }

    return { allowed: true };
  }
}
