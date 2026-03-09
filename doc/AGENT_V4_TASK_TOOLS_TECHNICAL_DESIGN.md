# Agent-v4 任务工具技术设计文档

## 1. 文档目标

本文档用于指导在 `D:\work\coding-agent-v2\src\agent-v4\tool` 下实现以下 7 个工具：

- `task`
- `task_stop`
- `task_create`
- `task_get`
- `task_list`
- `task_update`
- `task_output`

本阶段只定义技术方案与实施计划，不包含代码实现。

---

## 2. 设计范围与边界

### 2.1 范围内

- 7 个工具的参数契约、返回契约、错误契约
- 任务列表系统（TaskCreate/Get/List/Update）
- 子代理运行系统（task/task_output/task_stop）
- 两套系统的协作关系
- agent-v4 工具规范适配（`BaseTool`、`ToolResult`、并发策略、测试规范）

### 2.2 暂不覆盖

- 分布式任务调度
- 跨机器共享任务状态
- 多租户权限体系
- UI 层展示

---

## 3. 现有规范约束（必须遵守）

依据 `src/agent-v4/tool` 现有实现，新增工具必须满足：

1. 每个工具类继承 `BaseTool`。
2. `parameters` 使用 `zod`，并使用 `.strict()`。
3. 返回统一 `ToolResult`：
   - `success: boolean`
   - `output?: string`
   - `error?: ToolExecutionError`
   - `metadata?: Record<string, unknown>`
4. 由 `DefaultToolManager` 统一处理：
   - JSON 参数解析
   - 参数校验
   - 策略检查
   - confirm 机制
   - 错误封装
5. 并发策略通过：
   - `getConcurrencyMode()`
   - `getConcurrencyLockKey()`
6. 错误输出建议采用可解析前缀格式：
   - `TASK_...`
   - `AGENT_...`

---

## 4. 总体架构

采用“两套系统，统一存储”架构：

1. 任务列表系统（规划层）
   - 工具：`task_create/task_get/task_list/task_update`
   - 职责：任务拆分、依赖管理、状态追踪

2. 子代理运行系统（执行层）
   - 工具：`task/task_output/task_stop`
   - 职责：运行子代理任务、后台执行、查询输出、取消任务

3. 协作关系
   - `task_update(status=in_progress)` -> `task(run...)` -> `task_output` -> `task_update(status=completed|failed)`

---

## 5. 数据模型设计

## 5.1 任务实体（规划层）

```ts
type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

interface TaskEntity {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: string | null;
  blockedBy: string[];
  blocks: string[];
  progress: number;
  checkpoints: Array<{ id: string; name: string; completed: boolean; completedAt?: number }>;
  retryConfig: {
    maxRetries: number;
    retryDelayMs: number;
    backoffMultiplier: number;
    retryOn: string[];
  };
  retryCount: number;
  lastError?: string;
  lastErrorAt?: number;
  timeoutMs?: number;
  tags: Array<{ name: string; color?: string; category?: string }>;
  metadata: Record<string, unknown>;
  history: TaskHistoryEntry[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  version: number;
}
```

## 5.2 子代理运行实体（执行层）

```ts
type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'timed_out';

interface AgentRunEntity {
  agentId: string;
  status: AgentRunStatus;
  subagentType: string;
  prompt: string;
  description?: string;
  model?: 'sonnet' | 'opus' | 'haiku';
  maxTurns?: number;
  allowedTools?: string[];
  linkedTaskId?: string;
  output?: string;
  error?: string;
  progress?: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  updatedAt: number;
  outputFile?: string;
  metadata: Record<string, unknown>;
  version: number;
}
```

## 5.3 存储模型

```ts
interface TaskNamespaceState {
  namespace: string;
  tasks: Record<string, TaskEntity>;
  agentRuns: Record<string, AgentRunEntity>;
  graph: {
    adjacency: Record<string, string[]>;
    reverse: Record<string, string[]>;
  };
  updatedAt: number;
  schemaVersion: 1;
}
```

---

## 6. 存储与隔离策略

## 6.1 命名空间

所有 7 个工具统一支持 `namespace?: string`。默认值：`default`。

目的：

- 避免不同会话互相污染
- 后续可平滑映射到 `conversationId`

## 6.2 持久化

建议持久化路径：

- `D:\work\coding-agent-v2\.agent-cache\task-system-v1\<namespace>.json`

落盘策略：

- 内存缓存 + 原子写（`tmp + rename`）
- 每次写操作后落盘
- 读操作优先内存

## 6.3 并发控制

### 写操作（exclusive）

- `task_create`
- `task_update`
- `task`
- `task_stop`

锁键：

