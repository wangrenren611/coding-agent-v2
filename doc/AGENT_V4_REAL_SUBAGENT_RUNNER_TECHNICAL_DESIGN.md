# AGENT v4 Real Subagent Runner 技术设计（仅设计，不改代码）

## 1. 目标与范围

### 1.1 目标
在不改变 `task/task_output/task_stop` 对外参数契约的前提下，将当前 `InProcessMockRunnerAdapter` 替换为可落地的“真实 Agent 执行适配器”，支持：

- 真实模型调用与工具调用
- 前台执行（同步返回最终结果）
- 后台执行（立即返回，后续轮询）
- 取消执行（`task_stop`）
- 可恢复执行（`resume`）

### 1.2 范围内

- 新适配器设计：`RealSubagentRunnerAdapter`
- 与 `src/agent-v4/agent` + `src/agent-v4/app` 的集成方案
- 状态机映射、错误码映射、模型映射、工具白名单策略
- 测试与验收标准

### 1.3 范围外

- 多机分布式调度
- 多租户权限体系
- UI 侧交互变更

---

## 2. 现状与问题

当前 `task` 工具默认注入 `InProcessMockRunnerAdapter`（见 `src/agent-v4/tool/task.ts`），这是一个测试/占位实现，使用 prompt token 模拟执行结果（`[TASK_FAIL]` 等）。

这导致：

- `task` 并未真正调用 `StatelessAgent`
- `task_output/task_stop` 只在 mock 生命周期内有效
- 与真实 provider、真实工具链、真实超时/中断行为不一致

---

## 3. 设计原则

1. **对外契约不变**：保留 `SubagentRunnerAdapter` 三方法签名。  
2. **分层解耦**：`task` 仅依赖 runner 抽象，不耦合 app/runtime 细节。  
3. **可渐进交付**：先前台真实，再后台真实，再跨进程健壮化。  
4. **状态可追踪**：`agentRuns` 必须保存可定位真实 run 的关键标识。  
5. **失败可恢复**：任何中断必须可轮询可诊断，不可“静默消失”。
6. **消息外部化存储**：执行消息/事件必须由外部 Service 持久化，`TaskStore` 仅保存运行投影与定位信息（locator）。

---

## 4. 核心组件设计

## 4.1 `RealSubagentRunnerAdapter`

实现现有接口：

- `start(namespace, input, context?)`
- `poll(namespace, agentId)`
- `cancel(namespace, agentId, reason?)`

职责：

- 将 `StartAgentInput` 转换为 `AgentAppService.runForeground(...)` 或后台 worker 启动请求
- 将 app 层 `RunRecord` 映射为 `AgentRunEntity`
- 在 `TaskStore.agentRuns` 与 app 层 run 之间做 ID 对齐

## 4.2 `RuntimeHost`（建议新增内部服务）

职责：

- 初始化 `ProviderRegistry`、`DefaultToolManager`、`StatelessAgent`、`SqliteAgentAppStore`、`AgentAppService`
- 统一读取 env（模型 key、db path、workspace）
- 提供单例复用，避免每次 `task` 都完整冷启动

## 4.2.1 外部 Service 注入要求（关键）

`RealSubagentRunnerAdapter` 不应在内部自行 new `AgentAppService`。  
应由组合根（runtime/app 启动层）注入外部 Service：

- `appService`（运行与查询）
- `executionStore/eventStore/messageStore`（由外部 Service 实现或代理）

建议依赖接口化，避免强耦合到具体实现：

```ts
interface SubagentExecutionService {
  runForeground(...): Promise<RunForegroundResult>;
  getRun(executionId: string): Promise<RunRecord | null>;
  listRunEvents(executionId: string): Promise<CliEventEnvelope[]>;
  listContextMessages(conversationId: string): Promise<Message[]>;
}
```

注入位置建议：

- 启动层创建 `AgentAppService`
- 启动层创建 `RealSubagentRunnerAdapter({ appService, ... })`
- `TaskTool/TaskOutputTool/TaskStopTool` 共用同一 runner 实例

## 4.3 `RunLocator`

