import { FinishReason, MessageContent,  ToolCall, Usage } from "../providers";
import { getMessageId } from "./utils";

/**
 * 消息基础接口
 */
interface BaseMessage {
    /** 消息唯一 ID */
    messageId: string;
    /** 时间戳 */
    timestamp: number;
    /** 会话 ID（可选） */
    sessionId?: string;
    /** Agent ID（可选） */
    agentId?: string;
    /** 步骤索引（可选） */
    stepIndex?: number;
    /** 元数据 */
    metadata?: MessageMetadata;
}

/**
 * 消息元数据
 */
interface MessageMetadata {
    model?: string;
    latency?: number;
    tokens?: Usage;
    [key: string]: unknown;
}




/**
 * System 消息
 */
export interface SystemMessage extends BaseMessage {
    role: 'system';
    content: string;
}

/**
 * User 消息
 */
export interface UserMessage extends BaseMessage {
    role: 'user';
    content: MessageContent;
}

/**
 * Assistant 消息
 */
export interface AssistantMessage extends BaseMessage {
    role: 'assistant';
    content: string;
    /** 工具调用 */
    tool_calls?: ToolCall[];
    /** 推理内容 */
    reasoning_content?: string;
    /** 完成原因 */
    finish_reason?: FinishReason;
    /** Token 使用情况 */
    usage?: Usage;
}

/**
 * 工具调用消息（助手发起的工具调用）
 */
export interface ToolCallMessage extends BaseMessage {
    role: 'assistant';
    content: string;
    /** 工具调用（必填） */
    tool_calls: ToolCall[];
    /** 推理内容 */
    reasoning_content?: string;
    /** 完成原因 */
    finish_reason?: FinishReason;
    /** Token 使用情况 */
    usage?: Usage;
}

/**
 * 工具结果消息（工具返回的结果）
 */
export interface ToolResultMessage extends BaseMessage {
    role: 'tool';
    /** 工具调用 ID（必填） */
    tool_call_id: string;
    content: string;
}

/**
 * 总结消息（用于上下文压缩）
 */
export interface SummaryMessage extends BaseMessage {
    role: 'assistant';
    type: 'summary';
    content: string;
    /** 总结的消息范围 */
    summarizedMessages: string[];  // messageId 列表
}

/**
 * 消息类型 - 区分联合类型
 */
export type Message = 
    | SystemMessage 
    | UserMessage 
    | AssistantMessage 
    | ToolCallMessage 
    | ToolResultMessage
    | SummaryMessage;

/**
 * 消息类型守卫
 */
export const MessageGuard = {
    isSystem(msg: Message): msg is SystemMessage {
        return msg.role === 'system';
    },
    
    isUser(msg: Message): msg is UserMessage {
        return msg.role === 'user';
    },
    
    isAssistant(msg: Message): msg is AssistantMessage {
        return msg.role === 'assistant' && !('tool_calls' in msg && msg.tool_calls);
    },
    
    isToolCall(msg: Message): msg is ToolCallMessage {
        return msg.role === 'assistant' && 'tool_calls' in msg && !!msg.tool_calls;
    },
    
    isToolResult(msg: Message): msg is ToolResultMessage {
        return msg.role === 'tool';
    },
    
    isSummary(msg: Message): msg is SummaryMessage {
        return 'type' in msg && msg.type === 'summary';
    },
    
    hasToolCalls(msg: Message): msg is (AssistantMessage | ToolCallMessage) {
        return (msg.role === 'assistant') && 'tool_calls' in msg && !!msg.tool_calls;
    }
};



/**
 * 消息工厂函数
 */
export const MessageFactory = {
    createSystemMessage(content: string, sessionId?: string): SystemMessage {
        return {
            messageId: getMessageId(),
            role: 'system',
            content,
            timestamp: Date.now(),
            sessionId,
        };
    },
    
    createUserMessage(content: MessageContent, sessionId?: string): UserMessage {
        return {
            messageId: getMessageId(),
            role: 'user',
            content,
            timestamp: Date.now(),
            sessionId,
        };
    },
    
    createAssistantMessage(params: {
        content: string;
        tool_calls?: ToolCall[];
        reasoning_content?: string;
        finish_reason?: FinishReason;
        usage?: Usage;
        sessionId?: string;
    }): AssistantMessage | ToolCallMessage {
        const base = {
            messageId: getMessageId(),
            role: 'assistant' as const,
            content: params.content,
            timestamp: Date.now(),
            reasoning_content: params.reasoning_content,
            finish_reason: params.finish_reason,
            usage: params.usage,
            sessionId: params.sessionId,
        };
        
        if (params.tool_calls && params.tool_calls.length > 0) {
            return { ...base, tool_calls: params.tool_calls };
        }
        
        return base;
    },
    
    createToolResultMessage(toolCallId: string, content: string, sessionId?: string): ToolResultMessage {
        return {
            messageId: getMessageId(),
            role: 'tool',
            tool_call_id: toolCallId,
            content,
            timestamp: Date.now(),
            sessionId,
        };
    },
    
    createSummaryMessage(content: string, summarizedMessages: string[], sessionId?: string): SummaryMessage {
        return {
            messageId: getMessageId(),
            role: 'assistant',
            type: 'summary',
            content,
            summarizedMessages,
            timestamp: Date.now(),
            sessionId,
        };
    },
};

// 导出类型
export type { BaseMessage, MessageMetadata };
