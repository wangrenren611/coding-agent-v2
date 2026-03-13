# 11. 分阶段实施计划

## Phase 1（当前目标）

- 建立 Port 接口与 SQLite 本地 Adapter。
- 实现 `AgentAppService.runForeground`。
- 实现 `run-status`、`run-list`。
- 完成单元+集成测试。

## Phase 2

- 加入 `abortRun` 与 `resumeRun`。
- 增加事件日志回放能力。
- 支持 checkpoint 恢复执行。

## Phase 3

- 后台运行模式（detach/attach）。
- 多执行并发治理与冲突检测。
- 提供稳定的 CLI 交互体验。

## Phase 4

- 引入 Redis/DB Adapter。
- 提供可选持久化 ledger 实现。
- 评估跨进程恢复与扩缩容行为。