用途：

- 在 `agentRuns[agentId].metadata` 中保存：
  - `executionId`
  - `conversationId`
  - `runtimeMode`（foreground/background）
  - `workerPid`（后台进程时）
- `poll/cancel` 通过这些字段定位真实 run

## 4.4 `BackgroundWorker`（第二阶段起）

模式：

- 主进程调用 `task(run_in_background=true)` 时：
  - 创建 `agentId`
  - 启动 worker（`node .../agent-worker.js`）
  - 立即返回 `running`
- worker 内执行 `runForeground`，事件与状态写入 sqlite/app store
- `task_output` 通过 `executionId` 轮询 run 状态

---

## 5. 执行流程（逐步）

## 5.1 `task.start`（前台）

1. `task.ts` 校验 linked task 可启动（现有逻辑保持）。
2. `RealSubagentRunnerAdapter.start` 构造 app 请求：
   - `conversationId = taskns:<namespace>:agent:<agentId>`（建议）
   - `executionId = agentId`（建议，避免二次映射）
3. 调用 `AgentAppService.runForeground(...)`。
4. 将返回 `finishReason/run` 映射成 `AgentRunEntity`：
   - `status`、`output/error`、`progress`、`endedAt`
5. 更新 `TaskStore.agentRuns[agentId]` 并返回。

补充约束（消息存储）：

- `runForeground` 产生的事件与消息由外部 Service 持久化（events/messages/context projection）。
- runner 不把完整消息正文复制写入 `TaskStore`。
- `TaskStore` 仅保存：
  - `executionId/conversationId`
  - 状态投影（status/progress/error）
  - 可选短摘要（如最后 200 字，非真相源）

## 5.2 `task.start`（后台）

1. 创建初始 `AgentRunEntity(status=queued|running)`。
2. 启动后台 worker（带 `namespace/agentId/executionId/conversationId/input`）。
3. 立即返回 `running`。
4. worker 执行完成后，`poll` 可读到 terminal 状态。

## 5.3 `task_output.poll`

1. 根据 `agentId` 找到 run locator（executionId）。
2. 调用 `appService.getRun(executionId)`。
3. 映射状态后返回；阻塞模式按现有逻辑循环轮询。

补充（读取消息）：

- 若请求结果需要文本输出，优先从外部 Service 读取：
  - `listContextMessages(conversationId)` 取最后 assistant 文本，或
  - `listRunEvents(executionId)` 汇总终态输出
- 不以 `TaskStore.agentRuns.output` 作为唯一来源

## 5.4 `task_stop.cancel`

1. 定位 `executionId` 与运行模式。
2. 前台同进程：使用 `AbortController` 中断（需 RuntimeHost 保存 controller）。
3. 后台 worker：发送取消信号（IPC/标记表/进程信号）。
4. 最终将状态映射为 `cancelled` 并按现有逻辑联动 task 取消。

## 5.5 `resume`

- 输入带 `resume` 时，不创建新 run。
- 读取旧 run：
  - terminal：直接返回终态
  - running：返回 running
  - paused/可恢复：重新发起剩余执行（策略见第 9 节）

---

## 6. 状态映射规范

| App RunRecord | terminalReason / errorCode | AgentRunStatus |
|---|---|---|
| CREATED / QUEUED | - | queued |
| RUNNING | - | running |
| COMPLETED | stop / max_steps | completed / paused(可选策略) |
| FAILED | AGENT_TIMEOUT_BUDGET_EXCEEDED | timed_out |
| FAILED | 其他 | failed |
| CANCELLED | aborted | cancelled |

建议：

- `max_steps` 默认映射 `paused`（便于 resume），不是 `completed`
- `AGENT_TIMEOUT_BUDGET_EXCEEDED` 映射 `timed_out`

---

## 7. 子 Agent 类型与工具策略

建议把 `subagent_type` 映射为工具白名单（注册到 `DefaultToolManager`）：

