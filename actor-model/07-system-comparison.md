# 系统对比与迁移路径

> 对比当前 Task 系统与 Actor 模型的差异，规划迁移路径。

## 一、架构对比

### 1.1 概念映射

| 当前系统 | Actor 模型 | 说明 |
|---------|-----------|------|
| `Task` 工具 | `actorOf()` | 创建子任务/Actor |
| `TaskOutput` | 消息回调 | 获取结果 |
| `run_in_background` | Actor 独立运行 | 异步执行 |
| 主 agent 循环 | Main Actor | 协调者 |
| 子任务 | 子 Actor | 工作单元 |
| 任务状态 | 监督树 | 生命周期管理 |

### 1.2 结果回流对比

**当前系统（轮询）**：
```typescript
// 派发任务
const taskId = await Task({
  description: "研究最佳实践",
  prompt: "...",
  run_in_background: true
});

// 需要主动轮询获取结果
const result = await TaskOutput({
  task_id: taskId,
  block: true
});

// 问题：如果忘记轮询，结果丢失
```

**Actor 模型（消息驱动）**：
```typescript
// 派发任务
const taskActor = this.actorOf(TaskActor, {
  name: `task-${taskId}`,
  spec: { type: 'research', ... }
});

// 结果通过消息自动到达
async receive(message: Message) {
  if (message.type === 'task_completed') {
    // 结果自动处理
    const { taskId, result } = message.payload;
    this.consumeResult(taskId, result);
  }
}

// 优势：不会忘记，消息机制保证送达
```

### 1.3 错误处理对比

**当前系统**：
```typescript
// 每个任务独立处理错误
try {
  const result = await TaskOutput({ task_id: taskId });
} catch (error) {
  // 手动处理
  if (shouldRetry) {
    await Task({ ... });  // 重新派发
  }
}

// 问题：错误处理逻辑分散，策略不统一
```

**Actor 模型（监督策略）**：
```typescript
// 集中定义策略
class MainAgentActor extends SupervisorActor {
  supervisionStrategy = {
    maxRetries: 3,
    decider: (error) => {
      if (error instanceof NetworkError) return SupervisionDirective.Restart;
      if (error instanceof FatalError) return SupervisionDirective.Stop;
      return SupervisionDirective.Escalate;
    }
  };
}

// 优势：策略集中，自动执行
```

### 1.4 交互请求对比

**当前系统**：
```typescript
// 后台任务难以请求交互
// 通常需要：
// 1. 任务暂停
// 2. 写入交互队列
// 3. 主 agent 轮询队列
// 4. 询问用户
// 5. 返回结果

// 非常复杂，容易出错
```

**Actor 模型**：
```typescript
// 任务 Actor 直接请求
const answer = await this.requestInteraction('请确认是否继续？');

// 主 Actor 自动代理
async handleInteractionRequest(from, payload) {
  const answer = await this.askUser(payload.question);
  from.tell('interaction_response', { answer });
}

// 简洁，自然
```

## 二、详细对比表

### 2.1 功能对比

| 功能 | 当前系统 | Actor 模型 | 优势方 |
|------|---------|-----------|-------|
| 任务派发 | ✓ | ✓ | 平局 |
| 结果获取 | 轮询 | 消息回调 | Actor |
| 后台任务 | ✓ | ✓ | 平局 |
| 错误隔离 | 部分 | 完整 | Actor |
| 错误恢复 | 手动 | 自动 | Actor |
| 交互请求 | 困难 | 自然 | Actor |
| 任务取消 | ✓ | ✓ | 平局 |
| 任务状态 | 查询 | 事件 | Actor |
| 分布式 | 需要额外实现 | 原生支持 | Actor |
| 可观测性 | 部分 | 完整 | Actor |

### 2.2 代码对比

**派发并等待任务**：

```typescript
// 当前系统
async function dispatchAndWait(spec: TaskSpec): Promise<any> {
  const taskId = await Task({
    description: spec.description,
    prompt: spec.prompt,
    run_in_background: false  // 同步等待
  });

  const result = await TaskOutput({
    task_id: taskId,
    block: true
  });

  return result;
}

// Actor 模型
async function dispatchAndWait(spec: TaskSpec): Promise<any> {
  const taskActor = this.actorOf(TaskActor, {
    name: `task-${generateId()}`,
    spec
  });

  // Ask 模式等待结果
  return await taskActor.ask('execute', { spec });
}
```

**并行派发多个任务**：

```typescript
// 当前系统
async function dispatchMultiple(specs: TaskSpec[]): Promise<any[]> {
  const taskIds = await Promise.all(
    specs.map(spec => Task({
      description: spec.description,
      prompt: spec.prompt,
      run_in_background: true
    }))
  );

  // 需要手动等待所有任务
  const results = await Promise.all(
    taskIds.map(id => TaskOutput({ task_id: id, block: true }))
  );

  return results;
}

// Actor 模型
class MainAgentActor extends Actor {
  private pendingResults: Map<string, any> = new Map();

  async dispatchMultiple(specs: TaskSpec[]): Promise<any[]> {
    for (const spec of specs) {
      const taskActor = this.actorOf(TaskActor, {
        name: `task-${generateId()}`,
        spec
      });

      taskActor.tell('start', { spec });
    }

    // 等待所有结果（通过消息自动到达）
    return new Promise(resolve => {
      const check = () => {
        if (this.pendingResults.size === specs.length) {
          resolve(Array.from(this.pendingResults.values()));
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  async receive(message: Message) {
    if (message.type === 'task_completed') {
      this.pendingResults.set(message.payload.taskId, message.payload.result);
    }
  }
}
```

