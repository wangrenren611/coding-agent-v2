# Providers 模块实现文档

> 生成日期: 2026-03-04
> 源代码路径: `/Users/wrr/work/coding-agent/src/providers`
> 说明: 本文档描述的是 `coding-agent` 仓库中的 providers 实现，不是当前 `coding-agent-v2/src` 目录下的实现。

## 目录

- [概述](#概述)
- [类型系统](#类型系统)
  - [API 类型 (api.ts)](#api-types-api-ts)
  - [配置类型 (config.ts)](#配置类型-config-ts)
  - [Provider 类型 (provider.ts)](#provider-类型-provider-ts)
  - [错误类型 (errors.ts)](#错误类型-errors-ts)
  - [Registry 类型 (types/registry.ts)](#registry-类型-typesregistryts)
- [适配器模式](#适配器模式)
  - [基础适配器 (base.ts)](#基础适配器-base-ts)
  - [标准适配器 (standard.ts)](#标准适配器-standard-ts)
  - [Kimi 适配器 (kimi.ts)](#kimi-适配器-kimi-ts)
  - [Anthropic 适配器 (anthropic.ts)](#anthropic-适配器-anthropic-ts)
- [HTTP 客户端](#http-客户端)
  - [HTTPClient (client.ts)](#httpclient-client-ts)
  - [StreamParser (stream-parser.ts)](#streamparser-stream-parser-ts)
- [Provider 实现](#provider-实现)
  - [OpenAICompatibleProvider](#openaicompatibleprovider)
- [Registry 系统](#registry-系统)
  - [模型配置 (model-config.ts)](#模型配置-model-config-ts)
  - [ProviderFactory (provider-factory.ts)](#providerfactory-provider-factory-ts)
  - [ProviderRegistry (registry.ts)](#providerregistry-registryts)
- [平台工具 (kimi-headers.ts)](#平台工具-kimi-headers-ts)

---

## 概述

`providers` 模块是 Coding Agent 的 LLM Provider 抽象层，负责：

1. **统一接口抽象** - 提供 `LLMProvider` 基类，支持多种 LLM 服务商
2. **适配器模式** - 通过 `BaseAPIAdapter` 处理不同提供商的请求/响应转换
3. **HTTP 通信** - 封装统一的 HTTP 客户端，支持超时与错误处理（重试由 Agent 上层负责）
4. **模型注册表** - 集中管理支持的模型配置，支持从环境变量创建 Provider
5. **错误分类** - 细粒度的错误类型，支持可重试 vs 永久性错误

### 目录结构

```
providers/
├── index.ts                      # 统一导出
├── openai-compatible.ts          # OpenAI 兼容 Provider 基类
├── kimi-headers.ts               # Kimi 平台标识工具
├── registry.ts                   # Provider 注册表入口（ProviderRegistry 类）
├── adapters/
│   ├── base.ts                  # 基础适配器抽象类
│   ├── standard.ts              # 标准 OpenAI 兼容适配器
│   ├── kimi.ts                  # Kimi 特定适配器
│   └── anthropic.ts             # Anthropic Claude 适配器
├── http/
│   ├── client.ts                # HTTP 客户端
│   └── stream-parser.ts         # SSE 流解析器
├── registry/
│   ├── model-config.ts          # 模型配置定义
│   ├── config-loader.ts         # 配置加载器
│   └── provider-factory.ts      # Provider 工厂
└── types/
    ├── index.ts                 # 类型统一导出
    ├── api.ts                   # API 类型定义
    ├── config.ts                # 配置类型定义
    ├── provider.ts              # Provider 接口定义
    ├── errors.ts                # 错误类型定义
    └── registry.ts              # Registry 类型定义（ProviderType/ModelId/ModelConfig）
```

> 说明：目录树仅展示核心实现文件，省略 `*.test.ts`。
> 命名区分：`registry.ts`（ProviderRegistry 入口类）、`registry/`（实现子模块目录）、`types/registry.ts`（类型定义）。

---

## 类型系统

### API 类型 (api.ts)

定义了 LLM API 的请求/响应数据结构。

#### 核心类型

| 类型 | 说明 |
|------|------|
| `Role` | 消息角色: `'system' \| 'assistant' \| 'user' \| 'tool'` |
| `ToolCall` | 工具调用结构，包含 id、type、index、function |
| `Tool` | 工具定义，包含 type、function（name、description、parameters） |
| `MessageContent` | 消息内容: `string \| InputContentPart[]` |
| `Usage` | Token 使用统计 |
| `BaseLLMMessage` | 基础消息类型，包含 content、role、reasoning_content |
| `FinishReason` | 完成原因: `'stop' \| 'length' \| 'content_filter' \| 'tool_calls' \| 'abort' \| null` |

#### 多模态内容类型

```typescript
// 文本内容
interface TextContentPart {
    type: 'text';
    text: string;
}

// 图片内容
interface ImageUrlContentPart {
    type: 'image_url';
    image_url: {
        url: string;
        detail?: 'auto' | 'low' | 'high';
    };
}

// 音频内容
interface InputAudioContentPart {
    type: 'input_audio';
    input_audio: {
        data: string;
        format: 'wav' | 'mp3';
    };
}

// 视频内容
interface InputVideoContentPart {
    type: 'input_video';
    input_video: {
        url?: string;
        file_id?: string;
        data?: string;
        format?: 'mp4' | 'mov' | 'webm';
    };
}

// 文件内容
interface FileContentPart {
    type: 'file';
    file: {
        file_id?: string;
        file_data?: string;
        filename?: string;
    };
}
```

#### 请求/响应类型

```typescript
// LLM 生成选项
export interface LLMGenerateOptions {
    /** 模型名称（覆盖默认模型） */
    model?: string;
    /** 最大生成 token 数 */
    max_tokens?: number;
    /** 温度参数 */
    temperature?: number;
    /** 是否启用流式响应 */
    stream?: boolean;
    /** 是否启用工具流式输出（与 stream 一致的布尔语义） */
    tool_stream?: boolean;
    /** 流式输出选项 */
    stream_options?: StreamOptions;
    /** 中止信号 */
    abortSignal?: AbortSignal;
    /** 工具列表 */
    tools?: Tool[];
    /** 思考模式（部分 Provider 支持） */
    thinking?: boolean;
    [key: string]: unknown; // 扩展字段
}

// 工具定义
export type Tool = {
    type: string;
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};

// 完整的 LLM 请求
export interface LLMRequest extends LLMGenerateOptions {
    model: string;
    messages: LLMRequestMessage[];
}

// LLM 响应
export interface LLMResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: LLMResponseMessage;
        finish_reason?: FinishReason;
    }>;
    usage?: Usage;
    [key: string]: unknown;
}
```

#### 流式响应类型

```typescript
// 流式响应块
interface Chunk {
    id?: string;
    index: number;
    choices?: Array<{
        index: number;
        delta: LLMResponseMessage;
        finish_reason?: FinishReason;
    }>;
    usage?: Usage;
    model?: string;
    object?: string;
    created?: number;
    error?: StreamChunkError;
}

// 流式回调函数
type StreamCallback = (chunk: Chunk) => void;
```

---

### 配置类型 (config.ts)

定义了 Provider 的配置结构。

```typescript
// 基础 API 配置
export interface BaseAPIConfig {
    /** API 基础 URL */
    baseURL: string;
    /** 模型名称 */
    model: string;
    /** 最大生成 token 数 */
    max_tokens: number;
    /** 最大上下文 token 数 */
    LLMMAX_TOKENS: number;
    /** 温度参数 */
    temperature: number;
    /** 请求超时时间（毫秒） */
    timeout?: number;
    /** 最大重试次数 */
    maxRetries?: number;
    /** 启用调试日志 */
    debug?: boolean;
}

// Provider 基础配置
export interface BaseProviderConfig extends BaseAPIConfig {
    /** API 密钥或凭证 */
    apiKey: string;
    /** 思考模式（部分 Provider 支持） */
    thinking?: boolean;
    /** 其他扩展字段 */
    [key: string]: unknown;
}

// OpenAI 兼容服务配置
export interface OpenAICompatibleConfig extends BaseProviderConfig {
    /** 可选的组织 ID（部分提供商需要） */
    organization?: string;
    /** 聊天补全接口路径，默认为 '/chat/completions' */
    chatCompletionsPath?: string;
    /** 是否在流式请求中默认要求返回 usage（默认 true） */
    enableStreamUsage?: boolean;
    /** 默认是否启用工具流式输出（请求级可被 generate options 覆盖） */
    tool_stream?: boolean;
}
```

---

### Provider 类型 (provider.ts)

`LLMProvider` 是所有 Provider 的抽象基类。

```typescript
abstract class LLMProvider {
    config: BaseProviderConfig;

    constructor(config: BaseProviderConfig) {
        this.config = config;
    }

    // 核心生成方法
    abstract generate(
        messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | null> | AsyncGenerator<Chunk>;

    // 配置访问方法
    abstract getTimeTimeout(): number;
    abstract getLLMMaxTokens(): number;
    abstract getMaxOutputTokens(): number;
}
```

> 接口说明：当前使用 `Promise | AsyncGenerator` 联合返回来统一入口；调用方需根据 `options.stream` 区分消费方式。

---

### 错误类型 (errors.ts)

提供了完整的错误类型体系，用于精细化的错误处理。

#### 错误类层次

```
LLMError (基类)
├── LLMRetryableError (可重试错误)
│   └── LLMRateLimitError (限流错误)
├── LLMPermanentError (永久性错误)
│   ├── LLMAuthError (认证错误 - 401/403)
│   ├── LLMNotFoundError (资源不存在 - 404)
│   └── LLMBadRequestError (请求错误 - 400)
└── LLMAbortedError (取消/中止错误)
```

#### 关键函数

| 函数 | 功能 |
|------|------|
| `calculateBackoff()` | 计算带 jitter 的指数退避延迟 |
| `createErrorFromStatus()` | 根据 HTTP 状态码创建错误 |
| `isRetryableError()` | 判断是否可重试错误 |
| `isPermanentError()` | 判断是否永久性错误 |
| `isAbortedError()` | 判断是否被取消 |
| `classifyAbortReason()` | 分类中止原因（timeout/idle_timeout/abort） |
| `isPermanentStreamChunkError()` | 判断流式响应中的永久性错误 |

#### 退避配置

```typescript
interface BackoffConfig {
    initialDelayMs?: number;   // 初始延迟（毫秒），默认 1000
    maxDelayMs?: number;        // 最大延迟（毫秒），默认 60000
    base?: number;             // 退避基数，默认 2
    jitter?: boolean;          // 是否添加随机因子，默认 true
    maxRetries?: number;       // 最大重试次数
}

// 算法：min(maxDelay, initialDelay * (base ^ retryCount)) * random(0.5, 1.5)
```

---

### Registry 类型 (types/registry.ts)

```typescript
type ProviderType = 'anthropic' | 'kimi' | 'deepseek' | 'glm' | 'minimax' | 'openai' | 'qwen';

type ModelId = 
    | 'claude-opus-4.6'
    | 'glm-4.7'
    | 'glm-5'
    | 'minimax-2.5'
    | 'kimi-k2.5'
    | 'deepseek-chat'
    | 'qwen3.5-plus'
    | 'qwen3.5-max'
    | 'qwen-kimi-k2.5'
    | 'qwen-glm-5'
    | 'qwen-minimax-2.5'
    | 'wr-claude-4.6';

interface ModelConfig {
    id: ModelId;
    provider: ProviderType;
    name: string;
    endpointPath: string;
    envApiKey: string;        // API Key 环境变量名
    envBaseURL: string;        // Base URL 环境变量名
    baseURL: string;
    model: string;
    max_tokens: number;
    LLMMAX_TOKENS: number;
    features: string[];
    apiKey?: string;
    temperature?: number;
    tool_stream?: boolean;
    thinking?: boolean;
    timeout?: number;
}
```

---

## 适配器模式

适配器模式用于处理不同 LLM 提供商的 API 差异，将提供商特定的请求/响应格式转换为统一格式。

### 基础适配器 (base.ts)

`BaseAPIAdapter` 是所有适配器的抽象基类。

```typescript
abstract class BaseAPIAdapter {
    // 转换请求体
    abstract transformRequest(options?: LLMRequest): LLMRequest;

    // 转换响应
    abstract transformResponse(response: unknown): LLMResponse;

    // 获取 HTTP 头
    abstract getHeaders(apiKey: string, config?: Record<string, unknown>): Headers;

    // 获取端点路径
    abstract getEndpointPath(): string;

    // 可选：自定义流式解析
    parseStreamAsync?(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Chunk>;
}
```

#### 工具方法

| 方法 | 功能 |
|------|------|
| `isMessageUsable()` | 检查消息是否有效（包含内容、工具调用或工具调用 ID） |
| `cleanMessage()` | 清理消息，移除内部字段，标准化内容格式 |
| `normalizeMessageContent()` | 标准化消息内容，保留 OpenAI 多模态数组结构 |

---

### 标准适配器 (standard.ts)

`StandardAdapter` 提供标准 OpenAI 兼容 API 的实现。

```typescript
export class StandardAdapter extends BaseAPIAdapter {
    readonly endpointPath: string;
    readonly defaultModel: string;

    constructor(options: { endpointPath?: string; defaultModel?: string } = {}) {
        super();
        this.endpointPath = options.endpointPath ?? '/chat/completions';
        this.defaultModel = options.defaultModel ?? 'gpt-4o';
    }

    transformRequest(options?: LLMRequest): LLMRequest {
        const { model, max_tokens, messages, temperature, stream, tool_stream, tools, thinking, abortSignal, ...rest } =
            options || ({} as LLMRequest & { abortSignal?: AbortSignal; thinking?: unknown });

        const extras = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));

        const body: LLMRequest = {
            ...extras,
            model: model || this.defaultModel,
            messages: this.cleanMessage(messages || []),
            max_tokens: max_tokens,
            temperature: temperature,
            stream: stream ?? false,
        };

        if (tool_stream !== undefined) {
            body.tool_stream = tool_stream;
        }

        if (tools && tools.length > 0) {
            body.tools = tools;
        }

        // 允许子类添加自定义转换
        return this.enrichRequestBody(body, options);
    }

    transformResponse(response: Record<string, unknown>): LLMResponse {
        const data = response as LLMResponse;
        if (!data.choices || data.choices.length === 0) {
            throw new Error(`Empty choices in response. Response: ${JSON.stringify(response, null, 2)}`);
        }
        return data;
    }

    getHeaders(apiKey: string): Headers {
        return new Headers({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        });
    }

    getEndpointPath(): string {
        return this.endpointPath;
    }

    /**
     * 子类的钩子方法，用于向请求体添加自定义字段
     * 覆盖此方法以添加特定于提供商的字段。
     */
    protected enrichRequestBody(body: LLMRequest, _options?: StandardTransformOptions): LLMRequest {
        return body;
    }
}
```

---

### Kimi 适配器 (kimi.ts)

`KimiAdapter` 继承自 `StandardAdapter`，添加了 Kimi 特有的功能。

```typescript
export class KimiAdapter extends StandardAdapter {
    constructor(options: { endpointPath?: string; defaultModel?: string } = {}) {
        super(options);
    }

    // 添加 thinking 配置
    transformRequest(options?: LLMRequest): LLMRequest {
        return {
            ...super.transformRequest(options),
            thinking: {
                type: options?.thinking ? 'enabled' : 'disabled',
            },
        };
    }

    // 添加 Kimi 平台标识头
    getHeaders(apiKey: string): Headers {
        const headers = super.getHeaders(apiKey);
        const kimiHeaders = getKimiHeaders();

        for (const [key, value] of Object.entries(kimiHeaders)) {
            headers.set(key, value);
        }

        return headers;
    }
}
```

#### Kimi 请求头说明

| 头名称 | 说明 | 示例值 |
|--------|------|--------|
| `X-Msh-Platform` | 平台标识 | `kimi_cli` |
| `X-Msh-Version` | 客户端版本 | `1.0.0` |
| `X-Msh-Device-Name` | 设备名称 | `hostname` |
| `X-Msh-Device-Model` | 设备型号 | `macOS 14.0 arm64` |
| `X-Msh-Os-Version` | 系统版本 | `23.0.0` |
| `X-Msh-Device-Id` | 设备唯一 ID | `md5 hash` |
| `User-Agent` | 用户代理 | `KimiCLI/1.0.0` |

---

### Anthropic 适配器 (anthropic.ts)

`AnthropicAdapter` 适配 Anthropic Claude API，差异较大，不能继承 `StandardAdapter`。

#### 与 OpenAI 的主要差异

| 方面 | OpenAI | Anthropic |
|------|--------|-----------|
| System Prompt | 作为消息 role | 单独的 `system` 字段 |
| 认证方式 | `Authorization: Bearer` | `x-api-key` + `anthropic-version` |
| API 端点 | `/v1/chat/completions` | `/v1/messages` |
| 响应格式 | `choices[].message` | `content[]` 数组 |
| 流式事件 | `data: {...}` | `message_start`, `content_block_delta` 等 |

#### 核心转换逻辑

```typescript
// 请求转换
transformRequest(options?: LLMRequest): LLMRequest {
    // 1. 提取 system 消息
    let systemPrompt = '';
    const conversationMessages: LLMRequestMessage[] = [];
    
    for (const msg of messages || []) {
        if (msg.role === 'system') {
            systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
        } else {
            conversationMessages.push(msg);
        }
    }

    // 2. 转换消息格式
    const anthropicMessages = this.convertMessages(conversationMessages);

    return {
        model: rest.model || this.defaultModel,
        max_tokens: rest.max_tokens || 4096,
        system: systemPrompt,           // 单独的 system 字段
        messages: anthropicMessages,
        stream: rest.stream ?? false,
        tools: tools?.map(...),         // 工具定义转换
    };
}

// 响应转换
transformResponse(response: unknown): LLMResponse {
    // 1. 提取文本内容
    const content: string[] = [];
    for (const block of anthropicResp.content || []) {
        if (block.type === 'text' && block.text) {
            content.push(block.text);
        }
    }

    // 2. 提取工具调用
    const toolCalls: ToolCall[] = [];
    for (const block of anthropicResp.content || []) {
        if (block.type === 'tool_use' && block.id && block.name) {
            toolCalls.push({
                id: block.id,
                type: 'function',
                index: toolCalls.length,
                function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input),
                },
            });
        }
    }

    // 3. 转换 finish_reason
    // end_turn → stop, max_tokens → length, tool_use → tool_calls
}
```

#### 流式事件解析

Anthropic 流式响应包含多种事件类型：

| 事件类型 | 说明 |
|----------|------|
| `message_start` | 消息开始，包含 ID 和模型信息 |
| `content_block_start` | 内容块开始（文本或工具调用） |
| `content_block_delta` | 内容块增量更新 |
| `content_block_stop` | 内容块结束 |
| `message_delta` | 消息结束，包含 usage |
| `message_stop` | 消息流结束 |

---

## HTTP 客户端

### HTTPClient (client.ts)

统一的 HTTP 客户端，提供单次请求执行、错误处理、超时控制。

```typescript
class HTTPClient {
    readonly debug: boolean;
    readonly defaultTimeoutMs?: number;

    async fetch(url: string, options: RequestInitWithOptions = {}): Promise<Response> {
        const requestOptions = this.applyDefaultSignal(options);
        
        try {
            const response = await this.executeFetch(url, requestOptions);
            
            // 检查 HTTP 错误
            if (!response.ok) {
                const errorText = await response.text();
                const retryAfterMs = this.extractRetryAfterMs(response);
                throw createErrorFromStatus(response.status, response.statusText, errorText, retryAfterMs);
            }
            
            return response;
        } catch (rawError) {
            throw this.normalizeError(rawError, requestOptions.signal);
        }
    }
}
```

> 说明：`HTTPClient.fetch()` 仅执行单次请求；重试策略（退避、最大重试次数）由 Agent/调用层统一控制。

#### 超时控制设计

```
Agent 层 (LLMCaller)
    │
    ├── 创建 AbortSignal.timeout(requestTimeout) 控制主链路超时
    │         │
    │         ▼
    ▼    HTTPClient.fetch(url, { signal })
                    │
                    ├── 如果调用方传入 signal → 使用传入的 signal
                    │
                    └── 如果未传入 signal 且配置了 defaultTimeoutMs
                                │
                                ▼
                        AbortSignal.timeout(defaultTimeoutMs) 兜底
```

#### 错误处理

| 错误场景 | 处理方式 |
|----------|----------|
| HTTP 4xx 状态码 | 创建对应永久性错误 |
| HTTP 429 限流 | `LLMRateLimitError`，提取 Retry-After |
| HTTP 5xx 服务错误 | `LLMRetryableError`（可重试） |
| 网络错误 (ECONNRESET 等) | `LLMRetryableError` |
| Body 超时 | `LLMRetryableError` |
| AbortSignal 超时 | `LLMRetryableError` |
| AbortSignal 取消 | `LLMAbortedError` |

---

### StreamParser (stream-parser.ts)

SSE（服务器发送事件）流解析器。

```typescript
class StreamParser {
    // 解析单行 SSE
    static parseSseLine(line: string): string | null {
        // 跳过空行和注释行
        // 提取 data: 后面的内容
        // 支持直接返回 JSON 对象
    }

    // 检查是否流结束
    static isStreamEnd(data: string): boolean {
        return data === '[DONE]';
    }

    // 安全 JSON 解析
    static safeJsonParse<T>(data: string): T | null {
        try {
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    // 异步解析流
    static async *parseAsync(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Chunk> {
        // 1. 持续读取流
        // 2. 按行分割缓冲区
        // 3. 解析每行数据
        // 4. 检测 [DONE] 结束标记
        // 5. try/finally 确保 reader 锁释放
    }
}
```

#### 解析流程

```
接收字节流
    │
    ▼
TextDecoder 解码 (stream: true)
    │
    ▼
按 \n 分割行
    │
    ▼
遍历每行 ─────────────────────────────────────────┐
    │                                             │
    ▼                                             ▼
parseSseLine(line)                           跳过空行/注释
    │                                             │
    ▼                                             ▼
提取 data: 内容                              返回 null
    │                                             │
    ▼                                             ▼
isStreamEnd? ──[DONE]──> 结束              继续下一行
    │
    ▼
safeJsonParse<Chunk>
    │
    ▼
yield chunk
```

---

## Provider 实现

### OpenAICompatibleProvider

通用的 OpenAI 兼容 Provider 实现，是大多数提供商的基础类。

```typescript
/** Provider 默认超时时间（毫秒），作为 Agent.requestTimeout 的回退值 */
const PROVIDER_DEFAULT_TIMEOUT = 1000 * 60 * 10; // 10分钟

export class OpenAICompatibleProvider extends LLMProvider {
    declare config: OpenAICompatibleConfig;
    readonly httpClient: HTTPClient;
    readonly adapter: BaseAPIAdapter;
    private readonly defaultTimeout: number;

    constructor(config: OpenAICompatibleConfig, adapter?: BaseAPIAdapter) {
        super(config);

        // 规范化 baseURL（移除末尾斜杠）
        const normalizedBaseURL = config.baseURL.replace(/\/$/, '');
        this.config = { ...config, baseURL: normalizedBaseURL };

        // 保存默认超时（供 Agent 回退使用）
        this.defaultTimeout = config.timeout ?? PROVIDER_DEFAULT_TIMEOUT;

        // 初始化 HTTP 客户端（standalone 调用时使用 provider timeout 兜底）
        this.httpClient = new HTTPClient({
            debug: config.debug ?? false,
            defaultTimeoutMs: this.defaultTimeout,
        });

        // 初始化 Adapter（未提供则使用标准适配器）
        this.adapter =
            adapter ??
            new StandardAdapter({
                defaultModel: config.model,
                endpointPath: config.chatCompletionsPath ?? '/chat/completions',
            });
    }

    generate(
        messages: LLMRequestMessage[],
        options?: LLMGenerateOptions
    ): Promise<LLMResponse | null> | AsyncGenerator<Chunk> {
        if (messages.length === 0) {
            return Promise.resolve(null);
        }

        const resolvedOptions = this.resolveGenerateOptions(options);
        const toolStream = (resolvedOptions?.tool_stream as boolean | undefined) ?? this.config.tool_stream;

        // 构建请求体
        const requestBody = this.adapter.transformRequest({
            model: resolvedOptions?.model ?? this.config.model,
            max_tokens: resolvedOptions?.max_tokens,
            temperature: this.config.temperature,
            messages,
            tool_stream: toolStream,
            thinking:
                (resolvedOptions?.thinking as boolean | undefined) ?? (this.config.thinking as boolean | undefined),
            ...(resolvedOptions ?? {}),
        });

        // 构建请求参数
        const requestParams = {
            url: this._resolveEndpoint(),
            body: requestBody,
            headers: this.adapter.getHeaders(this.config.apiKey),
            abortSignal: resolvedOptions?.abortSignal,
        };

        // 根据是否流式选择处理方式
        if (resolvedOptions?.stream) {
            return this._generateStream(requestParams);
        }

        return this._generateNonStream(requestParams);
    }

    /**
     * 统一处理生成选项，补齐流式 usage 配置
     */
    private resolveGenerateOptions(options?: LLMGenerateOptions): LLMGenerateOptions {
        if (!options) return {};

        const resolved: LLMGenerateOptions = { ...options };

        if (resolved.stream && this.shouldIncludeStreamUsage(resolved)) {
            resolved.stream_options = {
                ...(resolved.stream_options || {}),
                include_usage: true,
            };
        }

        return resolved;
    }

    private shouldIncludeStreamUsage(options: LLMGenerateOptions): boolean {
        if (!options.stream) return false;
        if (options.stream_options?.include_usage === false) return false;
        return this.config.enableStreamUsage !== false;
    }

    private _resolveEndpoint(): string {
        return `${this.config.baseURL}${this.adapter.getEndpointPath()}`;
    }

    private async _generateNonStream(params: {
        url: string;
        body: Record<string, unknown>;
        headers: Headers;
        abortSignal?: AbortSignal;
    }): Promise<LLMResponse> {
        const response = await this.httpClient.fetch(params.url, {
            method: 'POST',
            headers: params.headers,
            body: JSON.stringify(params.body),
            signal: params.abortSignal,
        });

        let data: unknown;
        try {
            data = await response.json();
        } catch (error) {
            throw new LLMError(
                `Failed to parse response as JSON: ${error instanceof Error ? error.message : String(error)}`,
                'INVALID_JSON'
            );
        }

        return this.adapter.transformResponse(data);
    }

    private async *_generateStream(params: {
        url: string;
        body: Record<string, unknown>;
        headers: Headers;
        abortSignal?: AbortSignal;
    }): AsyncGenerator<Chunk> {
        const response = await this.httpClient.fetch(params.url, {
            method: 'POST',
            headers: params.headers,
            body: JSON.stringify(params.body),
            signal: params.abortSignal,
        });

        if (!response.body) {
            throw new LLMError('Response body is not readable', 'NO_BODY');
        }

        // 如果适配器提供了自定义流式解析器，则使用它
        if (this.adapter.parseStreamAsync) {
            yield* this.adapter.parseStreamAsync(response.body.getReader());
        } else {
            // 否则使用默认的 OpenAI 流式解析器
            yield* StreamParser.parseAsync(response.body.getReader());
        }
    }

    getTimeTimeout(): number {
        return this.defaultTimeout;
    }

    getLLMMaxTokens(): number {
        return this.config.LLMMAX_TOKENS;
    }

    getMaxOutputTokens(): number {
        return this.config.max_tokens;
    }
}
```

#### 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      OpenAICompatibleProvider                   │
├─────────────────────────────────────────────────────────────────┤
│  generate(messages, options)                                    │
│         │                                                       │
│         ├──► 非流式: _generateNonStream()                       │
│         │           │                                           │
│         │           ├──► HTTPClient.fetch()                    │
│         │           │                                           │
│         │           └──► adapter.transformResponse()            │
│         │                                                       │
│         └──► 流式: _generateStream()                            │
│                     │                                           │
│                     ├──► HTTPClient.fetch()                    │
│                     │                                           │
│                     └──► (adapter.parseStreamAsync ||            │
│                            StreamParser.parseAsync)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         HTTPClient                               │
│  • 超时控制                                                      │
│  • 错误处理                                                      │
│  • Retry-After 支持                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Registry 系统

### 模型配置 (model-config.ts)

集中管理所有支持的模型配置。

```typescript
const MODEL_DEFINITIONS: Record<ModelId, Omit<ModelConfig, 'apiKey'>> = {
    'glm-4.7': {
        id: 'glm-4.7',
        provider: 'glm',
        name: 'GLM-4.7',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        endpointPath: '/chat/completions',
        envApiKey: 'GLM_API_KEY',
        envBaseURL: 'GLM_API_BASE',
        model: 'GLM-4.7',
        max_tokens: 8000,
        LLMMAX_TOKENS: 200 * 1000,
        features: ['streaming', 'function-calling', 'vision'],
    },
    'kimi-k2.5': {
        id: 'kimi-k2.5',
        provider: 'kimi',
        name: 'Kimi K2.5',
        baseURL: 'https://api.kimi.com/coding/v1',
        endpointPath: '/chat/completions',
        envApiKey: 'KIMI_API_KEY',
        envBaseURL: 'KIMI_API_BASE',
        model: 'kimi-for-coding',
        max_tokens: 10000,
        LLMMAX_TOKENS: 200 * 1000,
        features: ['streaming', 'function-calling', 'reasoning'],
        temperature: 0.6,
    },
    // ... 更多模型
};
```

#### 支持的模型

| Model ID | Provider | 特性 |
|----------|----------|------|
| `glm-4.7` | GLM | streaming, function-calling, vision |
| `glm-5` | GLM | streaming, function-calling, vision |
| `minimax-2.5` | MiniMax | streaming, function-calling |
| `kimi-k2.5` | Kimi | streaming, function-calling, reasoning |
| `deepseek-chat` | DeepSeek | streaming, function-calling |
| `qwen3.5-plus` | Qwen | streaming, function-calling |
| `qwen3.5-max` | Qwen | streaming, function-calling |
| `claude-opus-4.6` | Anthropic | streaming, function-calling, vision |
| `wr-claude-4.6` | OpenAI | streaming, function-calling, vision |

---

### ProviderFactory (provider-factory.ts)

负责创建 Provider 实例的工厂类。

```typescript
class ProviderFactory {
    // 从环境变量创建 Provider
    static createFromEnv(modelId: ModelId, overrides?: Partial<ModelConfig>): OpenAICompatibleProvider {
        const modelConfig = MODEL_DEFINITIONS[modelId];
        
        // 从环境变量获取 API Key 和 Base URL
        const apiKey = process.env[modelConfig.envApiKey] || '';
        const baseURL = process.env[modelConfig.envBaseURL] || modelConfig.baseURL;

        // 创建适配器
        const adapter = ProviderFactory.createAdapter(modelId);

        return new OpenAICompatibleProvider(config, adapter);
    }

    // 创建指定类型的 Provider
    static create(modelId: ModelId, config: BaseProviderConfig): OpenAICompatibleProvider {
        const adapter = ProviderFactory.createAdapter(modelId);
        return new OpenAICompatibleProvider(config, adapter);
    }

    // 创建适配器
    static createAdapter(modelId: ModelId): BaseAPIAdapter {
        switch (modelId) {
            case 'claude-opus-4.6':
                return new AnthropicAdapter({...});
            case 'kimi-k2.5':
            case 'qwen-kimi-k2.5':
            case 'glm-5':
                return new KimiAdapter({...});
            default:
                return new StandardAdapter({...});
        }
    }
}
```

---

### ProviderRegistry (registry.ts)

提供模型查询和实例创建的统一入口。

```typescript
class ProviderRegistry {
    // 从环境变量创建 Provider
    static createFromEnv = ProviderFactory.createFromEnv;

    // 创建 Provider
    static create = ProviderFactory.create;

    // 获取所有模型配置
    static listModels(): ModelConfig[];

    // 获取指定厂商的所有模型
    static listModelsByProvider(provider: ProviderType): ModelConfig[];

    // 获取所有模型 ID
    static getModelIds(): ModelId[];

    // 获取模型配置
    static getModelConfig(modelId: ModelId): ModelConfig;

    // 获取模型显示名称
    static getModelName(modelId: ModelId): string;

    // 获取所有支持的厂商类型
    static getProviders(): ProviderType[];
}

// 便捷访问器
export const Models = {
    get glm47(): ModelConfig {...},
    get glm5(): ModelConfig {...},
    get minimax25(): ModelConfig {...},
    get kimiK25(): ModelConfig {...},
    get deepseekChat(): ModelConfig {...},
    get qwen35Plus(): ModelConfig {...},
};
```

#### 使用示例

```typescript
import { ProviderRegistry, Models } from './providers';

// 方式1: 从环境变量创建
const provider = ProviderRegistry.createFromEnv('glm-4.7');

// 方式2: 覆盖配置
const provider2 = ProviderRegistry.createFromEnv('kimi-k2.5', {
    temperature: 0.5,
    max_tokens: 8000,
});

// 方式3: 使用便捷访问器
const config = Models.kimiK25;

// 方式4: 自定义配置
const provider3 = ProviderRegistry.create('glm-4.7', {
    apiKey: 'sk-xxx',
    baseURL: 'https://custom-endpoint.com',
    model: 'glm-4-flash',
    max_tokens: 4096,
    LLMMAX_TOKENS: 128000,
    temperature: 0.1,
});
```

---

## 平台工具 (kimi-headers.ts)

生成 Kimi API 请求所需的客户端标识信息。

### 核心功能

| 功能 | 说明 |
|------|------|
| `getCommonHeaders()` | 获取通用请求头 |
| `getUserAgent()` | 获取 User-Agent 字符串 |
| `getKimiHeaders()` | 获取完整的 Kimi 请求头 |

### 设备 ID 管理

```typescript
function getDeviceId(): string {
    // 1. 尝试从 ~/.coding-agent/device_id 读取
    // 2. 不存在则生成新的 MD5 hash
    // 3. 保存到缓存文件（权限 600）
    // 4. 失败时生成临时 ID
}
```

### 设备信息

```typescript
function getDeviceModel(): string {
    // Darwin (macOS) → "macOS 14.0 arm64"
    // Windows → "Windows 11 x64"
    // Linux → "Linux 5.0.0 arm64"
}

function getMacOSVersion(darwinVersion: string): string {
    // Darwin 版本映射
    // 23 → 14.0 (Sonoma)
    // 22 → 13.0 (Ventura)
    // 21 → 12.0 (Monterey)
    // 20 → 11.0 (Big Sur)
}
```

---

## 总结

### 设计模式

| 模式 | 应用场景 |
|------|----------|
| **适配器模式** | `BaseAPIAdapter` 处理不同提供商的 API 差异 |
| **工厂模式** | `ProviderFactory` 创建 Provider 实例 |
| **单例/静态方法** | `ProviderRegistry`、`StreamParser` |
| **模板方法** | `StandardAdapter.enrichRequestBody()` 钩子 |

### 扩展新的 Provider

1. 在 `model-config.ts` 添加模型配置
2. 创建适配器类（继承 `BaseAPIAdapter` 或 `StandardAdapter`）
3. 在 `provider-factory.ts` 的 `createAdapter()` 中添加 case
4. 如有特殊请求头，在 `kimi-headers.ts` 类似的文件中实现

### 错误处理流程

```
请求失败
    │
    ▼
HTTPClient.normalizeError()
    │
    ├──► HTTP 状态码 → createErrorFromStatus()
    │                    │
    │                    ├── 401/403 → LLMAuthError
    │                    ├── 404 → LLMNotFoundError
    │                    ├── 400 → LLMBadRequestError
    │                    ├── 429 → LLMRateLimitError
    │                    └── 5xx → LLMRetryableError
    │
    ├──► 网络错误 → LLMRetryableError
    │
    └──► AbortSignal → LLMAbortedError / LLMRetryableError
              │
              ▼
       Agent 重试逻辑判断
       (isRetryableError?)
```
