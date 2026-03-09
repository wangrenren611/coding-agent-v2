# 07. Phase 1 本地存储设计（SQLite 基线）

## 1. 目标

在不引入外部基础设施的前提下，让 CLI 应用层可落地并支持：

- 事件级回放
- 运行状态查询
- 断点与上下文可追溯

## 2. 存储位置

`<workspace>/.agent-v4/agent.db`

说明：
- Phase 1 采用单库 SQLite。
- JSON/JSONL 文件存储仅保留为迁移兼容，不作为默认主路径。

## 3. 最小必需表（Phase 1）

- `runs`：执行状态
- `events`：事实事件流（真相源）
- `messages`：消息读模型（投影）
- `tool_ledger`：工具幂等账本（可选注入）
- `checkpoints`：断点恢复索引（推荐独立表；可由 `events` 投影重建）

建议同时落：
- `meta`（schema/version/feature flags）

## 4. 写入策略

- 统一事务：`events` 先写，再更新投影表（`messages/runs/...`）。
- append-only：`events` 不更新不删除（仅归档/TTL 清理）。
- 状态更新幂等：重复写同一终态不报错。
- 开启 SQLite 保护：
  - `PRAGMA journal_mode=WAL;`
  - `PRAGMA busy_timeout=5000;`
  - `PRAGMA foreign_keys=ON;`

## 5. 读取策略

- `run-status`：查询 `runs`。
- `run-list`：按 `conversationId + updatedAt` 查询 `runs`。
- 会话重建：
  - 优先读 `messages`（快）
  - 需要严格审计时读 `events` 并重放（准）

## 6. 兼容与升级

- 使用 `meta` / `schema_migrations` 管理版本。
- 投影可重建：当 `messages` 损坏时从 `events` 重算。
- 后续切换 Redis/DB 时，Port 接口保持不变。
