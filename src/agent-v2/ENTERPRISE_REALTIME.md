# 企业级无状态 Agent 实时存储方案

## 一、问题分析

```
当前设计的问题：
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Agent 执行 (可能 10 分钟+)                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │ Step 1  │→ │ Step 2  │→ │ Step 3  │→ │ Step N  │          │
│  │         │  │         │  │         │  │         │          │
│  │ 消息在   │  │ 消息在  │  │ 消息在  │  │ 消息在  │          │
│  │ 内存     │  │ 内存    │  │ 内存    │  │ 内存    │          │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │
│                               │                                │
│                               ▼                                │
│                    ❌ 只有完成时才存储                         │
│                                                                 │
│  问题:                                                           │
│  - Agent 崩溃 = 所有消息丢失                                     │
│  - 页面关闭 = 请求中断                                           │
│  - 无法实时查看执行进度                                          │
│  - 无法从中间步骤恢复                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、解决方案概述

```
核心思路: 实时存储 + 后台执行 + 检查点恢复

┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  1. 实时存储                                                    │
│     - 每条消息产生时立即存储                                     │
│     - 每个 Step 完成时保存检查点                                  │
│                                                                 │
│  2. 后台执行 (Fire and Forget)                                  │
│     - API 立即返回 executionId                                   │
│     - Worker 后台执行                                            │
│     - 页面关闭不受影响                                           │
│                                                                 │
│  3. 故障恢复                                                    │
│     - 检查点记录执行位置                                         │
│     - 从 lastMessageId 恢复                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、核心概念

| 概念 | 说明 |
|------|------|
| **sessionId** | 整个对话（用户和 AI 之间的会话） |
| **executionId** | 一次 agent.run()（用户的一次请求） |
| **stepIndex** | 每次循环（内部步骤） |

```
Session: sess_001 (用户整个对话)
    │
    └── Execution: exec_001 (用户第一次请求)
            │
            ├── Step 1 (stepIndex=1)
            ├── Step 2 (stepIndex=2)
            └── Step 3 (stepIndex=3)
                    │
                    └── 返回结果
```

---

## 四、实时存储架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      实时存储架构                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                    回调驱动                               │   │
│  │                                                           │   │
│  │   onMessage: 每条消息产生时触发                          │   │
│  │   - Redis 实时写入 (< 1ms)                              │   │
│  │   - Kafka 异步持久化                                     │   │
│  │   - SSE 推送客户端                                        │   │
│  │                                                           │   │
│  │   onCheckpoint: 每个 Step 完成时触发                     │   │
│  │   - 保存执行位置 (stepIndex + lastMessageId)             │   │
│  │   - 用于故障恢复                                          │   │
│  │                                                           │   │
│  └───────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                      存储层                               │   │
│  │                                                           │   │
│  │   ┌─────────────┐    ┌─────────────┐                   │   │
│  │   │   Redis     │    │   Kafka     │                   │   │
│  │   │  (缓存/检查点)│    │  (持久化)  │                   │   │
│  │   └─────────────┘    └─────────────┘                   │   │
│  │                                                           │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、Agent 回调机制设计

