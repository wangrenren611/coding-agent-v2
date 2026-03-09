# 架构模式与代码洞察

## 1. 核心执行流程时序图

### 1.1 Agent 执行主流程

```
User Input
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                  MinimalStatelessAgentApplication            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. 验证输入                                           │   │
│  │ 2. 创建 Message 对象                                  │   │
│  │ 3. 调用 agent.runStream()                            │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                     StatelessAgent                           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  主执行循环                            │  │
│  │  while (stepIndex < maxSteps) {                      │  │
│  │    ├─ 检查 AbortSignal                                │  │
│  │    ├─ 消息压缩 (Compaction)                           │  │
│  │    ├─ LLM 调用 (generateStream)                       │  │
│  │    ├─ 处理流式事件 (yield events)                     │  │
│  │    ├─ 工具调用 (processToolCalls)                     │  │
│  │    └─ 检查点 (Checkpoint)                             │  │
│  │  }                                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  返回: AsyncGenerator<StreamEvent>                          │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   LLM Provider Layer                         │
│                                                              │
│  OpenAICompatibleProvider.generateStream()                  │
│    ├─ 构建请求参数 (Adapter.transformRequest)               │
│    ├─ HTTP 请求 (HTTPClient.fetch)                          │
│    ├─ 流式解析 (StreamParser)                               │
│    └─ 转换响应 (Adapter.transformResponse)                  │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
                   StreamEvent
    ┌─────────────────┼─────────────────┐
    │                 │                 │
    ▼                 ▼                 ▼
  chunk         tool_call         tool_result
```

### 1.2 工具执行流程

```
ToolCall
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                   DefaultToolManager                         │
│                                                              │
│  1. 解析参数 (JSON.parse)                                   │
│  2. 查找工具 (tools.get(name))                              │
│  3. 验证参数 (BaseTool.safeValidateArgs)                    │
│  4. 策略检查 (onPolicyCheck callback)                       │
│  5. 内置策略 (evaluateBuiltInPolicy)                        │
│  6. 确认检查 (onConfirm callback)                           │
│  7. 执行工具 (BaseTool.execute)                             │
│                                                              │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                     BaseTool                                 │
│                                                              │
│  abstract execute(args, context): Promise<ToolResult>       │
│                                                              │
│  可选 hooks:                                                │
│  - shouldConfirm(args): boolean                             │
│  - getConcurrencyMode(args): 'parallel-safe' | 'exclusive'  │
│  - getConcurrencyLockKey(args): string | undefined          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 2. 关键代码洞察

### 2.1 Abort Scope 管理

项目实现了一个类似"作用域"的 Abort 信号管理机制：

```typescript
interface AbortScope {
  signal: AbortSignal;
  release(): void;
}

// 创建执行级作用域
const executionScope = this.createExecutionAbortScope(inputAbortSignal, timeoutBudget);
const abortSignal = executionScope.signal;

// 创建阶段级作用域（LLM）
const llmScope = this.createStageAbortScope(abortSignal, timeoutBudget, 'llm');
try {
  // 使用 llmScope.signal 进行 LLM 调用
} finally {
  llmScope.release();  // 释放作用域资源
}

// 创建阶段级作用域（Tool）
const toolScope = this.createStageAbortScope(abortSignal, timeoutBudget, 'tool');
try {
  // 使用 toolScope.signal 进行工具调用
} finally {
  toolScope.release();
}
```

**设计优势**：
- 资源自动清理（使用 finally）
- 嵌套作用域支持
- 超时预算精确分配

### 2.2 工具调用合并（Tool Call Merging）

LLM 在流式响应中可能分多次发送同一个工具调用的参数，需要合并：

```typescript
export function mergeToolCalls(
  existing: Array<{ id: string; function: { arguments: string } }>,
  incoming: Array<{ id: string; function: { arguments: string } }>,
  messageId: string
): Promise<Array<{ id: string; function: { arguments: string } }>> {
  const merged = new Map<string, { id: string; function: { arguments: string } }>();
  
  // 1. 添加现有调用
  for (const call of existing) {
    merged.set(call.id, call);
  }
  
  // 2. 合并新调用
  for (const call of incoming) {
    const existing = merged.get(call.id);
    if (existing) {
      // 追加参数（JSON 片段）
      existing.function.arguments += call.function.arguments;
    } else {
      merged.set(call.id, call);
    }
  }
  
  return Array.from(merged.values());
}
```

### 2.3 回调安全（Callback Safety）

所有回调都经过安全包装，防止回调异常中断主流程：

```typescript
export async function safeCallback<T>(
  callback: ((arg: T) => void | Promise<void>) | undefined,
  arg: T,
  onError: (error: Error) => void
): Promise<void> {
  if (!callback) return;
  
  try {
    await callback(arg);
  } catch (error) {
    onError(error as Error);
    // 不重新抛出异常
  }
}
```

### 2.4 WriteFile 缓冲会话

大文件写入使用会话机制：

```typescript
interface WriteBufferRuntime {
  bufferId: string;          // 会话 ID
  targetPath: string;        // 目标文件路径
  contentBytes: number;      // 已缓冲字节数
  metaPath: string;          // 元数据文件路径
  contentPath: string;       // 内容文件路径
}

