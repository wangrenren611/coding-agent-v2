# Actor 架构设计

> 如何使用 Actor 模型设计多 Agent 系统的架构，包括核心 Actor 类型、层级结构和通信模式。

## 一、整体架构

### 1.1 Actor System 层级结构

```
┌─────────────────────────────────────────────────────┐
│                Actor System                         │
│  ┌───────────────────────────────────────────────┐  │
│  │              Guardian (根监督者)               │  │
│  │                    │                           │  │
│  │         ┌─────────┼─────────┐                │  │
│  │         ▼         ▼         ▼                │  │
│  │   ┌─────────┐ ┌─────────┐ ┌─────────┐       │  │
│  │   │ /user   │ │ /system │ │ /tasks  │       │  │
│  │   │(用户Actor)│ │(系统Actor)│ │(任务Actor)│       │  │
│  │   └────┬────┘ └─────────┘ └────┬────┘       │  │
│  │        │                         │            │  │
│  │   ┌────▼────┐               ┌────▼────┐      │  │
│  │   │ Main    │               │ Task-1  │      │  │
│  │   │ Agent   │               │         │      │  │
│  │   └────┬────┘               │ Task-2  │      │  │
│  │        │                    │         │      │  │
│  │   ┌────▼────┐               │ Task-N  │      │  │
│  │   │Sub-Agent│               └─────────┘      │  │
│  │   └─────────┘                                │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │         Message Router (消息路由)              │  │
│  │  - 本地路由                                    │  │
│  │  - 远程路由                                    │  │
│  │  - 负载均衡                                    │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 1.2 核心组件

| 组件 | 职责 |
|------|------|
| **Guardian** | 根监督者，管理所有顶层 Actor |
| **/user** | 用户创建的 Actor 存放位置 |
| **/system** | 系统 Actor（日志、配置等） |
| **/tasks** | 任务 Actor 池 |
| **Message Router** | 消息路由和分发 |

## 二、核心 Actor 类型

### 2.1 Main Agent Actor

主 Agent 是整个系统的协调者。

```typescript
class MainAgentActor extends Actor {
  // 状态：当前推理上下文
  private context: AgentContext;
  private childActors: Map<string, ActorRef> = new Map();

  // 邮箱：接收消息
  private mailbox: Message[] = [];

  // 行为：消息处理
  async receive(message: Message): Promise<void> {
    switch (message.type) {
      case 'user_input':
        await this.handleUserInput(message.payload);
        break;

      case 'task_result':
        await this.handleTaskResult(message.from, message.payload);
        break;

      case 'task_failed':
        await this.handleTaskFailure(message.from, message.payload);
        break;

      case 'interaction_request':
        await this.handleInteractionRequest(message.from, message.payload);
        break;
    }
  }

  // 派发子任务
  private async dispatchTask(spec: TaskSpec): Promise<string> {
    const taskId = generateId();

    // 创建子 Actor
    const childActor = this.context.actorOf(TaskActor, {
      name: `task-${taskId}`,
      props: { taskId, spec }
    });

    // 监督：如果子 Actor 失败，我会收到消息
    this.childActors.set(taskId, childActor);

    // 发送任务开始消息
    childActor.tell('start', { taskId, spec });

    return taskId;
  }

  // 处理任务结果
  private async handleTaskResult(from: string, result: any): Promise<void> {
    const taskId = this.extractTaskId(from);

    // 将结果合并到上下文
    this.context.addTaskResult(taskId, result);

    // 继续推理
    await this.continueReasoning();
  }
}
```

### 2.2 Task Actor (Worker)

Task Actor 是执行具体任务的工作单元。

```typescript
class TaskActor extends Actor {
  private taskId: string;
  private spec: TaskSpec;
  private state: 'idle' | 'running' | 'completed' | 'failed' = 'idle';

  async receive(message: Message): Promise<void> {
    switch (message.type) {
      case 'start':
        await this.execute();
        break;

      case 'cancel':
        await this.cancel();
        break;

      case 'get_status':
        this.reply(message, { state: this.state });
        break;
    }
  }

  private async execute(): Promise<void> {
    this.state = 'running';

    try {
      // 执行任务逻辑
      const result = await this.doWork();

      // 发送结果给父 Actor
      this.state = 'completed';
      this.context.parent.tell('task_result', {
        taskId: this.taskId,
        result
      });

    } catch (error) {
      // 失败时通知父 Actor
      this.state = 'failed';
      this.context.parent.tell('task_failed', {
        taskId: this.taskId,
        error: error.message
      });

      // 触发监督策略
      throw error;
    }
  }

