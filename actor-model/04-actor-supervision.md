# Actor 监督策略

> 深入理解 Actor 模型的错误处理和容错机制，掌握监督策略的设计。

## 一、监督树

### 1.1 什么是监督树

监督树是 Actor 模型中处理错误的核心机制。每个 Actor 可以创建子 Actor，形成层级结构，父 Actor 负责监督子 Actor 的生命周期和错误处理。

```
                Guardian
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
    MainAgent    System      Monitor
        │
    ┌───┼────┐
    ▼   ▼    ▼
 Task1 Task2 Task3
    │        │
    ▼        ▼
 Task1.1  Task3.1
```

### 1.2 监督原则

1. **父 Actor 监督子 Actor**：错误向上传播，直到被处理
2. **子 Actor 失败不影响父 Actor**：除非明确指定
3. **隔离故障**：一个 Actor 失败不会导致系统崩溃

### 1.3 与传统错误处理的对比

```
┌──────────────────────────────────────────────┐
│            传统错误处理                       │
├──────────────────────────────────────────────┤
│                                              │
│  try {                                       │
│    // 执行操作                               │
│  } catch (error) {                           │
│    // 错误处理                               │
│  }                                           │
│                                              │
│  问题：                                      │
│  - 错误处理逻辑分散                          │
│  - 难以统一策略                              │
│  - 状态可能不一致                            │
│                                              │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│            Actor 监督模型                     │
├──────────────────────────────────────────────┤
│                                              │
│  Actor 执行 → 失败 → 通知监督者              │
│                       ↓                      │
│              监督者决定策略                   │
│                       ↓                      │
│        ┌──────────┬──────────┐              │
│        │          │          │              │
│     Restart    Stop      Resume             │
│                                              │
│  优势：                                      │
│  - 错误处理集中                              │
│  - 策略统一                                  │
│  - 状态自动恢复                              │
│                                              │
└──────────────────────────────────────────────┘
```

## 二、监督策略类型

### 2.1 四种基本策略

```typescript
enum SupervisionDirective {
  Resume,    // 继续处理下一条消息（忽略错误）
  Restart,   // 重启 Actor（重置状态）
  Stop,      // 停止 Actor
  Escalate   // 上报给上级监督者
}
```

### 2.2 Resume（继续）

**含义**：忽略错误，继续处理下一条消息。

**适用场景**：
- 临时性、非致命错误
- Actor 状态仍然有效
- 不需要恢复

```typescript
class ResumeStrategy {
  // 示例：日志记录失败不应影响正常处理
  async receive(message: Message): Promise<void> {
    if (message.type === 'log') {
      try {
        await this.writeLog(message.payload);
      } catch (error) {
        // 日志写入失败，忽略
        console.warn('Log failed:', error);
        // 不重新抛出，继续处理
      }
    }
  }
}
```

### 2.3 Restart（重启）

**含义**：销毁当前 Actor 实例，创建新实例，状态重置。

**适用场景**：
- 状态可能损坏
- 需要重新初始化
- 临时资源问题

```typescript
class RestartStrategy {
  // 重启策略配置
  private strategy = {
    maxRetries: 3,
    withinTimeRange: 60000,  // 1分钟内最多重启3次

    onRestart: async (oldActor: Actor, newActor: Actor) => {
      // 可选：保存/恢复关键状态
      const criticalState = await oldActor.extractCriticalState();
      await newActor.restoreCriticalState(criticalState);
    }
  };
}
```

### 2.4 Stop（停止）

**含义**：永久停止 Actor，不重启。

**适用场景**：
- 致命错误，无法恢复
- Actor 不再需要
- 资源需要释放

```typescript
class StopStrategy {
  // 示例：检测到致命错误时停止
  private strategy = {
    decider: (error: Error): SupervisionDirective => {
      if (error instanceof CorruptedDataError) {
        return SupervisionDirective.Stop;
      }
      // ...
    }
  };
}
```