## 三、迁移策略

### 3.1 渐进式迁移

**阶段1：包装器模式（最小改动）**

保持现有 API，内部使用 Actor 机制：

```typescript
// 兼容层
class TaskToolWrapper {
  private actorSystem: ActorSystem;
  private mainAgent: ActorRef;

  async call(params: TaskParams): Promise<string> {
    const taskId = generateId();

    // 内部使用 Actor
    const taskActor = this.mainAgent.actorOf(TaskActor, {
      name: `task-${taskId}`,
      spec: {
        type: params.subagent_type,
        description: params.description,
        prompt: params.prompt
      }
    });

    if (params.run_in_background) {
      taskActor.tell('start', { taskId, spec });
      return taskId;
    } else {
      const result = await taskActor.ask('execute', { taskId, spec });
      return result;
    }
  }

  async output(params: { task_id: string }): Promise<any> {
    // 查询 Actor 状态
    const taskPath = `/user/main-agent/task-${params.task_id}`;
    const taskActor = this.actorSystem.actorSelection(taskPath);

    if (!taskActor) {
      throw new Error('Task not found');
    }

    return await taskActor.ask('get_result', {});
  }
}
```

**阶段2：混合模式**

部分功能使用 Actor，保留现有 API：

```typescript
// 新功能使用 Actor
class NewFeatureActor extends Actor {
  async receive(message: Message) {
    // 新的实现
  }
}

// 现有功能保持不变
const taskId = await Task({ /* ... */ });
```

**阶段3：完全迁移**

所有功能使用 Actor 模型：

```typescript
// 完全 Actor 化
const system = new ActorSystem('coding-agent');
const mainAgent = system.actorOf(MainAgentActor, { name: 'main-agent' });

mainAgent.tell('user_input', '帮我完成这个任务');
```

### 3.2 迁移检查清单

**阶段1准备**：
- [ ] 创建 Actor 基类
- [ ] 创建 ActorSystem
- [ ] 实现 TaskActor
- [ ] 创建 TaskToolWrapper
- [ ] 编写单元测试

**阶段2过渡**：
- [ ] 新功能使用 Actor
- [ ] 保留现有 API
- [ ] 监控两种模式
- [ ] 收集反馈

**阶段3完成**：
- [ ] 所有功能迁移
- [ ] 移除兼容层
- [ ] 更新文档
- [ ] 性能测试

## 四、风险评估

### 4.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 学习曲线 | 中 | 提供培训、文档 |
| 兼容性问题 | 高 | 渐进式迁移、兼容层 |
| 性能问题 | 中 | 基准测试、优化 |
| Bug | 高 | 充分测试、灰度发布 |

### 4.2 业务风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 功能中断 | 高 | 兼容层、回滚计划 |
| 用户体验变化 | 中 | 保持 API 一致 |
| 延迟增加 | 低 | 性能测试 |

### 4.3 建议

1. **从小开始**：先在非核心功能试点
2. **保持兼容**：提供兼容层，不破坏现有代码
3. **充分测试**：单元测试、集成测试、性能测试
4. **灰度发布**：逐步替换，监控效果
5. **准备回滚**：确保可以快速回退

## 五、实施建议

### 5.1 团队准备

1. **培训**：确保团队理解 Actor 模型
2. **文档**：提供详细的设计文档和示例
3. **Code Review**：初期加强代码审查

### 5.2 技术准备

```typescript
// 建议的目录结构
src/
├── actor/
│   ├── Actor.ts           # Actor 基类
│   ├── ActorSystem.ts     # Actor 系统
│   ├── SupervisorActor.ts # 监督者
│   ├── types.ts           # 类型定义
│   └── __tests__/         # 测试
├── actors/
│   ├── MainAgentActor.ts  # 主 Agent
│   ├── TaskActor.ts       # 任务 Actor
│   └── __tests__/
└── tools/
    ├── TaskToolWrapper.ts # 兼容层
    └── __tests__/
```

### 5.3 监控和可观测性

```typescript
// 添加监控
class MonitoredMainAgentActor extends MainAgentActor {
  async receive(message: Message): Promise<void> {
    const startTime = Date.now();

    try {
      await super.receive(message);

      // 记录成功
      metrics.increment('actor.message.success');
    } catch (error) {
      // 记录失败
      metrics.increment('actor.message.error');
      throw error;
    } finally {
      // 记录延迟
      metrics.histogram('actor.message.duration', Date.now() - startTime);
    }
  }
}
```

## 六、总结

### 核心差异

| 方面 | 当前系统 | Actor 模型 |
|------|---------|-----------|
| **结果回流** | 轮询，可能丢失 | 消息，保证送达 |
| **错误处理** | 分散，手动 | 集中，自动 |
| **交互请求** | 困难 | 自然 |
| **扩展性** | 有限 | 分布式原生 |

### 迁移建议

1. **渐进式迁移**：不要一次性替换
2. **保持兼容**：提供兼容层
3. **充分测试**：确保功能正确
4. **监控效果**：关注性能和用户体验

### 预期收益

- **可靠性提升**：消息机制保证结果回流
- **可维护性提升**：监督策略集中管理错误
- **扩展性提升**：为分布式打下基础
- **开发效率提升**：清晰的模型，减少样板代码

### 下一步

1. 评估团队资源和时间
2. 选择试点功能
3. 创建 Actor 基础设施
4. 编写迁移计划
5. 开始实施
