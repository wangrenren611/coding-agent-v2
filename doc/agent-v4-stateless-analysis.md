# Agent-V4 无状态架构深度分析

## 1. 核心架构概述

**无状态设计原则**

agent-v4 的"无状态"体现在三个层面：

| 层面 | 实现机制 | 文件位置 |
|------|---------|---------|
| **Agent 无状态** | `StatelessAgent` 不保存会话上下文，所有状态通过输入参数 `AgentInput` 传入 | `src/agent-v4/agent/index.ts` |
| **幂等性保障** | `ToolExecutionLedger` 记录工具执行结果，支持重放 | `src/agent-v4/agent/tool-execution-ledger.ts` |
| **外部存储** | 通过 port 接口接入 SQLite/事件存储，实现状态外置 | `src/agent-v4/app/ports.ts` |

---

## 2. 核心组件

### 2.1 StatelessAgent (核心引擎)

```typescript
// src/agent-v4/agent/index.ts:119
export class StatelessAgent extends EventEmitter {
  private llmProvider: LLMProvider;
  private toolExecutor: ToolManager;
  private config: InternalAgentConfig;
  private logger: AgentLogger;
  private toolExecutionLedger: ToolExecutionLedger;
}
```

**关键特性**：

- **流式执行**: 使用 `AsyncGenerator` 返回 `StreamEvent`，支持实时反馈
- **超时预算**: 实现了 `timeout-budget.ts` 中的阶段级超时控制
- **消息压缩**: 当 context 超过阈值时自动压缩历史消息
- **并发控制**: 支持工具级别的并发策略（`exclusive` / `parallel`）

### 2.2 ToolExecutionLedger (幂等性保障)

```typescript
// src/agent-v4/agent/tool-execution-ledger.ts:12
export interface ToolExecutionLedger {
  get(executionId: string, toolCallId: string): Promise<ToolExecutionLedgerRecord | undefined>;
  set(executionId: string, toolCallId: string, record: ToolExecutionLedgerRecord): Promise<void>;
  executeOnce(...): Promise<ToolExecutionOnceResult>;
}
```

**两种实现**：

- `NoopToolExecutionLedger`: 默认实现，完全无状态
- `InMemoryToolExecutionLedger`: 内存缓存，支持进程内幂等

### 2.3 应用层服务

```
MinimalStatelessAgentApplication  → 轻量级封装，直接使用
AgentAppService                    → 企业级，包含完整可观测性
```

`AgentAppService` 的核心职责：

- 执行状态管理（CREATED → RUNNING → COMPLETED/FAILED）
- 事件持久化（`EventStorePort`）
- 消息投影（`MessageProjectionStorePort`）
- 运行日志（`RunLogStorePort`）

---

## 3. 无状态机制详解

### 3.1 输入驱动模式

所有状态通过 `AgentInput` 传入：

```typescript
// src/agent-v4/types.ts:42
export interface AgentInput {
  executionId: string;          // 幂等键
  conversationId: string;       // 会话标识
  messages: Message[];          // 上下文消息（客户端维护）
  systemPrompt?: string;
  tools?: Tool[];
  maxSteps?: number;
  abortSignal?: AbortSignal;
  timeoutBudgetMs?: number;    // 超时预算
  contextLimitTokens?: number;
}
```

### 3.2 幂等执行流程

```
1. 工具调用发起 → ToolCall ID + executionId
2. Ledger 查询 → 检查是否已执行过
3. 缓存命中 → 直接返回历史结果
4. 执行并记录 → set(executionId, toolCallId, record)
```

代码见 `src/agent-v4/agent/index.ts:663`：

```typescript
const ledgerResult = await executeWithToolLedger({
  ledger: this.toolExecutionLedger,
  executionId,
  toolCallId: toolCall.id,
  execute: async () => this.executeToolAndBuildRecord(...),
});
```

### 3.3 Checkpoint 与恢复

