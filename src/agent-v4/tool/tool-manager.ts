/**
 * Tool Manager 工具管理器
 * 参考: ENTERPRISE_REALTIME.md
 */

import {
  LLMTool,
  Tool,
  ToolCall,
  ToolConcurrencyPolicy,
  ToolConfirmInfo,
  ToolExecutionContext,
} from './types';
import { BaseTool } from './base-tool';
import { ToolResult } from './base-tool';
import {
  EmptyToolNameError,
  InvalidArgumentsError,
  ToolNotFoundError,
  ToolValidationError,
  ToolDeniedError,
  ToolExecutionError
} from './error';


export interface ToolManager {
  execute(toolCall: ToolCall, options?: ToolExecutionContext): Promise<ToolResult>;
  registerTool(tool: Tool, handler: BaseTool): void;
  getTools(): BaseTool[];
  getConcurrencyPolicy?(toolCall: ToolCall): ToolConcurrencyPolicy;
}

/**
 * 默认工具管理器实现
 */
export class DefaultToolManager implements ToolManager {
  private tools: Map<string, Tool> = new Map();
  private handlers: Map<string, BaseTool> = new Map();
  
  async execute(toolCall: ToolCall, options: ToolExecutionContext): Promise<ToolResult> {
    const toolName = toolCall.function.name;

    if(!toolName){
      const err = new EmptyToolNameError();
      return {
        success: false,
        error: err,
        output: err.message
      }
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch (error) {
      const err = new InvalidArgumentsError(toolName, (error as Error).message);
      return {
        success: false,
        error: err,
        output: err.message
      };
    }
  
    const handler = this.handlers.get(toolName);

    if(!handler){
      const err = new ToolNotFoundError(toolName);
      return {
        success: false,
        error: err,
        output: err.message
      }
    }

    const validationResult = handler.safeValidateArgs(args);

    if (!validationResult.success) {
      const err = new ToolValidationError(toolName, validationResult.error.issues);
      return {
        success: false,
        error: err,
        output: err.message
      };
    }
    
    const needsConfirm = handler.shouldConfirm(args);
    
    if (needsConfirm && options?.onConfirm) {
      const confirmInfo: ToolConfirmInfo = {
        toolCallId: toolCall.id,
        toolName,
        arguments: toolCall.function.arguments
      };
      
      const decision = await options.onConfirm(confirmInfo);
      
      if (!decision.approved) {
        const err = new ToolDeniedError(toolName, decision.message);
        return {
          success: false,
          error: err,
          output: err.message
        };
      }
    }
    
    try {
      const result = await handler.execute(args, options);
      return result;
    } catch (error) {
      const err = new ToolExecutionError((error as Error).message);
      options?.onChunk?.({ type: 'stderr', data: err.message });
      return {
        success: false,
        error: err,
        output: err.message
      };
    }
  }


  
  registerTool(tool: Tool, handler: BaseTool): void {
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
  }

  toToolsSchema(): LLMTool[] {
      return this.getTools()
        .map((tool) => tool.toToolSchema());
    }
  
  getTools(): BaseTool[] {
    return Array.from(this.handlers.values());
  }

  getConcurrencyPolicy(toolCall: ToolCall): ToolConcurrencyPolicy {
    const toolName = toolCall.function.name;
    const handler = this.handlers.get(toolName);
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
}