// 流程：
// 1. Direct 模式：内容 < 32KB，直接写入
// 2. 内容 ≥ 32KB：创建缓冲会话，返回 bufferId
// 3. Resume 模式：使用 bufferId 追加内容
// 4. Finalize 模式：将缓冲内容原子写入目标文件
```

**文件结构**：
```
.agent-cache/write-file/
├── meta_<bufferId>.json      # 元数据
└── content_<bufferId>.txt    # 内容缓冲
```

### 2.5 工具执行账本（Idempotency Ledger）

防止工具重复执行：

```typescript
export interface ToolExecutionLedgerRecord {
  toolCallId: string;
  toolName: string;
  arguments: string;
  result: ToolResult;
  timestamp: number;
}

export interface ToolExecutionLedger {
  hasExecuted(toolCallId: string): Promise<boolean>;
  getResult(toolCallId: string): Promise<ToolResult | undefined>;
  record(toolCallId: string, toolName: string, args: string, result: ToolResult): Promise<void>;
}

// 默认实现：Noop（不记录，保持无状态）
// 可选实现：InMemory（内存记录）
// 生产实现：Redis/Database（持久化记录）
```

## 3. 性能优化技巧

### 3.1 惰性解析

流式响应使用惰性解析：

```typescript
async *_generateStream(params): AsyncGenerator<Chunk> {
  const response = await this.httpClient.fetch(...);
  const parser = new StreamParser(response.body);
  
  // 惰式解析，每次只解析一个 chunk
  for await (const line of parser.lines()) {
    const chunk = this.parseChunk(line);
    yield chunk;  // 立即返回，不缓冲
  }
}
```

### 3.2 消息 Token 估算

快速估算 Token 数量，避免精确计数开销：

```typescript
export function estimateMessagesTokens(
  messages: Message[],
  tools?: LLMTool[]
): number {
  let total = 0;
  
  // 1. 消息 Token
  for (const msg of messages) {
    const content = typeof msg.content === 'string' 
      ? msg.content 
      : JSON.stringify(msg.content);
    // 粗略估算：4 字符 ≈ 1 token
    total += Math.ceil(content.length / 4);
  }
  
  // 2. 工具定义 Token
  if (tools) {
    for (const tool of tools) {
      total += Math.ceil(JSON.stringify(tool).length / 4);
    }
  }
  
  return total;
}
```

### 3.3 并发控制

使用锁机制避免资源冲突：

```typescript
export async function runWithConcurrencyAndLock<T>(
  tasks: Array<{ lockKey?: string; run: () => Promise<T> }>,
  limit: number
): Promise<T[]> {
  const runningLocks = new Set<string>();  // 正在使用的锁
  let activeCount = 0;
  
  const tryStart = () => {
    while (activeCount < limit && pending.length > 0) {
      // 查找下一个可执行的任务（无锁冲突）
      const nextPos = pending.findIndex(index => {
        const lockKey = tasks[index].lockKey;
        return !lockKey || !runningLocks.has(lockKey);
      });
      
      if (nextPos === -1) break;  // 所有任务都有锁冲突
      
      // 执行任务
      const taskIndex = pending.splice(nextPos, 1)[0];
      const lockKey = tasks[taskIndex].lockKey;
      
      if (lockKey) runningLocks.add(lockKey);
      activeCount += 1;
      
      tasks[taskIndex].run()
        .then(value => { results[taskIndex] = value; })
        .finally(() => {
          activeCount -= 1;
          if (lockKey) runningLocks.delete(lockKey);
          tryStart();  // 尝试启动下一个任务
        });
    }
  };
  
  tryStart();
}
```

## 4. 安全防护机制

### 4.1 Bash 命令过滤

```typescript
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

// 检查逻辑
for (const rule of dangerousBashRules) {
  if (rule.pattern.test(command)) {
    return {
      allowed: false,
      code: 'DANGEROUS_COMMAND',
      message: rule.message,
      audit: { ruleId: rule.id, matchedValue: command.slice(0, 200) },
    };
  }
}
```

### 4.2 文件路径保护

```typescript
const DEFAULT_RESTRICTED_WRITE_PREFIXES = [
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/System',
  '/private/etc',
];

