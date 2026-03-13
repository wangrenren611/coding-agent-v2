# 10. 测试计划与验收

## 1. 测试层级

- 单元测试：Port/Service/Mapper/状态机。
- 集成测试：`AgentAppService + LocalAdapter + StatelessAgent(mock)`。
- 端到端测试：CLI 命令运行与输出断言。

## 2. 关键测试点

- 执行状态流转正确。
- `runStream` 事件（含 `progress/compaction/reasoning_chunk`）可落库与转发。
- `tool_chunk -> tool_stream` 桥接事件可落库与转发。
- `onMessage` 每条都落库（或投影一致）。
- `checkpoint` 保存与查询正常。
- `done/error` 终态满足“先写 `events`，再写 `runs`”。
- `compaction` 不出现重复事件写入。
- `max_steps` 输出终止语义。
- `aborted/timeout/max_retries` 能正确映射终态。
- 默认无 ledger 缓存行为符合预期。
- 注入内存 ledger 时可幂等去重。

## 3. 验收标准（DoD）

- CLI `run` 能完整输出并落盘。
- `run-status` 与 `run-list` 数据一致。
- 异常场景下状态可追溯且错误契约完整。
- 关键路径测试覆盖率达到团队最低线（建议 80%+）。