```typescript
// ============================================================
// 消息类型定义
// ============================================================

interface Message {
  messageId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  timestamp: number;
  metadata?: Record<string, any>;
}

interface ToolCall {
  id: string;
  type: 'function';
  name: string;
  arguments: string;
}

interface Tool {
  name: string;
  description: string;
  parameters: any;
}

// ============================================================
// Agent 输入输出接口
// ============================================================

interface AgentInput {
  executionId: string;           // 任务 ID
  conversationId: string;        // 会话 ID
  messages: Message[];           // Context 消息列表
  systemPrompt?: string;         // 系统提示
  tools?: Tool[];                // 可用工具
  config?: LLMConfig;           // LLM 配置
  maxSteps?: number;            // 最大步数
  startStep?: number;           // 起始步骤 (用于恢复)
}

interface AgentOutput {
  messages: Message[];           // 包含新增消息
  finishReason: 'stop' | 'max_steps' | 'error';
  steps: number;                // 执行的步数
}

interface LLMConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

interface LLMResponse {
  message: Message;
  toolCalls?: ToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  finishReason?: string;
}

// ============================================================
// 回调接口
// ============================================================

interface AgentCallbacks {
  // 每产生一条新消息时回调 (实时存储)
  onMessage: (message: Message) => void | Promise<void>;
  
  // 每个 Step 完成时回调 (检查点)
  onCheckpoint: (checkpoint: ExecutionCheckpoint) => void | Promise<void>;
  
  // 进度更新回调
  onProgress?: (progress: ExecutionProgress) => void | Promise<void>;
  
  // 错误回调
  onError?: (error: Error) => void | Promise<void>;
}

interface ExecutionCheckpoint {
  executionId: string;
  stepIndex: number;           // 当前步骤
  lastMessageId: string;       // 最后一条消息 ID (用于恢复)
  lastMessageTime: number;     // 时间戳
  canResume: boolean;          // 是否可恢复
}

interface ExecutionProgress {
  executionId: string;
  stepIndex: number;
  currentAction: 'llm' | 'tool' | 'waiting';
  messageCount: number;
}

// ============================================================
// LLM Provider 接口
// ============================================================

interface LLMProvider {
  // 生成响应 (非流式)
  generate(messages: Message[], config?: LLMConfig): Promise<LLMResponse>;
  
  // 生成响应 (流式)
  generateStream(
    messages: Message[], 
    config?: LLMConfig
  ): AsyncGenerator<Chunk>;
}

interface Chunk {
  id: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
}

// ============================================================
// Tool Executor 接口
// ============================================================

interface ToolExecutor {
  execute(toolCall: ToolCall): Promise<Message>;
  registerTool(tool: Tool, handler: Function): void;
}

// ============================================================
// 无状态 Agent 完整实现
// ============================================================

class StatelessAgent {
  private llmProvider: LLMProvider;
  private toolExecutor: ToolExecutor;
  
  constructor(llmProvider: LLMProvider, toolExecutor: ToolExecutor) {
    this.llmProvider = llmProvider;
    this.toolExecutor = toolExecutor;
  }
  
  async run(input: AgentInput, callbacks?: AgentCallbacks): Promise<AgentOutput> {
    let { 
      messages, 
      maxSteps = 100, 
      startStep = 1 
    } = input;
    
    let stepIndex = startStep - 1;
    let finishReason: 'stop' | 'max_steps' | 'error' = 'stop';
    
    // 主循环
    while (stepIndex < maxSteps) {
      stepIndex++;
      
      try {
        // 回调: 进度
        callbacks?.onProgress?.({
          executionId: input.executionId,
          stepIndex,
          currentAction: 'llm',
          messageCount: messages.length
        });
        
        // 1. 调用 LLM
        const response = await this.llmProvider.generate(messages, input.config);
        
        // 2. 添加助手消息
        const assistantMessage = response.message;
        messages.push(assistantMessage);
        
        // 回调: 新消息 (实时存储)
        await this.safeCallback(callbacks?.onMessage, assistantMessage);
        
        // 3. 检查工具调用
        if (response.toolCalls && response.toolCalls.length > 0) {
          // 回调: 进度
          callbacks?.onProgress?.({
            executionId: input.executionId,
            stepIndex,
            currentAction: 'tool',
            messageCount: messages.length
          });
          
          // 4. 执行工具调用
          for (const toolCall of response.toolCalls) {
            const toolResult = await this.toolExecutor.execute(toolCall);
            messages.push(toolResult);
            
            // 回调: 工具结果 (实时存储)
            await this.safeCallback(callbacks?.onMessage, toolResult);
          }
          
          // 回调: 检查点 (每个 Step 完成)
          const lastMessage = messages[messages.length - 1];
          const checkpoint: ExecutionCheckpoint = {
            executionId: input.executionId,
            stepIndex,
            lastMessageId: lastMessage?.messageId || '',
            lastMessageTime: Date.now(),
            canResume: true
          };
          await this.safeCallback(callbacks?.onCheckpoint, checkpoint);
          
          // 继续下一轮
          continue;
        }
        
        // 5. 无工具调用，完成
        finishReason = 'stop';
        break;
        
      } catch (error) {
        console.error(`[Agent] Step ${stepIndex} error:`, error);
        
        // 回调: 错误
        await this.safeCallback(callbacks?.onError, error as Error);
        
        // 检查是否是可恢复错误
        if (this.isRetryableError(error)) {
          // 可以重试，继续循环
          continue;
        }
        
        finishReason = 'error';
        break;
      }
    }
    
    // 检查是否是达到最大步数
    if (stepIndex >= maxSteps) {
      finishReason = 'max_steps';
    }
    
    return {
      messages,
      finishReason,
      steps: stepIndex - startStep + 1
    };
  }
  
  // 安全执行回调 (防止回调抛出异常)
  private async safeCallback<T>(
    callback: ((arg: T) => void | Promise<void>) | undefined, 
    arg: T
  ): Promise<void> {
    if (!callback) return;
    
    try {
      await callback(arg);
    } catch (error) {
      console.error('[Agent] Callback error:', error);
    }
  }
  
  // 判断是否可重试
  private isRetryableError(error: any): boolean {
    const retryableCodes = ['RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR'];
    return error?.code && retryableCodes.includes(error.code);
  }
  
  // ============================================================
  // 流式版本: runStream
  // 适用于需要实时显示每个 chunk 的场景
  // ============================================================
  
  async *runStream(
    input: AgentInput, 
    callbacks?: AgentCallbacks
  ): AsyncGenerator<StreamEvent, any, unknown> {
    let { 
      messages, 
      maxSteps = 100, 
      startStep = 1 
    } = input;
    
    let stepIndex = startStep - 1;
    
    while (stepIndex < maxSteps) {
      stepIndex++;
      
      try {
        // 回调: 进度
        yield {
          type: 'progress',
          data: {
            executionId: input.executionId,
            stepIndex,
            currentAction: 'llm',
            messageCount: messages.length
          }
        };
        
        // 1. 流式调用 LLM
        const stream = this.llmProvider.generateStream(messages, input.config);
        
        // 构建助手消息
        const assistantMessage: Message = {
          messageId: generateId('msg_'),
          role: 'assistant',
          content: '',
          timestamp: Date.now()
        };
        
        let toolCalls: ToolCall[] = [];
        
        // 2. 处理流式响应
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          
          // 更新 content
          if (delta?.content) {
            assistantMessage.content += delta.content;
            
            // 回调: 内容更新
            yield {
              type: 'chunk',
              data: {
                messageId: assistantMessage.messageId,
                content: delta.content,
                delta: true
              }
            };
          }
          
          // 更新 tool_calls
          if (delta?.tool_calls) {
            toolCalls = this.mergeToolCalls(toolCalls, delta.tool_calls);
            
            // 回调: 工具调用
            yield {
              type: 'tool_call',
              data: {
                messageId: assistantMessage.messageId,
                toolCalls
              }
            };
          }
          
          // 检查完成
          if (chunk.choices[0]?.finish_reason) {
            break;
          }
        }
        
        // 3. 完成消息构建
        assistantMessage.tool_calls = toolCalls.length > 0 ? toolCalls : undefined;
        messages.push(assistantMessage);
        
        // 回调: 新消息
        await this.safeCallback(callbacks?.onMessage, assistantMessage);
        
        // 4. 处理工具调用
        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            yield {
              type: 'progress',
              data: {
                stepIndex,
                currentAction: 'tool',
                messageCount: messages.length
              }
            };
            
            // 执行工具
            const toolResult = await this.toolExecutor.execute(toolCall);
            messages.push(toolResult);
            
            // 回调: 工具结果
            await this.safeCallback(callbacks?.onMessage, toolResult);
            
            // 推送工具结果
            yield {
              type: 'tool_result',
              data: toolResult
            };
          }
          
          // 回调: 检查点
          const lastMessage = messages[messages.length - 1];
          const checkpoint: ExecutionCheckpoint = {
            executionId: input.executionId,
            stepIndex,
            lastMessageId: lastMessage?.messageId || '',
            lastMessageTime: Date.now(),
            canResume: true
          };
          await this.safeCallback(callbacks?.onCheckpoint, checkpoint);
          
          // 推送检查点
          yield {
            type: 'checkpoint',
            data: checkpoint
          };
          
          continue;
        }
        
        // 5. 无工具调用，完成
        yield {
          type: 'done',
          data: {
            finishReason: 'stop',
            steps: stepIndex - startStep + 1
          }
        };
        
        break;
        
      } catch (error) {
        console.error(`[Agent] Step ${stepIndex} error:`, error);
        
        await this.safeCallback(callbacks?.onError, error as Error);
        
        yield {
          type: 'error',
          data: { message: (error as Error).message }
        };
        
        break;
      }
    }
  }
  
  // 合并工具调用
  private mergeToolCalls(
    existing: ToolCall[], 
    newCalls: ToolCall[]
  ): ToolCall[] {
    for (const newCall of newCalls) {
      const existingCall = existing.find(c => c.id === newCall.id);
      
      if (existingCall) {
        existingCall.arguments += newCall.arguments;
      } else {
        existing.push({ ...newCall });
      }
    }
    return existing;
  }
}

interface StreamEvent {
  type: 'chunk' | 'tool_call' | 'tool_result' | 'progress' | 'checkpoint' | 'done' | 'error';
  data: any;
}
```