- `taskns:<namespace>`

### 读操作（parallel-safe）

- `task_get`
- `task_list`
- `task_output`

锁键：

- `taskns:<namespace>:read`（或按实体粒度）

---

## 7. 7 个工具契约设计

## 7.1 `task_create`

输入（核心）：

- `subject`（必填）
- `description`（必填）
- `active_form`（可选）
- `priority`（可选）
- `tags/checkpoints/retry_config/metadata/timeout_ms`（可选）
- `namespace`（可选）

输出：

- `success=true`
- `metadata.task` 为完整任务对象

失败错误码：

- `TASK_CREATE_INVALID_SUBJECT`
- `TASK_CREATE_INVALID_DESCRIPTION`
- `TASK_DUPLICATE_SUBJECT`

## 7.2 `task_get`

输入：

- `task_id`（必填）
- `include_history`（可选，默认 `false`）
- `namespace`（可选）

输出：

- 任务详情
- `blockers/blocked_tasks`
- `can_start: { canStart: boolean; reason?: string }`
- `effective_progress`

失败错误码：

- `TASK_NOT_FOUND`

## 7.3 `task_list`

输入：

- `namespace`（可选）
- `status/owner/tag`（可选过滤）
- `include_history`（默认 `false`）

输出：

- 任务摘要数组
- 每项包含 `is_blocked/can_be_claimed`

排序规则（确定性）：

1. critical 且可认领
2. in_progress
3. high 可认领
4. normal 可认领
5. low 可认领
6. blocked
7. completed
8. cancelled/failed

## 7.4 `task_update`

输入（可选字段更新）：

- `task_id`（必填）
- `status/owner/subject/description/active_form/progress/metadata`
- `add_blocked_by/remove_blocked_by`
- `expected_version`（可选，乐观锁）
- `reason/updated_by`
- `namespace`

关键语义：

- `owner` 支持显式设为 `null`（释放任务）
- 状态变更必须记录历史（先保存旧状态再写新状态）
- 添加依赖必须做环检测

失败错误码：

- `TASK_NOT_FOUND`
- `TASK_INVALID_STATUS_TRANSITION`
- `TASK_CYCLE_DEPENDENCY`
- `TASK_TERMINAL_IMMUTABLE`
- `TASK_VERSION_CONFLICT`

## 7.5 `task`

输入：

- `subagent_type`（必填）
- `prompt`（必填）
- `description/model/max_turns/allowed_tools/resume`（可选）
- `run_in_background`（可选，默认 `false`）
- `linked_task_id`（可选，和规划层任务关联）
- `namespace`

输出：

- 同步模式：直接返回完成结果
- 后台模式：返回 `agent_id` 和运行状态

关键语义：

- 创建 `AgentRunEntity`
- 若关联 `linked_task_id`，可自动推进对应任务状态

失败错误码：

- `TASK_AGENT_INVALID_REQUEST`
- `TASK_AGENT_RUN_FAILED`
- `TASK_AGENT_TIMEOUT`

## 7.6 `task_output`

输入：

- `agent_id`（推荐）或 `task_id`（兼容别名）
- `block`（默认 `true`）
- `timeout_ms`（默认 `30000`）
- `namespace`

输出：

- `status` in `running/completed/failed/cancelled/paused/timed_out`
- `output/error/progress`

关键语义：

- 未传 `block` 时必须走阻塞等待（修复历史设计歧义）

失败错误码：

- `AGENT_RUN_NOT_FOUND`

## 7.7 `task_stop`

输入：

- `agent_id`（推荐）或 `task_id`（兼容别名）
- `reason`（可选）
- `cancel_linked_task`（默认 `true`）
- `namespace`

输出：

- 取消结果
- 关联任务更新结果（如果有）

失败错误码：

- `AGENT_RUN_NOT_FOUND`
- `AGENT_RUN_ALREADY_TERMINAL`

---

## 8. 状态机设计

## 8.1 任务状态机（规划层）

- `pending -> in_progress | cancelled`
- `in_progress -> completed | pending | cancelled | failed`
- `failed -> pending`（支持重试）
- `completed/cancelled` 为终态

## 8.2 子代理运行状态机（执行层）

- `queued -> running | cancelled`
- `running -> completed | failed | cancelled | paused | timed_out`
- `paused -> running | cancelled`
- 终态：`completed/failed/cancelled/timed_out`

---

## 9. 核心算法与关键约束

## 9.1 依赖环检测

新增依赖 `A -> B` 时，检查从 `B` 是否可达 `A`（沿 `adjacency`）。
若可达，拒绝并返回 `TASK_CYCLE_DEPENDENCY`。

## 9.2 can_start 判断