```typescript
// src/agent-v4/types.ts:83
export interface ExecutionCheckpoint {
  executionId: string;
  stepIndex: number;
  lastMessageId: string;
  lastMessageTime: number;
  canResume: boolean;
}
```

---

## 4. 可观测性设计

### 4.1 指标 (Metrics)

```typescript
// 核心指标
agent.llm.duration_ms    // LLM 调用耗时
agent.tool.duration_ms   // 工具执行耗时
```

### 4.2 链路追踪 (Tracing)

```typescript
// src/agent-v4/agent/telemetry.ts:24
export interface SpanRuntime {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: number;
}
```

**Span 层级**：

```
agent.run
  ├── agent.llm.step
  └── agent.tool.execute
```

### 4.3 日志结构化

通过 `AgentLogger` 接口注入，支持结构化日志：

```typescript
logger.info('[Agent] run.start', {
  executionId,
  traceId,
  spanId: runSpan.spanId,
  messageCount: messages.length,
});
```

---

## 5. 超时预算机制

```typescript
// src/agent-v4/agent/timeout-budget.ts:88
export function createStageAbortScope(
  baseSignal: AbortSignal | undefined,
  timeoutBudget: TimeoutBudgetState | undefined,
  stage: 'llm' | 'tool'
): AbortScope
```

**预算分配**：

- `llmTimeoutRatio` (默认 0.7): LLM 阶段占比
- 剩余部分分配给工具执行

---

## 6. 存储层架构

```
┌─────────────────────────────────────────────────────┐
│                  AgentAppService                     │
├─────────────────────────────────────────────────────┤
│  ExecutionStorePort   │ 执行状态 CRUD               │
│  EventStorePort      │ 事件流持久化                │
│  MessageProjectionStorePort │ 消息投影              │
│  RunLogStorePort     │ 运行日志                   │
│  ContextProjectionStorePort │ 上下文管理          │
└─────────────────────────────────────────────────────┘
```

SQLite 实现见 `src/agent-v4/app/sqlite-agent-app-store.ts`

---

## 7. 文件结构

```
src/agent-v4/
├── agent/                     # 核心引擎
│   ├── index.ts              # StatelessAgent 主类 (1331行)
│   ├── tool-execution-ledger.ts 性保障
│ # 幂等   ├── timeout-budget.ts    # 超时控制
│   ├── telemetry.ts         # 可观测性
│   ├── compaction.ts         # 消息压缩
│   ├── concurrency.ts        # 并发控制
│   └── error-normalizer.ts  # 错误标准化
├── app/                      # 应用层
│   ├── minimal-agent-application.ts  # 轻量封装
│   ├── agent-app-service.ts          # 企业级服务
│   ├── ports.ts              # 存储接口定义
│   └── sqlite-*-store.ts    # SQLite 实现
├── tool/                     # 工具系统
│   ├── tool-manager.ts       # 工具管理器
│   ├── base-tool.ts          # 工具基类
│   └── *.ts                  # 各类工具实现
└── types.ts                   # 核心类型定义
```

---

## 8. 关键设计亮点

- **外部状态**: Agent 本身无状态，状态完全外部化
- **幂等 Ledger**: 支持分布式环境下的工具执行幂等
- **阶段超时**: 精细的超时预算控制
- **流式事件**: 完整的异步事件流支持
- **可组合**: 通过 port 接口灵活适配不同存储后端
- **可观测**: 指标、追踪、日志完整覆盖

---

## 9. 相关文档

- [深度代码分析报告](../analysis/DEEP_CODE_ANALYSIS_REPORT.md)
- [Code Quality Improvement](../analysis/CODE_QUALITY_IMPROVEMENT.md)
- [AGENT_V4_TASK_TOOLS_TECHNICAL_DESIGN](../doc/AGENT_V4_TASK_TOOLS_TECHNICAL_DESIGN.md)
- [AGENT_V4_REAL_SUBAGENT_RUNNER_TECHNICAL_DESIGN](../doc/AGENT_V4_REAL_SUBAGENT_RUNNER_TECHNICAL_DESIGN.md)