### 2.5 Escalate（上报）

**含义**：将错误上报给上级监督者，由上级决定。

**适用场景**：
- 当前层级无法处理
- 需要更高级别的决策
- 多层级错误传播

```typescript
class EscalateStrategy {
  // 示例：子 Actor 无法决定时上报
  private strategy = {
    decider: (error: Error): SupervisionDirective => {
      if (error instanceof UnknownError) {
        return SupervisionDirective.Escalate;
      }
      // ...
    }
  };
}
```

## 三、策略组合

### 3.1 基于错误类型的决策

```typescript
interface SupervisionStrategy {
  decider: (error: Error) => SupervisionDirective;
  maxRetries?: number;
  withinTimeRange?: number;
}

class MainAgentActor extends SupervisorActor {
  protected supervisionStrategy: SupervisionStrategy = {
    // 根据错误类型决定策略
    decider: (error: Error): SupervisionDirective => {
      // 网络错误 → 重启
      if (error instanceof NetworkError) {
        return SupervisionDirective.Restart;
      }

      // 验证错误 → 继续
      if (error instanceof ValidationError) {
        return SupervisionDirective.Resume;
      }

      // 数据损坏 → 停止
      if (error instanceof CorruptedDataError) {
        return SupervisionDirective.Stop;
      }

      // 未知错误 → 上报
      return SupervisionDirective.Escalate;
    },

    // 重启限制
    maxRetries: 3,
    withinTimeRange: 60000
  };
}
```

### 3.2 自定义错误类型

```typescript
// 定义业务相关的错误类型
class TaskError extends Error {
  constructor(
    message: string,
    public readonly taskId: string,
    public readonly recoverable: boolean = true
  ) {
    super(message);
    this.name = 'TaskError';
  }
}

class ResourceExhaustedError extends Error {
  constructor(
    public readonly resourceType: string,
    public readonly currentUsage: number,
    public readonly limit: number
  ) {
    super(`Resource exhausted: ${resourceType}`);
    this.name = 'ResourceExhaustedError';
  }
}

class TimeoutError extends Error {
  constructor(
    public readonly operation: string,
    public readonly timeoutMs: number
  ) {
    super(`Operation timed out: ${operation}`);
    this.name = 'TimeoutError';
  }
}

// 使用
const strategy = {
  decider: (error: Error): SupervisionDirective => {
    if (error instanceof TaskError) {
      return error.recoverable
        ? SupervisionDirective.Restart
        : SupervisionDirective.Stop;
    }

    if (error instanceof ResourceExhaustedError) {
      return SupervisionDirective.Resume;  // 等待资源释放
    }

    if (error instanceof TimeoutError) {
      return SupervisionDirective.Restart;
    }

    return SupervisionDirective.Escalate;
  }
};
```

## 四、两种监督模式

### 4.1 One-For-One

**含义**：只重启失败的 Actor，不影响兄弟 Actor。

```
      Supervisor
          │
    ┌─────┼─────┐
    ▼     ▼     ▼
 Actor1 Actor2 Actor3
           ❌

只重启 Actor2，Actor1 和 Actor3 不受影响
```

**适用场景**：
- Actor 相互独立
- 一个失败不影响其他

```typescript
const oneForOneStrategy = {
  type: 'one-for-one',
  maxRetries: 3,
  withinTimeRange: 60000,
  decider: defaultDecider
};
```

### 4.2 All-For-One

**含义**：一个 Actor 失败，重启所有兄弟 Actor。

```
      Supervisor
          │
    ┌─────┼─────┐
    ▼     ▼     ▼
 Actor1 Actor2 Actor3
           ❌

重启 Actor1、Actor2、Actor3（全部）
```

**适用场景**：
- Actor 之间有强依赖
- 需要保持一致性

```typescript
const allForOneStrategy = {
  type: 'all-for-one',
  maxRetries: 3,
  withinTimeRange: 60000,
  decider: defaultDecider
};
```