## 六、实时存储实现

```typescript
class RealTimeStorage {
  // 保存消息到 Redis (毫秒级延迟)
  async saveMessage(conversationId: string, message: Message): Promise<void> {
    const key = `conversation:${conversationId}:messages`;
    await this.redis.rpush(key, JSON.stringify(message));
    await this.redis.expire(key, 1800); // 30 分钟过期
  }
  
  // 保存检查点 (只存位置，不重复存储消息)
  async saveCheckpoint(checkpoint: ExecutionCheckpoint): Promise<void> {
    const key = `execution:${checkpoint.executionId}:checkpoint`;
    await this.redis.hset(key, {
      stepIndex: checkpoint.stepIndex.toString(),
      lastMessageId: checkpoint.lastMessageId,
      lastMessageTime: checkpoint.lastMessageTime.toString(),
      canResume: checkpoint.canResume ? '1' : '0'
    }, { EX: 86400 });
  }
  
  // 获取检查点
  async getLatestCheckpoint(executionId: string): Promise<ExecutionCheckpoint | null> {
    const key = `execution:${executionId}:checkpoint`;
    const data = await this.redis.hgetall(key);
    if (!data) return null;
    
    return {
      executionId,
      stepIndex: parseInt(data.stepIndex),
      lastMessageId: data.lastMessageId,
      lastMessageTime: parseInt(data.lastMessageTime),
      canResume: data.canResume === '1'
    };
  }
  
  // 获取检查点后的消息 (用于恢复)
  async getMessagesAfterCheckpoint(
    conversationId: string, 
    lastMessageId: string
  ): Promise<Message[]> {
    const allMessages = await this.redis.lrange(
      `conversation:${conversationId}:messages`, 0, -1
    );
    
    const messages: Message[] = [];
    let found = false;
    
    for (const msgStr of allMessages) {
      const msg = JSON.parse(msgStr);
      if (msg.messageId === lastMessageId) {
        found = true;
        continue;
      }
      if (found) {
        messages.push(msg);
      }
    }
    
    return messages;
  }
}
```

