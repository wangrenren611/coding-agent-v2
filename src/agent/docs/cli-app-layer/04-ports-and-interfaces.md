# 04. Port 接口设计

## 1. ExecutionStorePort

职责：执行生命周期持久化。

接口：
- `create(run: RunRecord): Promise<void>`
- `patch(executionId: string, patch: Partial<RunRecord>): Promise<void>`
- `get(executionId: string): Promise<RunRecord | null>`
- `listByConversation(conversationId: string, opts?: { statuses?: RunRecord['status'][]; limit?: number; cursor?: string }): Promise<{ items: RunRecord[]; nextCursor?: string }>`

## 2. EventStorePort（事实源，必需）

职责：持久化 `runStream` 与回调产生的原始事件。

接口：
- `appendAutoSeq(event: Omit<CliEventEnvelope, 'seq'>): Promise<CliEventEnvelope>`
- `append(event: CliEventEnvelope): Promise<void>`（仅回放/导入使用）
- `listByRun(executionId: string): Promise<CliEventEnvelope[]>`
- `listByConversation(conversationId: string, opts?: { fromSeq?: number; limit?: number }): Promise<CliEventEnvelope[]>`

约束：
- append-only，不允许覆盖历史事件。
- 会话内序号必须单调递增。
- `appendAutoSeq` 必须在单事务内原子分配 `seq`（禁止先查后写）。

## 3. MessageProjectionStorePort（投影层，可选但推荐）

职责：维护消息读模型（由事件投影构建）。

接口：
- `upsertFromEvent(event: CliEventEnvelope): Promise<void>`
- `list(conversationId: string): Promise<Message[]>`

## 4. ExecutionStepStorePort（推荐）

职责：步骤级状态明细（`run-status --verbose` 与调试）。

接口：
- `upsert(step: ExecutionStepRecord): Promise<void>`
- `listByRun(executionId: string, opts?: { limit?: number }): Promise<ExecutionStepRecord[]>`
- `listLatestByRuns(executionIds: string[]): Promise<Record<string, ExecutionStepRecord | undefined>>`

## 5. CheckpointStorePort（可选）

职责：断点恢复位置存储。

接口：
- `save(checkpoint: ExecutionCheckpoint): Promise<void>`
- `getLatest(executionId: string): Promise<ExecutionCheckpoint | null>`
- `clear(executionId: string): Promise<void>`

说明：
- 若不建独立 `checkpoints` 表，可从 `events(event_type=checkpoint)` 投影实现。

## 6. ContextSnapshotStorePort（推荐）

职责：存储每步实际喂给模型的上下文快照。

接口：
- `saveSnapshot(snapshot: ContextSnapshotRecord, items: ContextSnapshotItemRecord[]): Promise<void>`
- `getByRun(executionId: string): Promise<ContextSnapshotRecord[]>`

## 7. SummaryStorePort（推荐）

职责：存储压缩摘要产物。

接口：
- `append(summary: SummaryRecord): Promise<void>`
- `listByConversation(conversationId: string): Promise<SummaryRecord[]>`

## 8. RunLogStorePort（可选）

职责：存储运维技术日志（`warn/error` 为主）。

接口：
- `append(log: RunLogRecord): Promise<void>`
- `listByRun(executionId: string, opts?: { level?: string; limit?: number }): Promise<RunLogRecord[]>`

## 9. ConversationStorePort（推荐）

职责：会话存在性与会话元信息读取。

接口：
- `exists(conversationId: string): Promise<boolean>`
- `get(conversationId: string): Promise<ConversationRecord | null>`

## 10. ContextProviderPort

职责：加载会话上下文输入。

接口：
- `load(conversationId: string): Promise<{ messages: Message[]; systemPrompt?: string; tools?: Tool[] }>`

## 11. EventSinkPort

职责：发布应用层事件到 CLI。

接口：
- `publish(executionId: string, event: CliEvent): Promise<void>`
- `publishToolStream(executionId: string, chunk: { toolCallId: string; chunkType: 'stdout' | 'stderr' | 'progress'; chunk: string }): Promise<void>`

说明：
- `tool_stream` 来自 `agent.on('tool_chunk')` 桥接，不是当前 `runStream` 直接产物。

## 12. LedgerProviderPort（预留）

职责：提供可选幂等账本实现。

接口：
- `getLedger(conversationId: string): ToolExecutionLedger`

约束：
- 默认返回 `NoopToolExecutionLedger`。
- 生产环境可注入 Redis/DB 账本。
