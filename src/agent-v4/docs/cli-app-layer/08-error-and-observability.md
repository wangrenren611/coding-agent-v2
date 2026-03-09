# 08. 错误与可观测性设计

## 1. 错误模型

沿用 `agent-v4` 错误契约：
- `errorCode`
- `category`
- `retryable`
- `httpStatus`

应用层新增：
- `executionId`
- `stage`（bootstrap/run/callback/persist）

## 2. 错误处理原则

- 内核错误：保留原始错误码，不做语义降级。
- 存储错误：标记 `APP_STORAGE_*`，并尽量不中断 stdout 事件流。
- 回调错误：不传播到用户主流程，但要记录日志。

## 3. 日志规范

每条日志最小字段：
- `executionId`
- `conversationId`
- `stepIndex`
- `event`
- `latencyMs`
- `errorCode`

落库建议：
- 业务事实进入 `events`（真相源）。
- 运维技术日志进入 `run_logs`（可选，默认 `warn/error`）。

## 4. 指标建议（后续）

- `app.run.duration_ms`
- `app.run.error.count`
- `app.store.write.error.count`
- `app.cli.render.delay_ms`
