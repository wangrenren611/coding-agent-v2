# 任务系统设计文档

## 目录

1. [系统概述](#1-系统概述)
2. [Task 工具 - 子代理系统](#2-task-工具---子代理系统)
3. [TaskCreate/Update/Get/List - 任务列表管理系统](#3-taskcreateupdategetlist---任务列表管理系统)
4. [两套系统的协作](#4-两套系统的协作)
5. [关键逻辑问题与解决方案](#5-关键逻辑问题与解决方案)
6. [完整执行流程示例](#6-完整执行流程示例)

---

## 1. 系统概述

### 1.1 两套独立系统

| 系统 | 核心工具 | 主要用途 | 运行模式 |
|------|----------|----------|----------|
| **子代理系统** | Task | 执行实际工作 | 异步/后台 |
| **任务列表系统** | TaskCreate/Update/Get/List | 管理工作流程 | 同步/当前会话 |

### 1.2 设计目标

```
┌─────────────────────────────────────────────────────────────┐
│                      用户请求                               │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│              TaskCreate/Update/Get/List                     │
│                    （任务规划与追踪）                        │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐     │
│  │Task A   │──▶│Task B   │──▶│Task C   │──▶│Task D   │     │
│  │pending  │   │blocked  │   │blocked  │   │pending  │     │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘     │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                        Task                                 │
│                    （实际执行工作）                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Subagent (Bash / Explore / Plan / Research...)     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Task 工具 - 子代理系统

### 2.1 核心数据结构

```typescript
// Task 工具请求参数
interface TaskRequest {
  subagent_type: SubagentType;      // 代理类型
  prompt: string;                    // 任务描述
  description?: string;              // 简短描述 (3-5词)
  model?: 'sonnet' | 'opus' | 'haiku';  // 模型选择
  resume?: string;                   // 恢复的代理ID
  run_in_background?: boolean;       // 是否后台运行
  max_turns?: number;                // 最大轮次
  allowed_tools?: string[];          // 允许使用的工具
}

// 代理类型枚举
enum SubagentType {
  BASH = 'Bash',                     // 命令执行专家
  GENERAL_PURPOSE = 'general-purpose', // 通用代理
  EXPLORE = 'Explore',               // 代码库探索
  PLAN = 'Plan',                     // 架构设计
  RESEARCH_AGENT = 'research-agent', // 网络研究
  CLAUDE_CODE_GUIDE = 'claude-code-guide', // Claude Code指南
}

// 代理运行时状态
interface AgentRuntime {
  agentId: string;                   // 代理唯一标识
  status: 'running' | 'completed' | 'failed' | 'paused';
  startTime: timestamp;
  endTime?: timestamp;
  output?: string;                   // 输出结果
  error?: Error;                     // 错误信息
  context: ConversationHistory;      // 对话上下文
}
```

### 2.2 代理类型与能力映射

```typescript
// 代理类型配置表
const AGENT_CONFIGS: Record<SubagentType, AgentConfig> = {
  Bash: {
    availableTools: ['Bash'],
    description: '命令执行专家，用于git操作、npm、docker等',
    defaultModel: 'haiku',
    maxTurns: 50,
  },

  Explore: {
    availableTools: ['Glob', 'Grep', 'Read', 'Bash'],
    description: '快速探索代码库，查找文件和代码',
    defaultModel: 'sonnet',
    maxTurns: 100,
  },

  Plan: {
    availableTools: ['Glob', 'Grep', 'Read', 'WebSearch', 'WebFetch'],
    description: '软件架构师，设计实现方案',
    defaultModel: 'sonnet',
    maxTurns: 150,
  },

  'research-agent': {
    availableTools: ['WebSearch', 'WebFetch', 'Read', 'Grep'],
    description: '研究代理，获取最新信息',
    defaultModel: 'sonnet',
    maxTurns: 100,
  },

  'general-purpose': {
    availableTools: 'ALL',           // 所有工具
    description: '通用代理，处理复杂多步骤任务',
    defaultModel: 'sonnet',
    maxTurns: 200,
  },
};
```

### 2.3 执行流程

```typescript
async function executeTask(request: TaskRequest): Promise<TaskResult> {
  const agentId = generateAgentId();

  // Step 1: 参数验证
  validateRequest(request);

  // Step 2: 创建代理运行时
  const runtime: AgentRuntime = {
    agentId,
    status: 'running',
    startTime: Date.now(),
    context: [],
  };

  // Step 3: 获取代理配置
  const config = AGENT_CONFIGS[request.subagent_type];

  // Step 4: 构建代理上下文
  const agentContext = {
    systemPrompt: buildSystemPrompt(config, request),
    availableTools: resolveTools(config, request.allowed_tools),
    model: request.model || config.defaultModel,
  };

  // Step 5: 判断执行模式
  if (request.run_in_background) {
    // 后台执行
    return executeInBackground(runtime, agentContext, request);
  } else {
    // 同步执行
    return executeSync(runtime, agentContext, request);
  }
}
```

### 2.4 后台执行逻辑

```typescript
async function executeInBackground(
  runtime: AgentRuntime,
  context: AgentContext,
  request: TaskRequest
): Promise<TaskResult> {
  // Step 1: 创建输出文件
  const outputFile = `/tmp/agent_${runtime.agentId}.log`;

  // Step 2: 启动后台进程
  const process = spawnAgentProcess({
    agentId: runtime.agentId,
    context,
    prompt: request.prompt,
    outputFile,
  });

  // Step 3: 立即返回（不等待完成）
  return {
    agentId: runtime.agentId,
    status: 'running',
    output_file: outputFile,
    message: '代理已在后台启动，使用 TaskOutput 工具获取结果',
  };
}
```

### 2.5 TaskOutput 工具

```typescript
// TaskOutput 工具请求参数
interface TaskOutputRequest {
  task_id: string;              // 后台任务ID（agentId）
  block?: boolean;              // 是否阻塞等待完成（默认true）
  timeout?: number;             // 等待超时（毫秒）
}

// TaskOutput 工具返回结果
interface TaskOutputResult {
  agentId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output?: string;             // 输出结果（如果已完成）
  error?: string;              // 错误信息（如果失败）
  progress?: number;           // 进度百分比
}

// TaskOutput 工具实现
async function taskOutput(request: TaskOutputRequest): Promise<TaskOutputResult> {
  const runtime = getAgentRuntime(request.task_id);
  if (!runtime) {
    throw new Error(`代理不存在: ${request.task_id}`);
  }

  // 非阻塞模式 - 立即返回当前状态
  if (!request.block) {
    return {
      agentId: runtime.agentId,
      status: runtime.status,
      output: runtime.output,
      progress: calculateProgress(runtime),
    };
  }

  // 阻塞模式 - 等待完成或超时
  const timeout = request.timeout || 30000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (runtime.status === 'completed' || runtime.status === 'failed') {
      return {
        agentId: runtime.agentId,
        status: runtime.status,
        output: runtime.output,
        error: runtime.error,
      };
    }
    await sleep(1000);
  }

  return {
    agentId: runtime.agentId,
    status: runtime.status,
    progress: calculateProgress(runtime),
  };
}
```

### 2.6 同步执行逻辑

```typescript
async function executeSync(
  runtime: AgentRuntime,
  context: AgentContext,
  request: TaskRequest
): Promise<TaskResult> {
  let turnCount = 0;
  const maxTurns = request.max_turns || context.config.maxTurns;

  while (turnCount < maxTurns) {
    // Step 1: 调用LLM获取下一步行动
    const response = await callLLM({
      model: context.model,
      messages: runtime.context,
      tools: context.availableTools,
    });

    // Step 2: 检查是否完成
    if (isTaskComplete(response)) {
      runtime.status = 'completed';
      runtime.endTime = Date.now();
      return {
        agentId: runtime.agentId,
        status: 'completed',
        output: response.content,
      };
    }

    // Step 3: 执行工具调用
    if (response.tool_calls) {
      for (const toolCall of response.tool_calls) {
        const result = await executeToolCall(toolCall);
        runtime.context.push({
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id,
        });
      }
    }

    turnCount++;
  }

  // 超过最大轮次
  runtime.status = 'paused';
  return {
    agentId: runtime.agentId,
    status: 'paused',
    message: '达到最大轮次限制，可使用 resume 参数继续',
  };
}
```

### 2.6 关键判断逻辑

```typescript
// 判断1: 任务是否完成
function isTaskComplete(response: LLMResponse): boolean {
  // 条件1: 没有更多工具调用请求
  const noToolCalls = !response.tool_calls || response.tool_calls.length === 0;

  // 条件2: 响应中包含完成标记
  const hasCompletionSignal =
    response.content.includes('[TASK_COMPLETE]') ||
    response.content.includes('任务已完成');

  // 条件3: 代理主动报告完成
  const explicitlyComplete = response.metadata?.status === 'complete';

  return noToolCalls && (hasCompletionSignal || explicitlyComplete);
}

// 判断2: 是否需要恢复之前的代理
function shouldResume(request: TaskRequest): boolean {
  return request.resume !== undefined;
}

// 判断3: 工具权限检查
function checkToolPermission(
  toolName: string,
  allowedTools: string[] | 'ALL'
): boolean {
  if (allowedTools === 'ALL') return true;

  // 检查通配符匹配
  for (const pattern of allowedTools) {
    if (matchPattern(toolName, pattern)) {
      return true;
    }
  }

  return false;
}

// 判断4: 模型选择逻辑
function selectModel(request: TaskRequest, config: AgentConfig): string {
  // 优先级: 请求指定 > 配置默认 > 系统默认
  return request.model || config.defaultModel || 'sonnet';
}
```

---

## 3. TaskCreate/Update/Get/List - 任务列表管理系统

### 3.1 核心数据结构

```typescript
// 任务实体
interface Task {
  id: string;                        // 任务唯一标识
  subject: string;                   // 简短标题（命令式）
  description: string;               // 详细描述
  activeForm: string;                // 进行中时的显示文本

  status: TaskStatus;                // 任务状态
  priority: TaskPriority;            // 任务优先级
  owner?: string;                    // 分配的代理/用户

  blockedBy: string[];               // 阻塞此任务的任务ID列表
  blocks: string[];                  // 此任务阻塞的任务ID列表

  tags: TaskTag[];                   // 任务标签列表

  // 进度追踪
  progress: number;                  // 进度百分比 (0-100)
  checkpoints: TaskCheckpoint[];     // 检查点列表

  // 重试机制
  retryConfig: RetryConfig;          // 重试配置
  retryCount: number;                // 当前重试次数
  lastError?: string;                // 最后一次错误信息
  lastErrorAt?: timestamp;           // 最后一次错误时间

  // 时间估算与追踪
  estimatedMinutes?: number;         // 预估完成时间（分钟）
  actualMinutes?: number;            // 实际耗时（分钟）

  // 超时配置
  timeoutMs?: number;                // 任务超时时间（毫秒）

  // 子代理关联
  agentId?: string;                  // 关联的子代理ID

  metadata: Record<string, any>;     // 附加元数据

  // 历史记录
  history: TaskHistoryEntry[];       // 状态变更历史

  createdAt: timestamp;
  updatedAt: timestamp;
  startedAt?: timestamp;             // 开始执行时间
  completedAt?: timestamp;           // 完成时间
  cancelledAt?: timestamp;           // 取消时间
}

// 检查点接口
interface TaskCheckpoint {
  id: string;
  name: string;                      // 检查点名称
  completed: boolean;                // 是否完成
  completedAt?: timestamp;           // 完成时间
}

// 重试配置接口
interface RetryConfig {
  maxRetries: number;                // 最大重试次数
  retryDelayMs: number;              // 重试间隔（毫秒）
  backoffMultiplier: number;         // 退避乘数（指数退避）
  retryOn: string[];                 // 触发重试的错误类型
}

// 历史记录条目
interface TaskHistoryEntry {
  timestamp: timestamp;
  action: string;                    // 动作类型
  fromStatus?: TaskStatus;           // 原状态
  toStatus?: TaskStatus;             // 新状态
  actor?: string;                    // 执行者
  reason?: string;                   // 原因说明
  metadata?: Record<string, any>;    // 附加信息
}

// 任务状态枚举
enum TaskStatus {
  PENDING = 'pending',       // 待处理
  IN_PROGRESS = 'in_progress', // 进行中
  COMPLETED = 'completed',   // 已完成
  CANCELLED = 'cancelled',   // 已取消
  FAILED = 'failed',         // 已失败（重试次数用尽）
}

// 任务优先级枚举
enum TaskPriority {
  CRITICAL = 'critical',     // 紧急：必须立即处理
  HIGH = 'high',             // 高优先级
  NORMAL = 'normal',         // 普通优先级（默认）
  LOW = 'low',               // 低优先级
}

// 任务标签接口
interface TaskTag {
  name: string;              // 标签名
  color?: string;            // 标签颜色（可选）
  category?: string;         // 标签分类（如：module、type、team）
}

// 任务列表存储
interface TaskStore {
  tasks: Map<string, Task>;
  dependencyGraph: DependencyGraph;
  history: Map<string, TaskHistoryEntry[]>;  // 任务历史记录
  cancelledAgents: Set<string>;               // 已取消的代理ID集合
}
```

### 3.2 依赖图数据结构

```typescript
// 依赖图（有向无环图）
interface DependencyGraph {
  // 邻接表表示: taskId -> 依赖它的任务列表
  adjacencyList: Map<string, Set<string>>;

  // 反向邻接表: taskId -> 它依赖的任务列表
  reverseList: Map<string, Set<string>>;
}

// 示例：
// A -> B -> C
// A -> D
//
// adjacencyList: {
//   A: {B, D},
//   B: {C},
//   C: {},
//   D: {}
// }
//
// reverseList: {
//   A: {},
//   B: {A},
//   C: {B},
//   D: {A}
// }
```

### 3.3 TaskCreate 实现

```typescript
async function taskCreate(request: TaskCreateRequest): Promise<Task> {
  // Step 1: 参数验证
  if (!request.subject || request.subject.length < 3) {
    throw new Error('任务标题至少需要3个字符');
  }

  if (!request.description || request.description.length < 10) {
    throw new Error('任务描述需要更加详细');
  }

  // Step 2: 检查重复任务
  const existingTasks = taskStore.tasks.values();
  for (const task of existingTasks) {
    if (task.subject === request.subject && !isTerminalState(task.status)) {
      throw new Error(`已存在相同标题的任务: ${task.id}`);
    }
  }

  // Step 3: 创建任务实体
  const task: Task = {
    id: generateTaskId(),
    subject: request.subject,
    description: request.description,
    activeForm: request.activeForm || `${request.subject}中`,
    status: TaskStatus.PENDING,
    priority: request.priority || TaskPriority.NORMAL,
    blockedBy: [],
    blocks: [],
    tags: request.tags || [],
    progress: 0,
    checkpoints: request.checkpoints || [],
    retryConfig: request.retryConfig || {
      maxRetries: 3,
      retryDelayMs: 5000,
      backoffMultiplier: 2,
      retryOn: ['timeout', 'network_error'],
    },
    retryCount: 0,
    history: [],
    metadata: request.metadata || {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Step 4: 记录创建历史
  addHistoryEntry(task.id, {
    action: 'created',
    actor: request.createdBy,
    metadata: { subject: request.subject },
  });

  // Step 5: 存储任务
  taskStore.tasks.set(task.id, task);

  // Step 6: 初始化依赖图节点
  taskStore.dependencyGraph.adjacencyList.set(task.id, new Set());
  taskStore.dependencyGraph.reverseList.set(task.id, new Set());

  return task;
}

// 判断是否为终态
function isTerminalState(status: TaskStatus): boolean {
  return status === TaskStatus.COMPLETED ||
         status === TaskStatus.CANCELLED ||
         status === TaskStatus.FAILED;
}

// 添加历史记录
function addHistoryEntry(taskId: string, entry: Omit<TaskHistoryEntry, 'timestamp'>): void {
  const history = taskStore.history.get(taskId) || [];
  history.push({
    ...entry,
    timestamp: Date.now(),
  });
  taskStore.history.set(taskId, history);
}
```

### 3.4 TaskUpdate 实现

```typescript
async function taskUpdate(request: TaskUpdateRequest): Promise<Task> {
  // Step 1: 获取任务（确保读取最新状态）
  const task = taskStore.tasks.get(request.taskId);
  if (!task) {
    throw new Error(`任务不存在: ${request.taskId}`);
  }

  // Step 2: 终态检查（已完成/已取消/已失败的任务不能再修改）
  if (isTerminalState(task.status)) {
    throw new Error(`任务处于终态 (${task.status})，无法修改`);
  }

  // Step 3: 状态转换验证
  if (request.status) {
    validateStatusTransition(task.status, request.status);
  }

  // Step 4: 处理取消操作
  if (request.status === TaskStatus.CANCELLED) {
    return await cancelTask(task, request);
  }

  // Step 5: 处理依赖关系添加
  if (request.addBlockedBy) {
    for (const blockerId of request.addBlockedBy) {
      await addDependency(blockerId, request.taskId);
    }
  }

  // Step 6: 处理依赖关系移除
  if (request.removeBlockedBy) {
    for (const blockerId of request.removeBlockedBy) {
      await removeDependency(blockerId, request.taskId);
    }
  }

  // Step 7: 更新任务字段
  const updates: Partial<Task> = {
    updatedAt: Date.now(),
  };

  if (request.subject) updates.subject = request.subject;
  if (request.description) updates.description = request.description;
  if (request.activeForm) updates.activeForm = request.activeForm;
  if (request.status) {
    updates.status = request.status;

    // 记录状态变更时间
    if (request.status === TaskStatus.IN_PROGRESS) {
      updates.startedAt = Date.now();
    } else if (request.status === TaskStatus.COMPLETED) {
      updates.completedAt = Date.now();
      updates.progress = 100;
    }
  }
  if (request.priority) updates.priority = request.priority;
  if (request.owner) updates.owner = request.owner;
  if (request.progress !== undefined) updates.progress = request.progress;
  if (request.metadata) {
    updates.metadata = { ...task.metadata, ...request.metadata };
  }

  // Step 8: 合并更新
  Object.assign(task, updates);

  // Step 9: 记录历史
  if (request.status && request.status !== task.status) {
    addHistoryEntry(task.id, {
      action: 'status_changed',
      fromStatus: task.status,
      toStatus: request.status,
      actor: request.updatedBy,
      reason: request.reason,
    });
  }

  // Step 10: 如果任务完成，通知被阻塞的任务
  if (request.status === TaskStatus.COMPLETED) {
    await notifyUnblockedTasks(request.taskId);
  }

  return task;
}

// 取消任务
async function cancelTask(task: Task, request: TaskUpdateRequest): Promise<Task> {
  // 如果任务正在进行，需要取消关联的子代理
  if (task.status === TaskStatus.IN_PROGRESS && task.owner) {
    // 将代理ID添加到取消集合
    taskStore.cancelledAgents.add(task.owner);
  }

  // 更新任务状态
  task.status = TaskStatus.CANCELLED;
  task.cancelledAt = Date.now();
  task.updatedAt = Date.now();

  // 记录历史
  addHistoryEntry(task.id, {
    action: 'cancelled',
    fromStatus: task.status,
    toStatus: TaskStatus.CANCELLED,
    actor: request.updatedBy,
    reason: request.reason,
  });

  // 通知依赖此任务的任务（它们可能需要重新规划）
  await notifyDependentTasks(task.id, 'dependency_cancelled');

  return task;
}
```

### 3.5 关键逻辑：依赖关系管理

```typescript
// 添加依赖关系：blocker -> dependent (blocker 完成后 dependent 才能开始)
async function addDependency(blockerId: string, dependentId: string): Promise<void> {
  // Step 1: 验证两个任务都存在
  const blocker = taskStore.tasks.get(blockerId);
  const dependent = taskStore.tasks.get(dependentId);

  if (!blocker) throw new Error(`阻塞任务不存在: ${blockerId}`);
  if (!dependent) throw new Error(`被阻塞任务不存在: ${dependentId}`);

  // Step 2: 检查是否会形成循环依赖
  if (wouldCreateCycle(blockerId, dependentId)) {
    throw new Error('添加此依赖将形成循环依赖');
  }

  // Step 3: 更新依赖图
  taskStore.dependencyGraph.adjacencyList.get(blockerId).add(dependentId);
  taskStore.dependencyGraph.reverseList.get(dependentId).add(blockerId);

  // Step 4: 更新任务的 blockedBy 和 blocks 字段
  if (!dependent.blockedBy.includes(blockerId)) {
    dependent.blockedBy.push(blockerId);
  }
  if (!blocker.blocks.includes(dependentId)) {
    blocker.blocks.push(dependentId);
  }
}

// 检测循环依赖（深度优先搜索）
function wouldCreateCycle(from: string, to: string): boolean {
  // 如果从 to 能到达 from，则添加 from->to 会形成环
  const visited = new Set<string>();
  const stack = [to];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (visited.has(current)) continue;

    visited.add(current);

    // 获取当前任务的所有依赖（它等待的任务）
    const dependencies = taskStore.dependencyGraph.reverseList.get(current);
    for (const dep of dependencies) {
      stack.push(dep);
    }
  }

  return false;
}
```

### 3.6 关键逻辑：状态转换

```typescript
// 状态转换规则（更新版）
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.PENDING]: [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.COMPLETED, TaskStatus.PENDING, TaskStatus.CANCELLED, TaskStatus.FAILED],
  [TaskStatus.COMPLETED]: [], // 已完成不能转换到其他状态
  [TaskStatus.CANCELLED]: [], // 已取消不能转换到其他状态
  [TaskStatus.FAILED]: [TaskStatus.PENDING], // 失败后可以重试
};

function validateStatusTransition(from: TaskStatus, to: TaskStatus): void {
  const allowedTargets = VALID_TRANSITIONS[from];

  if (!allowedTargets.includes(to)) {
    throw new Error(
      `无效的状态转换: ${from} -> ${to}。` +
      `允许的转换: ${allowedTargets.join(', ') || '无'}`
    );
  }
}

// 检查任务是否可以被开始
function canStartTask(task: Task): { canStart: boolean; reason?: string } {
  // 检查1: 状态必须是 pending
  if (task.status !== TaskStatus.PENDING) {
    return {
      canStart: false,
      reason: `任务状态为 ${task.status}，必须是 pending`,
    };
  }

  // 检查2: 所有阻塞任务必须已完成（注意：取消的任务不算是完成）
  const incompleteBlockers = task.blockedBy.filter(blockerId => {
    const blocker = taskStore.tasks.get(blockerId);
    return blocker && blocker.status !== TaskStatus.COMPLETED;
  });

  if (incompleteBlockers.length > 0) {
    return {
      canStart: false,
      reason: `以下任务尚未完成: ${incompleteBlockers.join(', ')}`,
    };
  }

  // 检查3: 是否有依赖的任务被取消了
  const cancelledBlockers = task.blockedBy.filter(blockerId => {
    const blocker = taskStore.tasks.get(blockerId);
    return blocker && blocker.status === TaskStatus.CANCELLED;
  });

  if (cancelledBlockers.length > 0) {
    return {
      canStart: false,
      reason: `依赖的任务已被取消: ${cancelledBlockers.join(', ')}，需要重新规划`,
    };
  }

  // 检查4: 任务是否已被分配
  if (task.owner) {
    return {
      canStart: false,
      reason: `任务已分配给: ${task.owner}`,
    };
  }

  return { canStart: true };
}
```

### 3.7 TaskGet 实现

```typescript
async function taskGet(taskId: string, options?: TaskGetOptions): Promise<TaskDetail> {
  const task = taskStore.tasks.get(taskId);

  if (!task) {
    throw new Error(`任务不存在: ${taskId}`);
  }

  // 计算任务的解锁状态
  const blockers = task.blockedBy.map(id => {
    const blocker = taskStore.tasks.get(id);
    return {
      id: blocker.id,
      subject: blocker.subject,
      status: blocker.status,
    };
  });

  // 计算此任务阻塞了哪些任务
  const blockedTasks = task.blocks.map(id => {
    const blocked = taskStore.tasks.get(id);
    return {
      id: blocked.id,
      subject: blocked.subject,
      status: blocked.status,
    };
  });

  // 获取任务历史记录（如果请求）
  const history = options?.includeHistory
    ? taskStore.history.get(taskId) || []
    : undefined;

  // 计算检查点进度
  const checkpointProgress = calculateCheckpointProgress(task);

  return {
    ...task,
    blockers,
    blockedTasks,
    canStart: canStartTask(task),
    history,
    checkpointProgress,
    effectiveProgress: Math.max(task.progress, checkpointProgress),
  };
}

// TaskGet 选项接口
interface TaskGetOptions {
  includeHistory?: boolean;  // 是否包含历史记录
}

// 计算检查点完成进度
function calculateCheckpointProgress(task: Task): number {
  if (!task.checkpoints || task.checkpoints.length === 0) {
    return 0;
  }

  const completedCount = task.checkpoints.filter(cp => cp.completed).length;
  return Math.round((completedCount / task.checkpoints.length) * 100);
}
```

### 3.8 TaskList 实现

```typescript
async function taskList(): Promise<TaskSummary[]> {
  const summaries: TaskSummary[] = [];

  for (const task of taskStore.tasks.values()) {
    // 计算阻塞状态
    const blockedByCount = task.blockedBy.filter(id => {
      const blocker = taskStore.tasks.get(id);
      return blocker && blocker.status !== TaskStatus.COMPLETED;
    }).length;

    summaries.push({
      id: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner || null,
      blockedBy: task.blockedBy,        // 阻塞此任务的ID列表
      isBlocked: blockedByCount > 0,    // 是否被阻塞
      canBeClaimed: task.status === TaskStatus.PENDING &&
                    blockedByCount === 0 &&
                    !task.owner,
    });
  }

  // 排序：进行中 > 可认领 > 被阻塞 > 已完成
  return summaries.sort((a, b) => {
    const priority = {
      [TaskStatus.IN_PROGRESS]: 0,
      'claimable': 1,
      'blocked': 2,
      [TaskStatus.COMPLETED]: 3,
    };

    const aPriority = a.canBeClaimed ? priority.claimable :
                      a.isBlocked ? priority.blocked :
                      priority[a.status];
    const bPriority = b.canBeClaimed ? priority.claimable :
                      b.isBlocked ? priority.blocked :
                      priority[b.status];

    return aPriority - bPriority;
  });
}
```

---

## 4. 两套系统的协作

### 4.1 协作架构图

```
┌────────────────────────────────────────────────────────────────┐
│                         主代理 (Main Agent)                     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    任务调度逻辑                          │   │
│  │                                                         │   │
│  │   1. TaskList() 获取所有任务                            │   │
│  │   2. TaskGet() 检查依赖状态                             │   │
│  │   3. TaskUpdate() 认领任务                              │   │
│  │   4. Task() 分配给子代理执行                            │   │
│  │   5. TaskUpdate() 标记完成                              │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│              ┌───────────────┴───────────────┐                  │
│              ▼                               ▼                  │
│  ┌─────────────────────┐       ┌─────────────────────────┐     │
│  │  TaskList 系统      │       │     Task 子代理系统      │     │
│  │                     │       │                         │     │
│  │  - 任务规划         │◀─────▶│  - 实际执行工作          │     │
│  │  - 依赖管理         │  反馈  │  - 代码探索              │     │
│  │  - 进度追踪         │       │  - 命令执行              │     │
│  │                     │       │  - 网络研究              │     │
│  └─────────────────────┘       └─────────────────────────┘     │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### 4.2 协作流程伪代码

```typescript
async function executeTaskWorkflow(): Promise<void> {
  // Phase 1: 获取可执行任务
  const allTasks = await taskList();

  // 找到第一个可以开始的任务
  const availableTask = allTasks.find(t =>
    t.status === 'pending' &&
    !t.isBlocked &&
    !t.owner
  );

  if (!availableTask) {
    console.log('没有可执行的任务');
    return;
  }

  // Phase 2: 认领任务
  await taskUpdate({
    taskId: availableTask.id,
    status: 'in_progress',
    owner: 'main-agent',
  });

  // Phase 3: 分析任务，决定使用哪个子代理
  const agentType = determineAgentType(availableTask);

  // Phase 4: 启动子代理执行
  const result = await task({
    subagent_type: agentType,
    prompt: `
      任务: ${availableTask.subject}

      描述: ${availableTask.description}

      请完成此任务并返回结果。
    `,
  });

  // Phase 5: 根据结果更新任务状态
  if (result.status === 'completed') {
    await taskUpdate({
      taskId: availableTask.id,
      status: 'completed',
      metadata: {
        result: result.output,
        completedAt: Date.now(),
      },
    });

    // Phase 6: 检查是否有新任务被解锁
    const updatedTask = await taskGet(availableTask.id);
    for (const blockedTaskId of updatedTask.blocks) {
      const blockedTask = await taskGet(blockedTaskId);
      if (blockedTask.canStart.canStart) {
        console.log(`任务 ${blockedTaskId} 已解锁，可以开始执行`);
      }
    }
  } else {
    // 任务失败，回退状态
    await taskUpdate({
      taskId: availableTask.id,
      status: 'pending',
      owner: null,
      metadata: {
        error: result.error,
        failedAt: Date.now(),
      },
    });
  }
}

// 根据任务特征选择代理类型
function determineAgentType(task: Task): SubagentType {
  const desc = task.description.toLowerCase();
  const subject = task.subject.toLowerCase();

  // 关键词匹配
  if (desc.includes('git') || desc.includes('npm') || desc.includes('docker')) {
    return SubagentType.BASH;
  }

  if (desc.includes('探索') || desc.includes('查找') || desc.includes('搜索代码')) {
    return SubagentType.EXPLORE;
  }

  if (desc.includes('设计') || desc.includes('方案') || desc.includes('架构')) {
    return SubagentType.PLAN;
  }

  if (desc.includes('研究') || desc.includes('最新') || desc.includes('搜索网络')) {
    return SubagentType.RESEARCH_AGENT;
  }

  return SubagentType.GENERAL_PURPOSE;
}
```

---

## 5. 关键逻辑问题与解决方案

### 5.1 问题1: 循环依赖检测

**问题描述**：
任务 A 依赖 B，B 依赖 C，C 依赖 A，形成死锁。

**解决方案**：
```typescript
function detectCycle(): string[] | null {
  // 使用 Kahn 算法进行拓扑排序
  const inDegree = new Map<string, number>();
  const graph = taskStore.dependencyGraph.reverseList;

  // 初始化入度
  for (const taskId of graph.keys()) {
    inDegree.set(taskId, graph.get(taskId).size);
  }

  // 找出入度为 0 的节点
  const queue: string[] = [];
  for (const [taskId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(taskId);
    }
  }

  let visitedCount = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    visitedCount++;

    // 遍历所有依赖当前任务的任务
    const dependents = taskStore.dependencyGraph.adjacencyList.get(current);
    for (const dependent of dependents) {
      const newDegree = inDegree.get(dependent) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // 如果访问的节点数小于总节点数，说明存在环
  if (visitedCount < taskStore.tasks.size) {
    // 返回环中的节点
    const cycleNodes: string[] = [];
    for (const [taskId, degree] of inDegree) {
      if (degree > 0) {
        cycleNodes.push(taskId);
      }
    }
    return cycleNodes;
  }

  return null;
}
```

### 5.2 问题2: 并发修改冲突

**问题描述**：
多个代理同时尝试认领同一个任务。

**解决方案**：
```typescript
// 使用乐观锁机制
async function claimTask(taskId: string, owner: string): Promise<Task> {
  const task = taskStore.tasks.get(taskId);

  // 版本检查
  const currentVersion = task.metadata._version || 0;

  // 原子更新（伪代码，实际需要数据库支持）
  const updated = await taskStore.atomicUpdate(
    {
      id: taskId,
      'metadata._version': currentVersion,
    },
    {
      $set: {
        owner: owner,
        status: TaskStatus.IN_PROGRESS,
        'metadata._version': currentVersion + 1,
        updatedAt: Date.now(),
      },
    }
  );

  if (!updated) {
    throw new Error('任务已被其他代理认领或版本已变更');
  }

  return updated;
}
```

### 5.3 问题3: 子代理超时处理

**问题描述**：
子代理执行时间过长或卡死。

**解决方案**：
```typescript
async function executeWithTimeout(
  request: TaskRequest,
  timeoutMs: number = 600000 // 默认10分钟
): Promise<TaskResult> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`任务执行超时 (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      executeTask(request),
      timeoutPromise,
    ]);
    return result;
  } catch (error) {
    // 超时后清理资源
    await cleanupAgentResources(request.agentId);
    throw error;
  }
}
```

### 5.4 问题4: 任务状态不一致

**问题描述**：
子代理执行失败，但任务状态未正确更新。

**解决方案**：
```typescript
async function executeTaskSafely(taskId: string, agentRequest: TaskRequest): Promise<void> {
  let taskClaimed = false;

  try {
    // Step 1: 认领任务
    await taskUpdate({
      taskId,
      status: 'in_progress',
      owner: 'main-agent',
    });
    taskClaimed = true;

    // Step 2: 执行子代理
    const result = await executeWithTimeout(agentRequest);

    // Step 3: 标记完成
    if (result.status === 'completed') {
      await taskUpdate({
        taskId,
        status: 'completed',
        metadata: { result: result.output },
      });
    } else {
      throw new Error(`子代理返回非完成状态: ${result.status}`);
    }

  } catch (error) {
    // 异常处理：回退任务状态
    if (taskClaimed) {
      await taskUpdate({
        taskId,
        status: 'pending',
        owner: null,
        metadata: {
          lastError: error.message,
          failedAt: Date.now(),
        },
      });
    }

    // 记录错误日志
    await logError({
      taskId,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
}
```

### 5.5 问题5: 依赖链过长

**问题描述**：
任务依赖链 A->B->C->D->E 过长，中间某个任务失败导致整条链阻塞。

**解决方案**：
```typescript
// 计算任务的关键路径
function calculateCriticalPath(taskId: string): {
  depth: number;
  path: string[];
} {
  const task = taskStore.tasks.get(taskId);

  if (task.blockedBy.length === 0) {
    return { depth: 0, path: [taskId] };
  }

  let maxDepth = 0;
  let criticalPath: string[] = [];

  for (const blockerId of task.blockedBy) {
    const result = calculateCriticalPath(blockerId);
    if (result.depth > maxDepth) {
      maxDepth = result.depth;
      criticalPath = result.path;
    }
  }

  return {
    depth: maxDepth + 1,
    path: [...criticalPath, taskId],
  };
}

// 检查并警告过长的依赖链
function checkDependencyDepth(taskId: string, maxAllowedDepth: number = 5): void {
  const { depth, path } = calculateCriticalPath(taskId);

  if (depth > maxAllowedDepth) {
    console.warn(`
      警告: 任务 ${taskId} 的依赖链深度为 ${depth}，超过建议值 ${maxAllowedDepth}

      依赖路径: ${path.join(' -> ')}

      建议: 考虑拆分任务或调整依赖关系
    `);
  }
}
```

### 5.6 问题6: 子代理结果解析

**问题描述**：
子代理返回的结果格式不统一，难以自动处理。

**解决方案**：
```typescript
// 定义标准的子代理结果格式
interface AgentResultSchema {
  status: 'success' | 'partial' | 'failed';
  summary: string;           // 简短摘要
  details: any;              // 详细结果
  artifacts?: string[];      // 产生的文件路径
  followUpTasks?: string[];  // 咸询的后续任务
}

// 结果解析器
function parseAgentResult(rawOutput: string): AgentResultSchema {
  // 尝试解析 JSON
  try {
    const parsed = JSON.parse(rawOutput);
    if (isValidResultSchema(parsed)) {
      return parsed;
    }
  } catch {
    // 不是 JSON，继续其他解析方式
  }

  // 尝试从文本中提取结构化信息
  const statusMatch = rawOutput.match(/状态[:：]\s*(成功|失败|部分完成)/);
  const summaryMatch = rawOutput.match(/摘要[:：]\s*(.+)/);

  return {
    status: statusMatch ?
      (statusMatch[1] === '成功' ? 'success' :
       statusMatch[1] === '失败' ? 'failed' : 'partial') : 'success',
    summary: summaryMatch ? summaryMatch[1] : rawOutput.slice(0, 200),
    details: rawOutput,
  };
}
```

---

## 6. 完整执行流程示例

### 6.1 场景：构建一个用户认证系统

```typescript
// ============================================
// Step 1: 创建任务列表
// ============================================

const task1 = await taskCreate({
  subject: '设计认证系统架构',
  description: '设计用户认证系统的整体架构，包括认证流程、数据模型、API设计',
  activeForm: '设计认证系统架构中',
});

const task2 = await taskCreate({
  subject: '实现用户注册功能',
  description: '实现用户注册API，包括输入验证、密码加密、数据库存储',
  activeForm: '实现用户注册功能中',
});

const task3 = await taskCreate({
  subject: '实现用户登录功能',
  description: '实现用户登录API，包括凭证验证、Token生成',
  activeForm: '实现用户登录功能中',
});

const task4 = await taskCreate({
  subject: '实现认证中间件',
  description: '实现API认证中间件，验证Token、提取用户信息',
  activeForm: '实现认证中间件中',
});

const task5 = await taskCreate({
  subject: '编写测试用例',
  description: '为所有认证功能编写单元测试和集成测试',
  activeForm: '编写测试用例中',
});

// ============================================
// Step 2: 设置任务依赖关系
// ============================================

// 任务2、3、4 依赖任务1（架构设计）
await taskUpdate({ taskId: task2.id, addBlockedBy: [task1.id] });
await taskUpdate({ taskId: task3.id, addBlockedBy: [task1.id] });
await taskUpdate({ taskId: task4.id, addBlockedBy: [task1.id] });

// 任务5 依赖任务2、3、4（需要功能完成后测试）
await taskUpdate({ taskId: task5.id, addBlockedBy: [task2.id, task3.id, task4.id] });

// 依赖图:
// task1 (架构设计)
//   ├── task2 (注册)
//   ├── task3 (登录)
//   └── task4 (中间件)
//         ↓
//       task5 (测试)

// ============================================
// Step 3: 执行任务1 - 架构设计
// ============================================

// 3.1 获取任务详情，确认可以开始
const task1Detail = await taskGet(task1.id);
console.log(task1Detail.canStart);
// { canStart: true } - 没有依赖，可以开始

// 3.2 认领任务
await taskUpdate({
  taskId: task1.id,
  status: 'in_progress',
  owner: 'main-agent',
});

// 3.3 启动 Plan 代理执行架构设计
const planResult = await task({
  subagent_type: 'Plan',
  prompt: `
    任务: 设计用户认证系统架构

    要求:
    1. 支持 email/password 认证
    2. 使用 JWT 作为认证令牌
    3. 密码使用 bcrypt 加密
    4. API 设计遵循 RESTful 规范

    请输出:
    - 系统架构图
    - 数据模型设计
    - API 端点列表
    - 安全考虑事项
  `,
  description: '设计认证系统架构',
});

// 3.4 标记任务完成
await taskUpdate({
  taskId: task1.id,
  status: 'completed',
  metadata: {
    architectureDoc: planResult.output,
  },
});

// ============================================
// Step 4: 并行执行任务2、3、4
// ============================================

// 4.1 获取所有任务状态
const allTasks = await taskList();
// task1: completed
// task2: pending, blockedBy: [] (已解锁)
// task3: pending, blockedBy: [] (已解锁)
// task4: pending, blockedBy: [] (已解锁)
// task5: pending, blockedBy: [task2, task3, task4] (仍被阻塞)

// 4.2 并行启动三个子代理
const [regResult, loginResult, middlewareResult] = await Promise.all([
  // 任务2: 注册功能
  executeTaskWithDependency(task2.id, {
    subagent_type: 'general-purpose',
    prompt: `
      参考架构文档: ${planResult.output}

      实现用户注册功能:
      - 创建 /api/auth/register 端点
      - 输入验证 (email格式, 密码强度)
      - 密码加密存储
      - 返回用户信息（不含密码）
    `,
    description: '实现用户注册',
  }),

  // 任务3: 登录功能
  executeTaskWithDependency(task3.id, {
    subagent_type: 'general-purpose',
    prompt: `
      参考架构文档: ${planResult.output}

      实现用户登录功能:
      - 创建 /api/auth/login 端点
      - 验证用户凭证
      - 生成 JWT Token
      - 返回 Token 和用户信息
    `,
    description: '实现用户登录',
  }),

  // 任务4: 认证中间件
  executeTaskWithDependency(task4.id, {
    subagent_type: 'general-purpose',
    prompt: `
      参考架构文档: ${planResult.output}

      实现认证中间件:
      - 从请求头提取 Bearer Token
      - 验证 JWT 签名和有效期
      - 将用户信息注入请求对象
      - 处理各种错误情况
    `,
    description: '实现认证中间件',
  }),
]);

// ============================================
// Step 5: 执行任务5 - 测试
// ============================================

// 5.1 检查任务5是否已解锁
const task5Detail = await taskGet(task5.id);
console.log(task5Detail.canStart);
// { canStart: true } - 所有依赖已完成

// 5.2 执行测试任务
await executeTaskWithDependency(task5.id, {
  subagent_type: 'Bash',
  prompt: `
    为认证系统运行测试:
    1. npm test
    2. 报告测试覆盖率
    3. 修复任何失败的测试
  `,
  description: '运行认证系统测试',
});

// ============================================
// Step 6: 最终检查
// ============================================

const finalStatus = await taskList();
console.log('所有任务状态:');
for (const task of finalStatus) {
  console.log(`[${task.status}] ${task.subject}`);
}

// 输出:
// [completed] 设计认证系统架构
// [completed] 实现用户注册功能
// [completed] 实现用户登录功能
// [completed] 实现认证中间件
// [completed] 编写测试用例
```

### 6.2 辅助函数实现

```typescript
// 带依赖检查的任务执行
async function executeTaskWithDependency(
  taskId: string,
  agentRequest: TaskRequest
): Promise<TaskResult> {
  // Step 1: 检查依赖
  const taskDetail = await taskGet(taskId);

  if (!taskDetail.canStart.canStart) {
    throw new Error(`任务无法开始: ${taskDetail.canStart.reason}`);
  }

  // Step 2: 认领任务
  await taskUpdate({
    taskId,
    status: 'in_progress',
    owner: 'main-agent',
  });

  try {
    // Step 3: 执行子代理
    const result = await task({
      ...agentRequest,
      run_in_background: false, // 同步等待完成
    });

    // Step 4: 标记完成
    await taskUpdate({
      taskId,
      status: 'completed',
      metadata: {
        agentResult: result,
        completedAt: Date.now(),
      },
    });

    return result;

  } catch (error) {
    // 失败时回退
    await taskUpdate({
      taskId,
      status: 'pending',
      owner: null,
      metadata: {
        error: error.message,
        failedAt: Date.now(),
      },
    });

    throw error;
  }
}
```

---

## 附录

### A. 工具参数完整参考

#### Task 工具

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| subagent_type | string | 是 | 代理类型 |
| prompt | string | 是 | 任务描述 |
| description | string | 否 | 简短描述（3-5词） |
| model | string | 否 | 模型选择 (sonnet/opus/haiku) |
| resume | string | 否 | 恢复的代理ID |
| run_in_background | boolean | 否 | 是否后台运行 |
| max_turns | number | 否 | 最大轮次 |
| allowed_tools | string[] | 否 | 允许的工具列表 |

#### TaskCreate 工具

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| subject | string | 是 | 任务标题（命令式） |
| description | string | 是 | 详细描述 |
| activeForm | string | 否 | 进行中显示文本 |
| metadata | object | 否 | 附加元数据 |

#### TaskUpdate 工具

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| taskId | string | 是 | 任务ID |
| status | string | 否 | 新状态 |
| subject | string | 否 | 新标题 |
| description | string | 否 | 新描述 |
| owner | string | 否 | 分配给谁 |
| addBlockedBy | string[] | 否 | 添加依赖 |
| addBlocks | string[] | 否 | 添加阻塞 |
| metadata | object | 否 | 更新元数据 |

### B. 状态转换图

```
                    ┌─────────────┐
                    │   pending   │
                    └──────┬──────┘
                           │ canStart && claim
                           ▼
                    ┌─────────────┐
            failure │ in_progress │ success
        ┌───────────┴──────┬──────┴───────────┐
        │                  │                  │
  ┌─────────────┐          │           ┌─────────────┐
  │   pending   │◀─────────┘           │  completed  │
  └─────────────┘  (rollback)          └─────────────┘
```

### C. 错误代码参考

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| E_TASK_NOT_FOUND | 任务不存在 | 检查任务ID是否正确 |
| E_CYCLE_DEPENDENCY | 循环依赖 | 重新设计依赖关系 |
| E_INVALID_STATUS | 无效状态转换 | 检查当前状态和目标状态 |
| E_TASK_BLOCKED | 任务被阻塞 | 先完成阻塞任务 |
| E_TASK_CLAIMED | 任务已被认领 | 等待释放或选择其他任务 |
| E_AGENT_TIMEOUT | 子代理超时 | 增加超时时间或简化任务 |
| E_AGENT_FAILED | 子代理执行失败 | 检查错误日志，重试 |

---

## 7. 新增问题与解决方案

### 7.1 问题7: 任务优先级管理

**问题描述**：
多个任务同时可执行时，需要根据优先级决定执行顺序：
- high优先级的任务应该比low优先级的任务先执行
- 紧急任务应该立即处理，不能被其他任务阻塞
- 紧急任务无法被取消，取消后需要通知所有依赖它的任务
- 低优先级任务可能在资源紧张时被跳过

**解决方案**：
```typescript
// 优先级排序函数（用于 TaskList）
function sortByPriority(tasks: Task[]): Task[] {
  const PRIORITY_WEIGHT = {
    [TaskPriority.CRITICAL]: 0,  // 最高优先级
    [TaskPriority.HIGH]: 1,
    [TaskPriority.NORMAL]: 2,
    [TaskPriority.LOW]: 3,
  };

  return tasks.sort((a, b) => {
    const aPriority = PRIORITY_WEIGHT[a.priority] || 999;
    const bPriority = PRIORITY_WEIGHT[b.priority] || 999;

    // 同优先级按创建时间排序（先创建的优先）
    if (aPriority === bPriority) {
      return a.createdAt - b.createdAt;
    }

    return aPriority - bPriority;
  });
}

// 紧急任务检查
function isCriticalTask(task: Task): boolean {
  return task.priority === TaskPriority.CRITICAL;
}

// 检查紧急任务是否可以被开始（忽略依赖）
function canStartCriticalTask(task: Task): { canStart: boolean; reason?: string } {
  if (task.priority !== TaskPriority.CRITICAL) {
    return { canStart: false, reason: '非紧急任务' };
  }

  // 紧急任务可以忽略非完成的依赖
  const incompleteBlockers = task.blockedBy.filter(blockerId => {
    const blocker = taskStore.tasks.get(blockerId);
    return blocker && blocker.status !== TaskStatus.COMPLETED;
  });

  if (incompleteBlockers.length > 0) {
    return {
      canStart: true,  // 允许开始，但需要警告
      reason: `警告: 有 ${incompleteBlockers.length} 个依赖未完成`,
    };
  }

  return { canStart: true };
}
```

### 7.2 问题8: 任务进度追踪

**问题描述**：
长时间运行的任务需要了解当前进度，便于：
- 向用户展示进度
- 决定是否需要继续等待
- 估算剩余时间

**解决方案**：
```typescript
// 更新任务进度
async function updateTaskProgress(
  taskId: string,
  progress: number,
  checkpointName?: string
): Promise<void> {
  const task = taskStore.tasks.get(taskId);
  if (!task) {
    throw new Error(`任务不存在: ${taskId}`);
  }

  if (progress < 0 || progress > 100) {
    throw new Error('进度值必须在 0-100 之间');
  }

  if (task.status !== TaskStatus.IN_PROGRESS) {
    throw new Error('只有进行中的任务才能更新进度');
  }

  task.progress = progress;
  task.updatedAt = Date.now();

  if (checkpointName) {
    const checkpoint = task.checkpoints.find(cp => cp.name === checkpointName);
    if (checkpoint) {
      checkpoint.completed = true;
      checkpoint.completedAt = Date.now();
    }
  }

  addHistoryEntry(taskId, {
    action: 'progress_updated',
    metadata: { progress, checkpointName },
  });
}
```

### 7.3 问题9: 自动重试机制

**问题描述**：
任务执行失败后，需要根据配置自动重试。

重试需要考虑：
- 重试次数限制
- 重试间隔（指数退避）
- 可重试的错误类型

**解决方案**：
```typescript
async function handleTaskFailure(taskId: string, error: Error): Promise<Task> {
  const task = taskStore.tasks.get(taskId);
  task.lastError = error.message;
  task.lastErrorAt = Date.now();

  const canRetry = shouldRetry(task, error);

  if (canRetry) {
    task.retryCount++;
    const delayMs = task.retryConfig.retryDelayMs *
      Math.pow(task.retryConfig.backoffMultiplier, task.retryCount - 1);

    setTimeout(() => {
      task.status = TaskStatus.PENDING;
      task.owner = null;
    }, delayMs);

    return task;
  }

  task.status = TaskStatus.FAILED;
  await notifyDependentTasks(taskId, 'dependency_failed');
  return task;
}
```

### 7.4 问题10: 子代理取消机制

**问题描述**：
后台运行的子代理需要能够被取消。

**解决方案**：
```typescript
async function cancelBackgroundAgent(agentId: string, reason: string): Promise<void> {
  taskStore.cancelledAgents.add(agentId);

  const task = findTaskByOwner(agentId);
  if (task) {
    await taskUpdate({
      taskId: task.id,
      status: TaskStatus.CANCELLED,
      reason: reason,
    });
  }

  await cleanupAgentResources(agentId);
}
```

### 7.5 问题11: 任务历史审计

**问题描述**：
需要追踪任务的所有变更历史。

**解决方案**：
```typescript
function generateAuditReport(taskId: string): AuditReport {
  const task = taskStore.tasks.get(taskId);
  const history = getTaskHistory(taskId);

  return {
    taskId,
    subject: task.subject,
    createdAt: task.createdAt,
    statusTimeline: history
      .filter(h => ['created', 'status_changed', 'cancelled'].includes(h.action))
      .map(h => ({
        timestamp: h.timestamp,
        action: h.action,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actor: h.actor,
        reason: h.reason,
      })),
    totalDuration: task.completedAt && task.startedAt
      ? task.completedAt - task.startedAt
      : null,
    retryCount: task.retryCount,
  };
}
```

### 7.6 问题12: 任务标签与分类

**问题描述**：
任务需要按模块、类型、团队等进行分类。

**解决方案**：
```typescript
function filterTasksByTags(tags: string[]): Task[] {
  const allTasks = Array.from(taskStore.tasks.values());
  return allTasks.filter(task =>
    tags.some(tag => task.tags.some(t => t.name === tag))
  );
}

function getAllTags(): { name: string; count: number; category?: string }[] {
  const tagMap = new Map<string, { count: number; category?: string }>();

  for (const task of taskStore.tasks.values()) {
    for (const tag of task.tags) {
      const existing = tagMap.get(tag.name) || { count: 0, category: tag.category };
      tagMap.set(tag.name, {
        count: existing.count + 1,
        category: tag.category || existing.category,
      });
    }
  }

  return Array.from(tagMap.entries()).map(([name, data]) => ({
    name,
    count: data.count,
    category: data.category,
  }));
}
```

### 7.7 问题13: 任务超时配置

**问题描述**：
不同类型的任务可能需要不同的超时配置。

**解决方案**：
```typescript
const AGENT_TIMEOUT_CONFIGS: Record<SubagentType, TaskTimeoutConfig> = {
  Bash: { defaultMs: 120000, maxMs: 600000, warnAt: 60000 },
  Explore: { defaultMs: 300000, maxMs: 1800000, warnAt: 120000 },
  Plan: { defaultMs: 600000, maxMs: 3600000, warnAt: 300000 },
  'general-purpose': { defaultMs: 600000, maxMs: 1800000, warnAt: 300000 },
  'research-agent': { defaultMs: 300000, maxMs: 900000, warnAt: 180000 },
};

function getTaskTimeout(task: Task, agentType: SubagentType): number {
  const agentConfig = AGENT_TIMEOUT_CONFIGS[agentType];
  const customTimeout = task.metadata?.timeoutMs || agentConfig.defaultMs;
  return Math.min(customTimeout, agentConfig.maxMs);
}
```

---

*文档版本: 2.0*
*最后更新: 2026年3月*