---

## 七、后台执行机制

### 问题

```
传统模式 (阻塞):
用户 ──▶ API ──▶ Agent 执行 ──▶ 等待完成 ──▶ 返回结果
                         │
                         └─ 页面关闭 = 请求中断 ❌

后台模式 (非阻塞):
用户 ──▶ API ──▶ 创建 Task ──▶ 返回 Task ID ──▶ 立即返回 ✓
                      │
                      ▼
                ┌─────────┐
                │  Task   │ 后台执行
                │  Queue  │◀── 页面关闭不受影响
                └─────────┘
                      │
                      ▼
                存储结果 ── 用户可查询
```

### 执行流程

```
1. 用户发起请求
   POST /api/v1/executions
   { conversationId, message: "帮我写排序算法" }
   
   Response: { executionId: "exec_001", status: "CREATED" } ← 立即返回!

2. 创建任务并放入队列
   TaskQueue.push({ executionId, message, createdAt })
   更新状态: CREATED → QUEUED

3. Worker 消费任务
   - 更新状态: QUEUED → RUNNING
   - 执行 Agent
   - onMessage: 实时存储 + SSE 推送
   - onCheckpoint: 保存检查点

4. 执行完成
   更新状态: RUNNING → COMPLETED
   保存最终结果

5. 用户查询结果
   GET /api/v1/executions/exec_001
   { status: "COMPLETED", messages: [...] }
```

### API 设计

```typescript
// 创建执行 (立即返回)
POST /api/v1/executions
Body: { conversationId, message }
Response: { executionId, status: 'CREATED' }

// 查询执行状态和结果
GET /api/v1/executions/{executionId}
Response: {
  executionId, conversationId,
  status: 'CREATED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED',
  stepIndex?, result?, messages?, error?
}

// 实时消息流 (SSE)
GET /api/v1/executions/{executionId}/stream

// 恢复执行 (崩溃后)
POST /api/v1/executions/{executionId}/resume
```