### 4.3 选择指南

| 场景 | 推荐模式 |
|------|---------|
| 任务执行器池 | One-For-One |
| 流水线处理 | All-For-One |
| 独立工作者 | One-For-One |
| 状态同步组 | All-For-One |
| 混合场景 | 根据子树选择 |

## 五、完整监督实现

### 5.1 Supervisor Actor 基类

```typescript
interface ChildContext {
  actor: Actor;
  restartCount: number;
  lastRestartTime: number;
}

abstract class SupervisorActor extends Actor {
  protected children: Map<string, ChildContext> = new Map();
  protected abstract supervisionStrategy: SupervisionStrategy;

  // 创建子 Actor
  protected actorOf<T extends Actor>(
    actorClass: new (props: any) => T,
    props: { name: string } & any
  ): ActorRef {
    const actor = new actorClass({
      ...props,
      parent: this.context.self,
      supervisor: this.context.self
    });

    const childPath = `${this.path}/${props.name}`;
    actor.path = childPath;

    this.children.set(childPath, {
      actor,
      restartCount: 0,
      lastRestartTime: 0
    });

    actor.start();
    return actor;
  }

  // 接收子 Actor 失败通知
  async receive(message: Message): Promise<void> {
    if (message.type === 'child_failed') {
      await this.handleChildFailure(
        message.payload.child,
        message.payload.error,
        message.payload.message
      );
    }
  }

  // 处理子 Actor 失败
  private async handleChildFailure(
    child: Actor,
    error: Error,
    failedMessage: Message
  ): Promise<void> {
    const childPath = child.path;
    const childContext = this.children.get(childPath);

    if (!childContext) {
      console.warn(`Unknown child failed: ${childPath}`);
      return;
    }

    // 决定策略
    const directive = this.supervisionStrategy.decider(error);

    console.log(`Child ${childPath} failed with ${error.name}, directive: ${directive}`);

    switch (directive) {
      case SupervisionDirective.Resume:
        await this.resumeChild(child, failedMessage);
        break;

      case SupervisionDirective.Restart:
        await this.restartChild(childPath, error);
        break;

      case SupervisionDirective.Stop:
        await this.stopChild(childPath);
        break;

      case SupervisionDirective.Escalate:
        await this.escalate(child, error);
        break;
    }
  }

  // Resume：继续处理下一条消息
  private async resumeChild(child: Actor, failedMessage: Message): Promise<void> {
    // 不做任何操作，Actor 继续处理邮箱中的下一条消息
    console.log(`Resuming child ${child.path}`);
  }

  // Restart：重启 Actor
  private async restartChild(childPath: string, error: Error): Promise<void> {
    const childContext = this.children.get(childPath)!;

    // 检查重启限制
    const now = Date.now();
    const timeRange = this.supervisionStrategy.withinTimeRange || 60000;
    const maxRetries = this.supervisionStrategy.maxRetries || 3;

    // 计算时间范围内的重启次数
    if (now - childContext.lastRestartTime < timeRange) {
      if (childContext.restartCount >= maxRetries) {
        console.error(`Child ${childPath} exceeded max retries (${maxRetries})`);
        await this.stopChild(childPath);
        return;
      }
      childContext.restartCount++;
    } else {
      // 重置计数
      childContext.restartCount = 1;
    }

    childContext.lastRestartTime = now;

    // 停止旧 Actor
    const oldActor = childContext.actor;
    await oldActor.preRestart(error);
    oldActor.stop();

    // 创建新 Actor
    const ActorClass = oldActor.constructor as any;
    const newActor = new ActorClass({
      ...oldActor.props,
      parent: this.context.self,
      supervisor: this.context.self
    });
    newActor.path = childPath;

    await newActor.postRestart(error);
    newActor.start();

    // 更新上下文
    childContext.actor = newActor;

    console.log(`Restarted child ${childPath} (attempt ${childContext.restartCount})`);
  }

  // Stop：停止 Actor
  private async stopChild(childPath: string): Promise<void> {
    const childContext = this.children.get(childPath);
    if (!childContext) return;

    await childContext.actor.preStop();
    childContext.actor.stop();
    this.children.delete(childPath);

    console.log(`Stopped child ${childPath}`);
  }

  // Escalate：上报
  private async escalate(child: Actor, error: Error): Promise<void> {
    if (this.context.parent) {
      this.context.parent.tell('child_failed', {
        child,
        error,
        message: null
      });
    } else {
      // 已经是顶层，无法上报，记录并停止
      console.error(`Top-level escalation for ${child.path}:`, error);
      await this.stopChild(child.path);
    }
  }
}
```

