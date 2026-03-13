# 03. 领域模型与数据契约

## 1. 核心实体

### RunRecord
- `executionId: string`
- `runId: string`（持久化层别名，默认与 `executionId` 一致）
- `conversationId: string`
- `status: CREATED | QUEUED | RUNNING | COMPLETED | FAILED | CANCELLED`（Phase 1 可不启用 `QUEUED`）
- `createdAt: number`
- `updatedAt: number`
- `stepIndex: number`
- `lastCheckpointSeq?: number`
- `terminalReason?: stop | max_steps | error | aborted | timeout | rate_limit | max_retries`
- `errorCode?: string`
- `errorCategory?: string`
- `errorMessage?: string`

### RunRequest
- `conversationId: string`
- `userInput: string`
- `executionId?: string`
- `maxSteps?: number`

### ExecutionStepRecord
- `executionId: string`
- `stepIndex: number`
- `status: pending | executing | completed | failed | skipped`
- `stage?: llm | tool | checkpoint`
- `errorCode?: string`
- `startedAt?: number`
- `completedAt?: number`

### ConversationRecord
- `conversationId: string`
- `title?: string`
- `status: active | archived`
- `workspacePath?: string`
- `createdAt: number`
- `updatedAt: number`

### CliEvent（内核 `StreamEvent` + 应用层扩展）
- `user_message`（应用层扩展）
- `assistant_message`（应用层扩展）
- `chunk`
- `reasoning_chunk`
- `tool_call`
- `tool_result`
- `tool_stream`（应用层由 `agent.on('tool_chunk')` 归一化桥接）
- `progress`
- `checkpoint`
- `compaction`
- `done`
- `error`

### CliEventEnvelope
- `conversationId: string`
- `executionId: string`
- `seq: number`（会话内单调递增）
- `eventType: CliEvent['type']`
- `data: unknown`
- `createdAt: number`

## 2. 终止语义与状态映射

- `done.finishReason=stop|max_steps` -> `RunRecord.status=COMPLETED`
- `error.errorCode=AGENT_ABORTED` -> `RunRecord.status=CANCELLED`，`terminalReason=aborted`
- `error.errorCode=AGENT_TIMEOUT_BUDGET_EXCEEDED` -> `RunRecord.status=FAILED`，`terminalReason=timeout`
- `error.errorCode=AGENT_UPSTREAM_TIMEOUT` -> `RunRecord.status=FAILED`，`terminalReason=timeout`
- `error.errorCode=AGENT_UPSTREAM_RATE_LIMIT` -> `RunRecord.status=FAILED`，`terminalReason=rate_limit`
- `error.errorCode=AGENT_MAX_RETRIES_REACHED` -> `RunRecord.status=FAILED`，`terminalReason=max_retries`
- 其他 `error` -> `RunRecord.status=FAILED`，`terminalReason=error`

## 3. 状态变更约束

- `createdAt` 不可变。
- `updatedAt` 每次状态更新必须刷新。
- `stepIndex` 只能增长。
- `COMPLETED/FAILED/CANCELLED` 为终态，不允许再切回 `RUNNING`。

## 4. ID 约束

- `executionId` 全局唯一（可采用 `trace_` 风格时间戳+随机串）。
- `conversationId` 由上层会话管理系统提供。
- `runId` 是存储层主键名；对外 CLI/API 统一使用 `executionId`。

## 5. 兼容性约束

- 应用层事件必须保留内核错误包：`errorCode/category/httpStatus/retryable`。
- 对外事件字段采用增量扩展，不删除既有字段。
- 应用层的持久化事实源以 `events` 为准，`messages` 为投影视图。