### Worker 实现

```typescript
// ============================================================
// 1. 依赖注入配置
// ============================================================

// 创建依赖容器
class DIContainer {
 : private services Map<string, any> = new Map();
  
  // 注册服务
  register<T>(name: string, instance: T): void {
    this.services.set(name, instance);
  }
  
  // 获取服务
  get<T>(name: string): T {
    return this.services.get(name);
  }
}

// 初始化容器
const container = new DIContainer();

// 注册 Redis 客户端
const redis = new Redis({ host: 'localhost', port: 6379 });
container.register('redis', redis);

// 注册消息队列
const taskQueue = new TaskQueue(redis);
container.register('taskQueue', taskQueue);

// 注册存储服务
const messageStorage = new MessageStorage(redis, kafka);
container.register('messageStorage', messageStorage);

const checkpointService = new CheckpointService(redis);
container.register('checkpointService', checkpointService);

const executionService = new ExecutionService(redis);
container.register('executionService', executionService);

// 注册 Context 服务
const contextService = new ContextService(redis, clickhouse);
container.register('contextService', contextService);

// 注册 SSE 发布器
const ssePublisher = new SSEPublisher();
container.register('ssePublisher', ssePublisher);

// 注册 LLM 提供商
const llmProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_KEY });
container.register('llmProvider', llmProvider);

// 注册工具执行器
const toolExecutor = new ToolExecutor();
container.register('toolExecutor', toolExecutor);

// 创建无状态 Agent
const agent = new StatelessAgent(llmProvider, toolExecutor);
container.register('agent', agent);

// ============================================================
// 2. ExecutionWorker 完整实现
// ============================================================

class ExecutionWorker {
  private queue: TaskQueue;
  private agent: StatelessAgent;
  private executionService: ExecutionService;
  private messageStorage: MessageStorage;
  private checkpointService: CheckpointService;
  private contextService: ContextService;
  private ssePublisher: SSEPublisher;
  
  // 构造函数注入依赖
  constructor(
    queue: TaskQueue,
    agent: StatelessAgent,
    executionService: ExecutionService,
    messageStorage: MessageStorage,
    checkpointService: CheckpointService,
    contextService: ContextService,
    ssePublisher: SSEPublisher
  ) {
    this.queue = queue;
    this.agent = agent;
    this.executionService = executionService;
    this.messageStorage = messageStorage;
    this.checkpointService = checkpointService;
    this.contextService = contextService;
    this.ssePublisher = ssePublisher;
  }
  
  // 启动 Worker
  async start(): Promise<void> {
    console.log('[Worker] Starting...');
    
    while (true) {
      try {
        // 从队列获取任务 (阻塞等待)
        // key: 队列名称, timeout: 超时时间(0=无限等待)
        const task = await this.queue.brpop('task_queue', 0);
        
        if (task) {
          console.log(`[Worker] Received task: ${task.executionId}`);
          await this.processTask(task);
        }
      } catch (error) {
        console.error('[Worker] Error:', error);
        // 短暂等待后继续
        await this.sleep(1000);
      }
    }
  }
  
  // 处理单个任务
  async processTask(task: Task): Promise<void> {
    const { executionId, conversationId, message } = task;
    
    console.log(`[Worker] Processing task: ${executionId}`);
    
    // 1. 尝试获取锁 (防止重复执行)
    const lockAcquired = await this.executionService.acquireLock(executionId, 'worker-1');
    if (!lockAcquired) {
      console.log(`[Worker] Task ${executionId} is being processed by another worker`);
      return;
    }
    
    try {
      // 2. 更新状态为 RUNNING
      await this.executionService.updateStatus(executionId, 'RUNNING');
      
      // 3. 检查是否有未完成的检查点
      const checkpoint = await this.checkpointService.getLatestCheckpoint(executionId);
      
      let messages: Message[] = [];
      let startStep = 1;
      
      if (checkpoint && checkpoint.canResume) {
        // 4a. 恢复执行
        console.log(`[Worker] Resuming from checkpoint: step ${checkpoint.stepIndex}`);
        
        // 加载上下文
        const context = await this.contextService.load(conversationId);
        
        // 获取检查点后的消息
        const newMessages = await this.messageStorage.getMessagesAfterCheckpoint(
          conversationId,
          checkpoint.lastMessageId
        );
        
        messages = [...context.messages, ...newMessages];
        startStep = checkpoint.stepIndex + 1;
        
      } else {
        // 4b. 全新执行
        console.log(`[Worker] Starting new execution`);
        
        // 加载上下文
        const context = await this.contextService.load(conversationId);
        
        // 添加用户消息
        const userMessage: Message = {
          messageId: generateId('msg_'),
          role: 'user',
          content: message.content,
          timestamp: Date.now()
        };
        
        messages = [...context.messages, userMessage];
        
        // 实时存储用户消息
        await this.messageStorage.save(conversationId, userMessage);
      }
      
      // 5. 获取系统提示和工具配置
      const context = await this.contextService.load(conversationId);
      
      // 6. 构造 Agent 输入
      const input: AgentInput = {
        executionId,
        conversationId,
        messages,
        systemPrompt: context.systemPrompt,
        tools: context.tools,
        startStep,  // 从指定步骤开始
        callbacks: {
          // 实时消息回调
          onMessage: async (msg: Message) => {
            // 存储消息到 Redis + Kafka
            await this.messageStorage.save(conversationId, msg);
            
            // SSE 推送给在线用户
            this.ssePublisher.publish(executionId, {
              type: 'message',
              data: msg
            });
            
            console.log(`[Worker] Message saved: ${msg.messageId}`);
          },
          
          // 检查点回调
          onCheckpoint: async (checkpoint: ExecutionCheckpoint) => {
            // 保存检查点
            await this.checkpointService.saveCheckpoint(checkpoint);
            
            // 更新执行进度
            await this.executionService.updateProgress(executionId, {
              stepIndex: checkpoint.stepIndex,
              lastMessageId: checkpoint.lastMessageId
            });
            
            console.log(`[Worker] Checkpoint saved: step ${checkpoint.stepIndex}`);
          },
          
          // 进度回调
          onProgress: async (progress: ExecutionProgress) => {
            // 更新进度
            await this.executionService.updateProgress(executionId, {
              currentAction: progress.currentAction,
              stepIndex: progress.stepIndex,
              messageCount: progress.messageCount
            });
            
            // SSE 推送进度
            this.ssePublisher.publish(executionId, {
              type: 'progress',
              data: progress
            });
          },
          
          // 错误回调
          onError: async (error: Error) => {
            console.error(`[Worker] Error:`, error);
            
            // 保存错误检查点
            await this.checkpointService.saveCheckpoint({
              executionId,
              stepIndex: 0,
              lastMessageId: '',
              lastMessageTime: Date.now(),
              canResume: false
            });
            
            // 更新状态为失败
            await this.executionService.updateStatus(executionId, 'FAILED', {
              error: error.message
            });
            
            // SSE 推送错误
            this.ssePublisher.publish(executionId, {
              type: 'error',
              data: { message: error.message }
            });
          }
        }
      };
      
      // 7. 执行 Agent
      console.log(`[Worker] Starting agent execution from step ${startStep}`);
      const result = await this.agent.run(input);
      
      // 8. 执行完成
      const finalMessage = result.messages[result.messages.length - 1];
      
      await this.executionService.updateStatus(executionId, 'COMPLETED', {
        result: finalMessage?.content,
        steps: result.steps,
        finishReason: result.finishReason
      });
      
      // SSE 推送完成
      this.ssePublisher.publish(executionId, {
        type: 'done',
        data: {
          result: finalMessage?.content,
          steps: result.steps
        }
      });
      
      console.log(`[Worker] Task completed: ${executionId}`);
      
    } catch (error) {
      // 执行失败
      console.error(`[Worker] Task failed: ${executionId}`, error);
      
      await this.executionService.updateStatus(executionId, 'FAILED', {
        error: (error as Error).message
      });
      
    } finally {
      // 释放锁
      await this.executionService.releaseLock(executionId);
    }
  }
  
  // 辅助方法: 睡眠
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================
// 3. 启动 Worker
// ============================================================

async function main() {
  // 从容器获取依赖
  const queue = container.get<TaskQueue>('taskQueue');
  const agent = container.get<StatelessAgent>('agent');
  const executionService = container.get<ExecutionService>('executionService');
  const messageStorage = container.get<MessageStorage>('messageStorage');
  const checkpointService = container.get<CheckpointService>('checkpointService');
  const contextService = container.get<ContextService>('contextService');
  const ssePublisher = container.get<SSEPublisher>('ssePublisher');
  
  // 创建 Worker 实例
  const worker = new ExecutionWorker(
    queue,
    agent,
    executionService,
    messageStorage,
    checkpointService,
    contextService,
    ssePublisher
  );
  
  // 启动
  await worker.start();
}

// 运行
main().catch(console.error);
```

