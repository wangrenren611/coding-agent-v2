# 06. CLI 命令与交互规范

## 1. 命令集合（Phase 1）

- `agent run --conversation <id> --message "..."`
- `agent run-status --execution <id>`
- `agent run-list --conversation <id>`

## 2. 输出策略

- `chunk`：实时增量输出文本。
- `reasoning_chunk`：默认隐藏，可通过 flag 打开。
- `tool_stream`：工具 stdout/stderr/progress 流（由 `tool_chunk` 桥接，默认紧凑显示）。
- `tool_call/tool_result`：结构化一行输出。
- `progress`：紧凑模式刷新（可覆盖上行）。
- `compaction`：输出压缩动作摘要（移除条数、stepIndex）。
- `done/error`：尾部输出总结。

## 3. 退出码规范

- `0`：完成（含 `finishReason=max_steps`）。
- `1`：运行失败。
- `130`：用户中断（SIGINT）。

终态映射建议：
- `done.stop` -> `COMPLETED` + `0`
- `done.max_steps` -> `COMPLETED` + `0`（提示可 `resume`）
- `error.AGENT_ABORTED` -> `CANCELLED` + `130`
- `error.AGENT_TIMEOUT_BUDGET_EXCEEDED` -> `FAILED(timeout)` + `1`
- `error.AGENT_MAX_RETRIES_REACHED` -> `FAILED(max_retries)` + `1`
- 其他 `error` -> `FAILED(error)` + `1`

## 4. 可观测输出字段

推荐统一打印：
- `executionId`
- `stepIndex`
- `eventType`
- `toolCallId`（可选）
- `errorCode`（错误时）

## 5. 查询命令输出约定（`run-status` / `run-list`）

- `run-status` 默认输出：`status/terminalReason/stepIndex/createdAt/updatedAt/completedAt`。
- `run-status --verbose` 追加：最近 `execution_steps` 与尾部 `events`。
- `run-status --watch`：按固定间隔刷新，终态后自动退出。
- `run-list` 默认输出：`executionId/status/terminalReason/stepIndex/updatedAt`（按 `updatedAt` 倒序）。
- `run-list --cursor <token>`：分页读取下一页；无下一页时返回空 `next_cursor`。

建议错误码：
- 参数错误：`2`
- 资源不存在（例如 execution 不存在）：`2`
- 查询成功（含空列表）：`0`
