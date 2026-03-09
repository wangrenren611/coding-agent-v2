# 05. 执行编排与状态机

## 1. RunOrchestrator 职责

- 构建单次执行 `AgentInput`。
- 消费 `runStream` 事件并桥接到存储与 CLI。
- 消费 `agent.on('tool_chunk')` 并桥接为 `tool_stream`。
- 处理 `onMessage/onCheckpoint/onCompaction/onError` 回调。
- 维护运行状态机并保证终态收敛。

## 2. 执行主流程（事件源优先）

1. 创建 `RunRecord(CREATED)`。
2. 读取上下文与历史消息。
3. 追加用户输入（写 `events`，并更新消息投影）。
4. 更新状态为 `RUNNING`。
5. 调用 `runStream`，逐条消费事件并写 `EventStore`。
6. 并行消费 `tool_chunk`，归一化为 `tool_stream` 后写 `EventStore`。
7. 对关键事件更新投影与状态：
   - `progress`：更新 `stepIndex`
   - `checkpoint`：保存 checkpoint
   - `done/error`：先写 `events`，再收敛终态
8. 终态后停止接收后续事件并发布最终结果。

## 3. 桥接规则（按真实内核行为）

- `runStream event=*`：`EventStore.append` + `EventSink.publish`（当前不含 `tool_stream`）
- `agent.on('tool_chunk')`：归一化为 `tool_stream`，再 `EventStore.append` + `EventSink.publish`
- `onMessage`：补充消息持久化（或校验事件投影一致性）
- `onCheckpoint`：`CheckpointStore.save` + `ExecutionStore.patch(stepIndex)`
- `onCompaction`：仅更新摘要/上下文快照派生层（不重复 append 事件）
- `onError`：记录错误决策，不直接替代终态收敛逻辑

说明：
- `progress` 以 `runStream` 事件为准，不依赖 `callbacks.onProgress`。
- 终态收敛遵循“`events` 先写，`runs` 后更新”。

## 4. 状态机与终态映射

- CREATED -> RUNNING
- RUNNING -> COMPLETED（`done.finishReason=stop|max_steps`）
- RUNNING -> FAILED（`error` 且非 `AGENT_ABORTED`）
- RUNNING -> CANCELLED（`error.errorCode=AGENT_ABORTED`）

非法转换应拒绝并记录告警日志。

## 5. 并发与幂等

- 同 `executionId` 并发启动应被拒绝或去重。
- `toolExecutionLedger` 是否缓存由注入实现决定。
- 应用层不得假定默认有跨进程幂等能力。
- 事实层（`events`）必须可重放，投影层可重建。