---

### 依赖服务详细说明

#### 1. TaskQueue (任务队列)

```typescript
class TaskQueue {
  constructor(private redis: Redis) {}
  
  // 放入任务 (LPUSH)
  async push(task: Task): Promise<void> {
    await this.redis.lpush('task_queue', JSON.stringify(task));
  }
  
  // 阻塞取出任务 (BRPOP)
  async brpop(timeout: number = 0): Promise<Task | null> {
    const result = await this.redis.brpop('task_queue', timeout);
    if (result) {
      return JSON.parse(result[1]);
    }
    return null;
  }
}
```

#### 2. ExecutionService (执行状态管理)

```typescript
class ExecutionService {
  constructor(private redis: Redis) {}
  
  // 更新状态
  async updateStatus(executionId: string, status: string, extra?: any): Promise<void> {
    const key = `execution:${executionId}`;
    const update: any = { status, updatedAt: Date.now(), ...extra };
    
    if (status === 'COMPLETED' || status === 'FAILED') {
      update.completedAt = Date.now();
    }
    
    await this.redis.hset(key, update);
  }
  
  // 获取锁 (防止重复执行)
  async acquireLock(executionId: string, workerId: string): Promise<boolean> {
    const key = `lock:execution:${executionId}`;
    const result = await this.redis.set(key, workerId, {
      NX: true,  // 只有不存在时设置
      EX: 300     // 5分钟超时
    });
    return result === 'OK';
  }
  
  // 释放锁
  async releaseLock(executionId: string): Promise<void> {
    await this.redis.del(`lock:execution:${executionId}`);
  }
}
```