### 5.2 Actor 生命周期钩子

```typescript
abstract class Actor {
  // 生命周期钩子（可被子类覆盖）

  // 启动前
  async preStart(): Promise<void> {
    // 初始化资源
  }

  // 启动后
  async postStart(): Promise<void> {
    // 启动完成后的操作
  }

  // 重启前
  async preRestart(reason: Error): Promise<void> {
    // 保存状态
    // 释放资源
  }

  // 重启后
  async postRestart(reason: Error): Promise<void> {
    // 恢复状态
    // 重新初始化
  }

  // 停止前
  async preStop(): Promise<void> {
    // 清理资源
    // 保存状态
  }
}
```

### 5.3 使用示例

```typescript
class TaskSupervisorActor extends SupervisorActor {
  protected supervisionStrategy: SupervisionStrategy = {
    type: 'one-for-one',
    maxRetries: 3,
    withinTimeRange: 60000,

    decider: (error: Error): SupervisionDirective => {
      if (error instanceof NetworkError) {
        return SupervisionDirective.Restart;
      }
      if (error instanceof ValidationError) {
        return SupervisionDirective.Resume;
      }
      if (error instanceof FatalError) {
        return SupervisionDirective.Stop;
      }
      return SupervisionDirective.Escalate;
    }
  };

  async dispatchTask(spec: TaskSpec): Promise<string> {
    const taskId = generateId();

    const taskActor = this.actorOf(TaskActor, {
      name: `task-${taskId}`,
      taskId,
      spec
    });

    taskActor.tell('start', { taskId, spec });
    return taskId;
  }
}

class TaskActor extends Actor {
  private taskId: string;
  private spec: TaskSpec;

  async receive(message: Message): Promise<void> {
    if (message.type === 'start') {
      await this.execute();
    }
  }

  private async execute(): Promise<void> {
    try {
      const result = await this.doWork();
      this.context.parent.tell('task_completed', {
        taskId: this.taskId,
        result
      });
    } catch (error) {
      // 通知监督者
      this.context.parent.tell('child_failed', {
        child: this,
        error,
        message: null
      });
      throw error;
    }
  }
}
```

## 六、熔断器模式

### 6.1 什么是熔断器

熔断器是一种防止级联失败的机制，当错误率超过阈值时，快速失败而不是继续尝试。

```
状态机：
  Closed ──(错误率>阈值)──▶ Open
    ▲                         │
    │                         │
    └──(半开后成功)─── Half-Open ◀──(超时)──┘
```

### 6.2 实现

```typescript
enum CircuitState {
  Closed,     // 正常
  Open,       // 熔断
  HalfOpen    // 半开（尝试恢复）
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.Closed;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly successThreshold: number = 3,
    private readonly timeout: number = 30000
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.Open) {
      if (Date.now() - this.lastFailureTime < this.timeout) {
        throw new Error('Circuit breaker is open');
      }
      this.state = CircuitState.HalfOpen;
    }

    try {
      const result = await operation();

      if (this.state === CircuitState.HalfOpen) {
        this.successCount++;
        if (this.successCount >= this.successThreshold) {
          this.reset();
        }
      }

      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.state === CircuitState.HalfOpen) {
        this.state = CircuitState.Open;
      } else if (this.failureCount >= this.failureThreshold) {
        this.state = CircuitState.Open;
      }

      throw error;
    }
  }

  private reset(): void {
    this.state = CircuitState.Closed;
    this.failureCount = 0;
    this.successCount = 0;
  }
}
```

