# 12. 开放问题与风险登记

## 1. 开放问题

- `executionId` 由 CLI 生成还是应用层统一生成？（待 ADR 决策）
- `run` 命令默认是否打印 `reasoning_chunk`？
- 失败重试策略由 CLI 触发还是应用层自动触发？

## 2. 风险

- R1：SQLite 并发写锁竞争（`database is locked`）。
  - 缓解：WAL + `busy_timeout` + 短事务 + 失败重试。
- R2：异常中断导致状态不一致。
  - 缓解：`events` 先写 + 投影可重建 + 启动时一致性修复。
- R3：接口先行导致实现偏差。
  - 缓解：每阶段落地前跑契约测试。
- R4：`tool_ledger` pending 记录因进程崩溃长期悬挂。
  - 缓解：增加租约字段（`pending_expires_at_ms`）+ 过期抢占规则 + 巡检清理。
- R5：`events.seq` 并发分配冲突导致写入失败抖动。
  - 缓解：单事务原子分配 + 唯一约束冲突短重试 + 监控冲突率。

## 3. 决策记录建议

已决策：
- Phase 1 本地存储统一 SQLite，JSONL 仅历史兼容。

后续每个关键决策都新增 ADR 文档：
- `adr/ADR-001-storage-choice.md`
- `adr/ADR-002-execution-id-policy.md`
- `adr/ADR-003-event-schema-versioning.md`