#### 3. MessageStorage (消息存储)

```typescript
class MessageStorage {
  constructor(
    private redis: Redis,
    private kafka: Kafka
  ) {}
  
  // 保存消息
  async save(conversationId: string, message: Message): Promise<void> {
    const key = `conversation:${conversationId}:messages`;
    
    // 1. 实时写入 Redis
    await this.redis.rpush(key, JSON.stringify(message));
    await this.redis.expire(key, 1800); // 30分钟过期
    
    // 2. 发送到 Kafka (异步)
    await this.kafka.send({
      topic: 'messages',
      messages: [{
        key: conversationId,
        value: { event: 'message_created', conversationId, message }
      }]
    });
  }
}
```

#### 4. CheckpointService (检查点服务)

```typescript
class CheckpointService {
  constructor(private redis: Redis) {}
  
  // 保存检查点
  async saveCheckpoint(checkpoint: ExecutionCheckpoint): Promise<void> {
    const key = `execution:${checkpoint.executionId}:checkpoint`;
    
    await this.redis.hset(key, {
      stepIndex: checkpoint.stepIndex.toString(),
      lastMessageId: checkpoint.lastMessageId,
      lastMessageTime: checkpoint.lastMessageTime.toString(),
      canResume: checkpoint.canResume ? '1' : '0'
    }, { EX: 86400 });
  }
  
  // 获取检查点
  async getLatestCheckpoint(executionId: string): Promise<ExecutionCheckpoint | null> {
    const key = `execution:${executionId}:checkpoint`;
    const data = await this.redis.hgetall(key);
    
    if (!data || Object.keys(data).length === 0) {
      return null;
    }
    
    return {
      executionId,
      stepIndex: parseInt(data.stepIndex),
      lastMessageId: data.lastMessageId,
      lastMessageTime: parseInt(data.lastMessageTime),
      canResume: data.canResume === '1'
    };
  }
}
```

#### 5. ContextService (上下文服务)