  // 需要用户交互时
  private async requestInteraction(question: string): Promise<string> {
    // 发送请求给父 Actor
    const response = await this.context.parent.ask('interaction_request', {
      taskId: this.taskId,
      question
    });

    return response.answer;
  }
}
```

### 2.3 Supervisor Actor

Supervisor 负责监督子 Actor 的生命周期和错误处理。

```typescript
class SupervisorActor extends Actor {
  private children: Map<string, ActorRef> = new Map();

  // 监督策略
  private strategy: SupervisionStrategy = {
    // 子 Actor 失败时的处理
    onFailure: (child, error) => {
      switch (this.decideStrategy(error)) {
        case 'restart':
          return this.restartChild(child);
        case 'stop':
          return this.stopChild(child);
        case 'escalate':
          throw error;
        case 'resume':
          return;
      }
    }
  };

  // 创建子 Actor 时自动注册监督
  actorOf(actorClass: any, props: any): ActorRef {
    const child = new actorClass({
      ...props,
      parent: this.context.self,
      supervisor: this.context.self
    });

    this.children.set(child.id, child);
    return child;
  }

  // 处理子 Actor 失败
  async receive(message: Message): Promise<void> {
    if (message.type === 'child_failed') {
      const { child, error } = message.payload;
      await this.strategy.onFailure(child, error);
    }
  }
}
```

### 2.4 Coordinator Actor (可选)

对于复杂系统，可以引入独立的协调器。

```typescript
class TaskCoordinatorActor extends Actor {
  private tasks: Map<string, TaskContext> = new Map();
  private mainAgent: ActorRef | null = null;

  // 主 Agent 注册
  async receive(message: Message): Promise<void> {
    switch (message.type) {
      case 'register_main':
        this.mainAgent = message.from;
        break;

      case 'dispatch':
        await this.dispatchTask(message.payload);
        break;

      case 'task_completed':
        await this.forwardToMain(message);
        break;

      case 'get_status':
        const status = this.getAllTaskStatus();
        this.reply(message, status);
        break;
    }
  }

  private async dispatchTask(spec: TaskSpec): Promise<void> {
    const taskId = generateId();

    // 创建任务 Actor
    const taskActor = this.actorOf(TaskActor, {
      name: `task-${taskId}`,
      taskId,
      spec
    });

    // 记录状态
    this.tasks.set(taskId, {
      actor: taskActor,
      status: 'running',
      startedAt: Date.now()
    });

    // 启动任务
    taskActor.tell('start', { taskId, spec });
  }
}
```

## 三、Actor 层级设计模式

### 3.1 扇出/扇入模式 (Fan-out/Fan-in)

```typescript
// 主 Actor 并行派发多个任务，然后等待所有结果
class FanOutPattern {
  async dispatchParallel(tasks: TaskSpec[]): Promise<Result[]> {
    const taskIds = await Promise.all(
      tasks.map(spec => this.dispatchTask(spec))
    );

    // 等待所有任务完成
    return await this.waitForAll(taskIds);
  }

  private async waitForAll(taskIds: string[]): Promise<Result[]> {
    const results: Result[] = [];

    for (const taskId of taskIds) {
      const result = await this.waitForTask(taskId);
      results.push(result);
    }

    return results;
  }
}
```

### 3.2 管道模式 (Pipeline)

```typescript
// 任务按顺序执行，每个任务的输出是下一个任务的输入
class PipelinePattern {
  async executePipeline(stages: Stage[]): Promise<Result> {
    let currentInput: any = null;

    for (const stage of stages) {
      // 创建阶段 Actor
      const stageActor = this.actorOf(StageActor, {
        name: `stage-${stage.name}`
      });

      // 执行并等待结果
      const result = await stageActor.ask('execute', {
        stage,
        input: currentInput
      });

      currentInput = result.output;
    }

    return currentInput;
  }
}
```

### 3.3 聚合器模式 (Aggregator)

```typescript
// 多个任务的结果聚合后统一处理
class AggregatorPattern {
  private pendingResults: Map<string, Result[]> = new Map();
  private expectedCounts: Map<string, number> = new Map();