### 6.3 与监督策略结合

```typescript
class TaskActorWithCircuitBreaker extends Actor {
  private circuitBreaker = new CircuitBreaker(5, 3, 30000);

  async receive(message: Message): Promise<void> {
    try {
      const result = await this.circuitBreaker.execute(async () => {
        return await this.processMessage(message);
      });

      this.reply(message, result);
    } catch (error) {
      if (error.message === 'Circuit breaker is open') {
        // 熔断状态，快速失败
        this.reply(message, { error: 'Service unavailable' });
      } else {
        throw error;
      }
    }
  }
}
```

## 七、最佳实践

### 7.1 策略选择指南

```typescript
// 任务执行器：One-For-One，允许重启
const taskExecutorStrategy = {
  type: 'one-for-one',
  maxRetries: 3,
  withinTimeRange: 60000,
  decider: (error) => {
    if (error instanceof TemporaryError) return SupervisionDirective.Restart;
    if (error instanceof PermanentError) return SupervisionDirective.Stop;
    return SupervisionDirective.Escalate;
  }
};

// 流水线：All-For-One，保持一致性
const pipelineStrategy = {
  type: 'all-for-one',
  maxRetries: 3,
  withinTimeRange: 60000,
  decider: (error) => {
    // 任何错误都重启整个流水线
    return SupervisionDirective.Restart;
  }
};

// 关键服务：严格限制
const criticalServiceStrategy = {
  type: 'one-for-one',
  maxRetries: 1,
  withinTimeRange: 300000,  // 5分钟
  decider: (error) => {
    // 大多数情况停止，人工介入
    return SupervisionDirective.Stop;
  }
};
```

### 7.2 监控和告警

```typescript
class MonitoredSupervisor extends SupervisorActor {
  private monitoringService: ActorRef;

  private async handleChildFailure(
    child: Actor,
    error: Error,
    failedMessage: Message
  ): Promise<void> {
    // 记录失败
    this.monitoringService.tell('child_failure', {
      supervisor: this.path,
      child: child.path,
      error: {
        type: error.name,
        message: error.message,
        stack: error.stack
      },
      timestamp: Date.now()
    });

    // 调用父类处理
    await super.handleChildFailure(child, error, failedMessage);
  }
}
```

### 7.3 优雅降级

```typescript
class DegradableActor extends Actor {
  private healthy = true;

  async receive(message: Message): Promise<void> {
    if (!this.healthy) {
      // 降级模式：只处理关键消息
      if (this.isCritical(message)) {
        await this.handleCritical(message);
      } else {
        this.reply(message, { degraded: true, message: 'Service degraded' });
      }
      return;
    }

    try {
      await this.handleMessage(message);
    } catch (error) {
      if (this.shouldDegrade(error)) {
        this.healthy = false;
        this.startRecovery();
      }
      throw error;
    }
  }

  private startRecovery(): void {
    setTimeout(async () => {
      try {
        await this.healthCheck();
        this.healthy = true;
      } catch {
        this.startRecovery();
      }
    }, 5000);
  }
}
```

## 八、总结

### 监督策略核心要点

1. **分层监督**：父 Actor 监督子 Actor
2. **四种策略**：Resume、Restart、Stop、Escalate
3. **两种模式**：One-For-One、All-For-One
4. **生命周期钩子**：preStart、preRestart、postRestart、preStop
5. **熔断器**：防止级联失败

### 下一步

- 阅读 [分布式扩展](./05-actor-distributed.md) 了解跨节点监督
- 阅读 [完整实现](./06-actor-implementation.md) 查看代码实现