```typescript
class ContextService {
  constructor(
    private redis: Redis,
    private clickhouse: ClickHouse
  ) {}
  
  // 加载上下文
  async load(conversationId: string): Promise<ConversationContext> {
    const cacheKey = `conversation:${conversationId}:context`;
    
    // 1. 先从 Redis 缓存获取
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // 2. 缓存不存在，从 ClickHouse 加载
    const messages = await this.clickhouse.query(`
      SELECT * FROM messages 
      WHERE conversation_id = '${conversationId}'
      ORDER BY timestamp ASC
      LIMIT 1000
    `);
    
    // 3. 加载系统提示和工具配置
    const conversation = await this.clickhouse.query(`
      SELECT * FROM conversations 
      WHERE id = '${conversationId}'
    `);
    
    const context: ConversationContext = {
      messages,
      systemPrompt: conversation[0]?.system_prompt,
      tools: conversation[0]?.tools
    };
    
    // 4. 写入缓存
    await this.redis.set(cacheKey, JSON.stringify(context), { EX: 300 });
    
    return context;
  }
}
```

---

## 八、故障恢复机制

### 场景 1: Agent 进程崩溃

```
发生时间: Step 3 ~ Step 4 之间

已存储:
✅ Step 1 消息 (Redis + Kafka)
✅ Step 2 消息 (Redis + Kafka)
✅ Step 3 消息 (Redis + Kafka)
✅ Step 4 消息 (部分)
✅ 检查点: stepIndex=3, lastMessageId=msg_3

丢失: Step 4 未完成的工具调用结果

恢复:
1. 从检查点获取 lastMessageId=msg_3
2. 查询 msg_3 之后的消息
3. 从 Step 4 继续执行
```

### 场景 2: Redis 崩溃

```
已存储:
✅ Kafka 保留所有消息 (7 天)

恢复:
1. 从 Kafka 重放消息
2. 重建 Redis 缓存
```

### 场景 3: 整个节点崩溃

```
恢复:
1. Task Manager 检测到超时
2. 从检查点恢复
3. 调度到新节点继续执行
```

---

## 九、完整数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                        完整数据流                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户请求                                                        │
│      │                                                          │
│      ▼                                                          │
│  API Gateway (鉴权/限流)                                        │
│      │                                                          │
│      ▼                                                          │
│  Controller (创建 Task)                                         │
│      │                                                          │
│      │ 立即返回 executionId                                     │
│      ▼                                                          │
│  Task Queue (Redis)                                            │
│      │                                                          │
│      ▼                                                          │
│  Worker (执行 Agent) ──────────────────────────────────────    │
│      │                                                          │
│      ├─ onMessage ──▶ Redis + Kafka + SSE                     │
│      │                                                          │
│      ├─ onCheckpoint ──▶ Redis                                │
│      │                                                          │
│      ▼                                                          │
│  执行完成                                                        │
│      │                                                          │
│      ▼                                                          │
│  用户查询结果 (REST API / SSE)                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 十、技术选型

| 层级 | 组件 | 用途 |
|------|------|------|
| API | Express/Spring Boot | REST API + SSE |
| 任务队列 | Redis List | 任务缓冲 |
| 缓存 | Redis | 消息 + 检查点 |
| 消息队列 | Kafka | 异步持久化 |
| 主存储 | ClickHouse | 消息历史 |
| 搜索 | Elasticsearch | 全文搜索 |

---

## 十一、总结

```
┌─────────────────────────────────────────────────────────────────┐
│                         方案总结                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 无状态 Agent                                                │
│     - 输入: sessionId + messages + callbacks                  │
│     - 输出: new_messages + finishReason                         │
│     - 内部通过回调实时存储                                      │
│                                                                 │
│  2. 实时存储                                                   │
│     - onMessage: 每条消息实时存储 (Redis + Kafka)             │
│     - onCheckpoint: 记录位置 (stepIndex + lastMessageId)      │
│                                                                 │
│  3. 后台执行                                                   │
│     - API 立即返回 executionId                                 │
│     - Task Queue 缓冲任务                                      │
│     - Worker 后台消费                                          │
│                                                                 │
│  4. 用户交互                                                   │
│     - SSE 实时推送 (在线用户)                                  │
│     - REST API 查询 (离线用户)                                 │
│     - 支持页面关闭后继续执行                                    │
│                                                                 │
│  5. 故障恢复                                                   │
│     - 检查点恢复: 从 lastMessageId 继续                        │
│     - Worker 挂了: Task Queue 重试                             │
│     - Redis 挂了: Kafka 重放                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```