  async dispatchWithAggregation(
    tasks: TaskSpec[],
    aggregationId: string
  ): Promise<AggregatedResult> {
    this.expectedCounts.set(aggregationId, tasks.length);
    this.pendingResults.set(aggregationId, []);

    // 派发所有任务
    for (const task of tasks) {
      const taskActor = this.actorOf(AggregatingTaskActor, {
        name: `agg-task-${generateId()}`,
        aggregationId
      });

      taskActor.tell('start', { task, aggregationId });
    }

    // 等待聚合完成
    return await this.waitForAggregation(aggregationId);
  }

  async handlePartialResult(message: Message): Promise<void> {
    const { aggregationId, result } = message.payload;

    const results = this.pendingResults.get(aggregationId)!;
    results.push(result);

    // 检查是否全部完成
    if (results.length === this.expectedCounts.get(aggregationId)) {
      // 触发聚合处理
      const aggregated = this.aggregate(results);
      this.notifyComplete(aggregationId, aggregated);
    }
  }
}
```

## 四、通信模式设计

### 4.1 请求-响应模式

```typescript
// 主 Actor 发送请求并等待响应
const response = await taskActor.ask('get_status', { taskId }, {
  timeout: 5000
});
```

### 4.2 发布-订阅模式

```typescript
class EventStreamActor extends Actor {
  private subscribers: Map<string, Set<ActorRef>> = new Map();

  async receive(message: Message): Promise<void> {
    switch (message.type) {
      case 'subscribe':
        this.subscribe(message.payload.event, message.from);
        break;

      case 'unsubscribe':
        this.unsubscribe(message.payload.event, message.from);
        break;

      case 'publish':
        this.publish(message.payload.event, message.payload.data);
        break;
    }
  }

  private subscribe(event: string, actor: ActorRef): void {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }
    this.subscribers.get(event)!.add(actor);
  }

  private publish(event: string, data: any): void {
    const subscribers = this.subscribers.get(event);
    if (subscribers) {
      for (const actor of subscribers) {
        actor.tell(event, data);
      }
    }
  }
}
```

### 4.3 路由模式

```typescript
class RouterActor extends Actor {
  private routes: Map<string, ActorRef> = new Map();

  registerRoute(pattern: string, target: ActorRef): void {
    this.routes.set(pattern, target);
  }

  async receive(message: Message): Promise<void> {
    // 根据 pattern 路由
    for (const [pattern, target] of this.routes) {
      if (this.matchPattern(pattern, message.type)) {
        target.tell(message.type, message.payload);
        return;
      }
    }

    // 未找到路由，发送到死信队列
    this.deadLetters.tell('unroutable', message);
  }
}
```

## 五、状态管理策略

### 5.1 有状态 Actor

```typescript
class StatefulActor extends Actor {
  private state: ApplicationState;

  async receive(message: Message): Promise<void> {
    // 处理消息，可能修改状态
    const newState = await this.processWithState(message, this.state);

    // 原子性更新状态
    this.state = newState;
  }

  // 持久化状态（可选）
  private async persistState(): Promise<void> {
    await this.stateStore.save(this.path, this.state);
  }

  // 恢复状态（启动时）
  private async restoreState(): Promise<void> {
    this.state = await this.stateStore.load(this.path);
  }
}
```

### 5.2 状态机 Actor

```typescript
class StateMachineActor extends Actor {
  private currentState: State;
  private transitions: TransitionTable;

  async receive(message: Message): Promise<void> {
    // 查找转换
    const transition = this.transitions.find(
      this.currentState,
      message.type
    );

    if (transition) {
      // 执行动作
      await transition.action(message.payload);

      // 状态转换
      this.currentState = transition.targetState;
    } else {
      // 无效转换
      this.handleInvalidTransition(message);
    }
  }
}

// 定义状态机
const taskStateMachine = {
  initial: 'idle',
  states: {
    'idle': {
      on: { 'start': 'running' }
    },
    'running': {
      on: {
        'complete': 'completed',
        'fail': 'failed',
        'cancel': 'cancelled'
      }
    },
    'completed': { final: true },
    'failed': { final: true },
    'cancelled': { final: true }
  }
};
```

## 六、配置与初始化

### 6.1 Actor System 配置

```typescript
interface ActorSystemConfig {
  name: string;