判断顺序：

1. 状态必须 `pending`
2. 不能被 owner 占用
3. `blockedBy` 中任务都必须 `completed`
4. 若存在 `cancelled/failed` 依赖，返回需重新规划原因

## 9.3 乐观锁

写接口可带 `expected_version`：

- 不一致则拒绝，返回 `TASK_VERSION_CONFLICT`
- 成功写入后 `version + 1`

## 9.4 历史记录一致性

所有状态变更必须写历史，且 `fromStatus` 来自更新前快照。

---

## 10. 子代理执行适配层设计

为避免工具层与具体执行引擎强耦合，定义适配器：

```ts
interface SubagentRunnerAdapter {
  start(input: StartAgentInput): Promise<{ agentId: string; status: AgentRunStatus; outputFile?: string }>;
  poll(agentId: string): Promise<AgentRunEntity | null>;
  cancel(agentId: string, reason?: string): Promise<boolean>;
}
```

实现分两阶段：

1. Phase A（首版）：`InProcessMockRunnerAdapter`，保障 7 个工具协议闭环可测。
2. Phase B（增强）：`WorkerProcessRunnerAdapter`，支持真实后台执行与中断。

---

## 11. 错误契约设计

错误输出策略：

- `output` 使用 `CODE: message` 形式，便于 LLM 和测试稳定解析
- `metadata.error` 放结构化错误码

统一错误码建议：

- `TASK_NOT_FOUND`
- `TASK_DUPLICATE_SUBJECT`
- `TASK_INVALID_STATUS_TRANSITION`
- `TASK_CYCLE_DEPENDENCY`
- `TASK_TERMINAL_IMMUTABLE`
- `TASK_VERSION_CONFLICT`
- `TASK_BLOCKED`
- `AGENT_RUN_NOT_FOUND`
- `AGENT_RUN_ALREADY_TERMINAL`
- `AGENT_RUN_TIMEOUT`
- `TASK_STORE_IO_ERROR`

---

## 12. 目录与文件规划

建议在 `src/agent-v4/tool` 下新增：

- `task-store.ts`（存储仓库）
- `task-types.ts`（任务领域类型）
- `task-graph.ts`（依赖图算法）
- `task-errors.ts`（任务域错误映射）
- `task-runner-adapter.ts`（子代理适配器接口）
- `task.ts`
- `task-stop.ts`
- `task-create.ts`
- `task-get.ts`
- `task-list.ts`
- `task-update.ts`
- `task-output.ts`

测试文件：

- `src/agent-v4/tool/__test__/task-create-get-list-update.test.ts`
- `src/agent-v4/tool/__test__/task-run-lifecycle.test.ts`
- `src/agent-v4/tool/__test__/task-concurrency-and-version.test.ts`
- `src/agent-v4/tool/__test__/task-output-blocking.test.ts`

---

## 13. 验收标准（文档转实现）

### 13.1 功能验收

- 7 个工具均可被 `DefaultToolManager` 注册与调用
- 工具 schema 可导出为 LLM function schema
- 任务创建/查询/更新/列表全链路可用
- 子代理运行/查询/停止闭环可用

### 13.2 正确性验收

- 环依赖可稳定拦截
- 状态转换非法时正确报错
- `task_output block` 默认语义正确（默认阻塞）
- `owner` 可显式清空为 `null`
- 历史记录 `fromStatus/toStatus` 准确

### 13.3 稳定性验收

- 并发更新具备版本冲突保护
- 工具失败返回结构稳定
- 进程重启后可按 namespace 恢复持久化数据

---

## 14. 分阶段实施计划（编码阶段执行）

### Phase 1：领域模型与存储

- 完成 `task-types/task-store/task-graph`
- 完成 version/历史/原子写机制

### Phase 2：规划层工具

- 实现 `task_create/task_get/task_list/task_update`
- 补齐依赖管理与排序策略

### Phase 3：执行层工具（协议闭环）

- 实现 `task/task_output/task_stop`
- 先接入 `InProcessMockRunnerAdapter`

### Phase 4：执行层增强

- 切换/补充 `WorkerProcessRunnerAdapter`
- 完成后台执行、取消、超时、进度

### Phase 5：测试与集成

- 完成单测、并发测试、端到端回归
- 完成工具注册接入与 prompt 暴露验证

---

## 15. 本阶段结论

本技术方案优先确保三件事：

1. 契约稳定：7 个工具的 schema/输出/错误统一可测。
2. 语义一致：修复既有设计中默认值、状态机、历史记录等冲突点。
3. 可渐进落地：先完成协议闭环，再替换为真实子代理执行引擎。

文档确认后进入编码阶段。