// 路径解析与检查
const resolvedPath = path.resolve(targetPath);
for (const restrictedPrefix of restrictedWritePathPrefixes) {
  if (resolvedPath === restrictedPrefix || 
      resolvedPath.startsWith(`${restrictedPrefix}${path.sep}`)) {
    return {
      allowed: false,
      code: 'PATH_NOT_ALLOWED',
      message: `Path targets restricted location: ${targetPath}`,
    };
  }
}
```

### 4.3 超时保护

```typescript
// 1. 总预算
const timeoutBudget = createBudgetState({
  totalMs: input.timeoutBudgetMs,
  llmRatio: input.llmTimeoutRatio ?? 0.7,
});

// 2. 阶段预算
const llmScope = createStageAbortScope(abortSignal, timeoutBudget, 'llm');
// LLM 阶段最多使用 70% 的总预算

// 3. HTTP 请求超时
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeout);
try {
  await fetch(url, { signal: controller.signal });
} finally {
  clearTimeout(timeoutId);
}
```

## 5. 错误恢复策略

### 5.1 错误分类与重试

```typescript
// 错误分类
if (error instanceof LLMPermanentError) {
  // 永久性错误：不重试
  return { retry: false };
}

if (error instanceof LLMRetryableError) {
  // 可重试错误：计算退避时间
  const delay = calculateBackoff(retryCount, error.retryAfter);
  await sleep(delay);
  return { retry: true };
}

// 默认：不重试
return { retry: false };
```

### 5.2 退避算法

```typescript
export function calculateBackoff(
  retryCount: number,
  retryAfterMs?: number,
  config: BackoffConfig = {}
): number {
  const cfg = { ...DEFAULT_BACKOFF_CONFIG, ...config };
  
  // 优先级 1：服务器指定的重试时间
  if (retryAfterMs && retryAfterMs > 0) {
    return Math.min(retryAfterMs, cfg.maxDelayMs);
  }
  
  // 优先级 2：指数退避 + Jitter
  const exponentialDelay = cfg.initialDelayMs * Math.pow(cfg.base, retryCount);
  const cappedDelay = Math.min(exponentialDelay, cfg.maxDelayMs);
  
  // 添加随机抖动（±50%）
  const jitterFactor = 0.5 + Math.random();
  return Math.floor(cappedDelay * jitterFactor);
}
```

**退避示例**：
```
重试次数  基础延迟    抖动范围
0         1000ms     500-1500ms
1         2000ms     1000-3000ms
2         4000ms     2000-6000ms
3         8000ms     4000-12000ms
4         16000ms    8000-24000ms
5         32000ms    16000-48000ms
6         60000ms    30000-90000ms (达到上限)
```

## 6. 遥测与追踪

### 6.1 Span 追踪

```typescript
interface SpanRuntime {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: number;
  attributes?: Record<string, unknown>;
}

// 使用示例
const runSpan = await startSpan(callbacks, traceId, 'agent.run', undefined, {
  executionId: input.executionId,
  maxSteps,
});

try {
  // ... 执行逻辑
} finally {
  await endSpan(callbacks, runSpan, {
    outcome: 'success',
    latencyMs: Date.now() - runSpan.startedAt,
  });
}
```

### 6.2 指标收集

```typescript
interface AgentMetric {
  name: string;
  value: number;
  unit?: 'ms' | 'count';
  timestamp: number;
  tags?: Record<string, string | number | boolean>;
}

// 示例指标
await emitMetric(callbacks, {
  name: 'agent.llm.duration_ms',
  value: llmLatencyMs,
  unit: 'ms',
  tags: { stepIndex, success: 'true' },
});

await emitMetric(callbacks, {
  name: 'agent.retry.count',
  value: retryCount,
  unit: 'count',
});
```

## 7. 设计权衡

### 7.1 无状态 vs 有状态

**选择**：无状态

**优点**：
- 支持水平扩展
- 无状态冲突
- 易于测试

**缺点**：
- 需要外部存储会话状态
- 每次调用需要传递完整上下文

### 7.2 流式 vs 缓冲

**选择**：流式优先

**优点**：
- 低延迟
- 内存友好
- 用户体验好

**缺点**：
- 错误处理复杂
- 难以实现事务

### 7.3 类型安全 vs 灵活性

**选择**：类型安全

**优点**：
- 编译时错误检查
- IDE 自动补全
- 重构安全

**缺点**：
- 类型定义繁琐
- 动态场景受限

---

**生成时间**: 2024-03-09