  // 邮箱配置
  mailbox: {
    defaultSize: number;
    overflowStrategy: 'drop' | 'block' | 'expand';
  };

  // 调度器配置
  dispatcher: {
    type: 'default' | 'pinned' | 'fork-join';
    throughput: number;
  };

  // 监督配置
  supervision: {
    strategy: 'one-for-one' | 'all-for-one';
    maxRetries: number;
    withinTimeRange: number;
  };

  // 远程配置（可选）
  remote?: {
    enabled: boolean;
    host: string;
    port: number;
  };
}

const config: ActorSystemConfig = {
  name: 'coding-agent-system',
  mailbox: {
    defaultSize: 1000,
    overflowStrategy: 'drop'
  },
  dispatcher: {
    type: 'fork-join',
    throughput: 100
  },
  supervision: {
    strategy: 'one-for-one',
    maxRetries: 3,
    withinTimeRange: 60000
  }
};
```

### 6.2 初始化流程

```typescript
async function initializeSystem(): Promise<ActorSystem> {
  // 1. 创建 Actor System
  const system = new ActorSystem(config);

  // 2. 创建系统 Actor
  const eventStream = system.actorOf(EventStreamActor, {
    name: 'event-stream'
  });

  const deadLetters = system.actorOf(DeadLetterActor, {
    name: 'dead-letters'
  });

  // 3. 创建主 Agent
  const mainAgent = system.actorOf(MainAgentActor, {
    name: 'main-agent',
    eventStream,
    deadLetters
  });

  // 4. 注册关闭钩子
  process.on('SIGTERM', async () => {
    await gracefulShutdown(system, mainAgent);
  });

  return system;
}

async function gracefulShutdown(
  system: ActorSystem,
  mainAgent: ActorRef
): Promise<void> {
  console.log('开始优雅关闭...');

  // 1. 通知主 Agent 关闭
  await mainAgent.ask('prepare_shutdown', {}, { timeout: 30000 });

  // 2. 停止所有 Actor
  await system.terminate();

  console.log('关闭完成');
}
```

## 七、监控与可观测性

### 7.1 内置监控 Actor

```typescript
class MonitoringActor extends Actor {
  private metrics: Map<string, Metric> = new Map();

  async receive(message: Message): Promise<void> {
    switch (message.type) {
      case 'record_metric':
        this.recordMetric(message.payload);
        break;

      case 'get_metrics':
        this.reply(message, this.getAllMetrics());
        break;

      case 'actor_started':
      case 'actor_stopped':
      case 'actor_failed':
        this.recordLifecycleEvent(message);
        break;
    }
  }

  private recordMetric(metric: Metric): void {
    const key = `${metric.actorPath}.${metric.name}`;

    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        name: metric.name,
        values: [],
        sum: 0,
        count: 0
      });
    }

    const m = this.metrics.get(key)!;
    m.values.push(metric.value);
    m.sum += metric.value;
    m.count++;
  }
}
```

### 7.2 集成到 Actor 基类

```typescript
abstract class MonitoredActor extends Actor {
  private monitoringActor: ActorRef;

  async receive(message: Message): Promise<void> {
    const startTime = Date.now();

    try {
      await this.handleMessage(message);

      // 记录成功
      this.monitoringActor.tell('record_metric', {
        actorPath: this.path,
        name: 'message_processed',
        value: 1
      });

    } catch (error) {
      // 记录失败
      this.monitoringActor.tell('actor_failed', {
        actorPath: this.path,
        error
      });

      throw error;
    } finally {
      // 记录处理时间
      const duration = Date.now() - startTime;
      this.monitoringActor.tell('record_metric', {
        actorPath: this.path,
        name: 'processing_time_ms',
        value: duration
      });
    }
  }

  abstract handleMessage(message: Message): Promise<void>;
}
```

## 八、总结

### 关键设计原则

1. **单一职责**：每个 Actor 只做一件事
2. **明确边界**：通过消息定义接口
3. **层级监督**：父子 Actor 形成监督树
4. **异步优先**：避免阻塞操作
5. **状态隔离**：Actor 状态完全私有

### 下一步

- 阅读 [消息传递机制](./03-actor-messaging.md) 了解通信细节
- 阅读 [监督策略](./04-actor-supervision.md) 了解错误处理
- 阅读 [完整实现](./06-actor-implementation.md) 查看代码实现