- `Bash`: `bash`
- `Explore`: `glob`, `grep`, `file_read`
- `Plan`: `glob`, `grep`, `file_read`（可选 web 工具取决于运行环境）
- `research-agent`: `glob`, `grep`, `file_read` + web（若有）
- `general-purpose`: `bash`, `glob`, `grep`, `file_read`, `file_edit`, `write_file`, `skill`
- `claude-code-guide`: 以只读工具为主（避免写操作）

说明：白名单必须与实际已注册工具一致，避免运行时报 `ToolNotFound`。

---

## 8. 模型映射策略

当前 `task` 参数是：`sonnet|opus|haiku`，provider 侧是具体 `modelId`。建议新增映射层：

- `sonnet -> glm-5`（默认）
- `opus -> 更强模型（按 `ProviderRegistry` 可用列表配置）`
- `haiku -> 轻量模型`

要求：

1. 启动时校验目标 modelId 存在。  
2. 校验所需 env key 已配置。  
3. 映射失败时返回结构化错误：`TASK_AGENT_INVALID_MODEL_MAPPING`。

---

## 9. `resume` 语义建议

分两类：

1. **运行中恢复（attach）**：旧 run 为 running，直接返回当前状态。  
2. **中断后恢复（restart with context）**：
- 从 `listContextMessages(conversationId)` 取上下文
- 以“继续执行”指令再次运行
- 新建 executionId，但在 metadata 记录 `resumedFrom`

短期建议：先支持 attach；restart 作为二期。

---

## 10. 错误处理规范

对外统一前缀：

- `TASK_AGENT_START_FAILED`
- `TASK_AGENT_POLL_FAILED`
- `TASK_AGENT_CANCEL_FAILED`
- `TASK_AGENT_NOT_FOUND`
- `TASK_AGENT_TIMEOUT`

并保留 `details`：

- `agent_id`
- `execution_id`
- `namespace`
- `provider_error_code`

外部 Service 存储相关补充错误：

- `TASK_AGENT_EVENT_STORE_FAILED`
- `TASK_AGENT_MESSAGE_STORE_FAILED`
- `TASK_AGENT_CONTEXT_LOAD_FAILED`

---

## 11. 交付阶段计划

## Phase A（建议先做）

- 仅实现“真实前台”
- `run_in_background=false` 全链路可用
- `task_output` 对前台 run 可查询终态

## Phase B

- 实现同进程后台（主进程存活期）
- `task_output` 支持阻塞/非阻塞查询
- `task_stop` 支持取消后台 run

## Phase C

- 实现独立 worker 后台（进程解耦）
- 支持跨会话轮询与取消
- 增加恢复与崩溃自愈

---

## 12. 测试与验收标准

必须覆盖：

1. 前台成功/失败/超时
2. 后台启动后轮询完成
3. 后台取消后状态变更
4. linked task 状态联动
5. 模型映射与工具白名单错误路径
6. resume attach 场景

验收口径：

- task 工具链关键文件覆盖率维持 100%（statement/branch/function/line）
- 与 mock 行为兼容：同样的输入语义，不同的是执行变为真实

---

## 13. 关键风险与缓解

1. **后台可靠性风险**：主进程退出导致 run 丢失。  
缓解：Phase C 使用独立 worker + sqlite 持久化。

2. **工具权限风险**：子 agent 误用危险工具。  
缓解：subagent_type 白名单 + ToolManager policy。

3. **模型不可用风险**：env/key/模型配置不一致。  
缓解：启动时强校验并快速失败。

4. **状态不一致风险**：task store 与 app store 双写漂移。  
缓解：以 app run 为执行真相源，task store 做投影更新。

5. **消息重复存储风险**：task 层和外部 service 层重复落盘导致不一致。  
缓解：明确“消息真相源仅外部 Service”，task 层只存 locator + 投影。

---

## 14. 与现有实现的兼容结论

- `task.ts` 无需改参数协议
- `task_output.ts`/`task_stop.ts` 无需改参数协议
- 主要替换点仅在 runner 层（默认 adapter 从 mock 切到 real）
- 可以通过配置开关实现 mock/real 双栈并行，降低迁移风险
- 消息持久化路径可切换到外部 Service 而不影响 tool 协议
