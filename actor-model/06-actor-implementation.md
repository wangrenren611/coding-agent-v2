# Actor 完整实现

> 基于 TypeScript 的完整 Actor 系统实现，可直接用于多 Agent 系统。

## 一、核心接口定义

```typescript
// src/actor/types.ts

/**
 * Actor 引用
 */
interface ActorRef {
  path: string;
  tell(type: string, payload: any): void;
  ask(type: string, payload: any, options?: AskOptions): Promise<any>;
  stop(): void;
}

/**
 * 消息结构
 */
interface Message {
  type: string;
  payload: any;
  from: ActorRef | null;
  timestamp: number;
  messageId?: string;
  correlationId?: string;
  replyTo?: ActorRef;
}

/**
 * Actor 上下文
 */
interface ActorContext {
  self: ActorRef;
  parent: ActorRef | null;
  system: ActorSystem;
  children: Map<string, ActorRef>;
}

/**
 * Ask 选项
 */
interface AskOptions {
  timeout?: number;
}

/**
 * Actor Props
 */
interface ActorProps {
  name: string;
  parent?: ActorRef;
  system?: ActorSystem;
  [key: string]: any;
}

/**
 * 监督策略
 */
enum SupervisionDirective {
  Resume = 'resume',
  Restart = 'restart',
  Stop = 'stop',
  Escalate = 'escalate'
}

interface SupervisionStrategy {
  maxRetries?: number;
  withinTimeRange?: number;
  decider: (error: Error) => SupervisionDirective;
}
```

## 二、Actor 基类实现

```typescript
// src/actor/Actor.ts

import { v4 as uuidv4 } from 'uuid';

abstract class Actor implements ActorRef {
  public path: string;
  protected mailbox: Message[] = [];
  protected context: ActorContext;
  protected props: ActorProps;

  private processing: boolean = false;
  private stopped: boolean = false;
  private pendingAsks: Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = new Map();

  constructor(props: ActorProps) {
    this.props = props;
    this.path = props.parent
      ? `${props.parent.path}/${props.name}`
      : `/user/${props.name}`;
  }

  // 子类必须实现
  abstract receive(message: Message): Promise<void>;

  // 启动 Actor
  start(): void {
    this.context = {
      self: this,
      parent: this.props.parent || null,
      system: this.props.system!,
      children: new Map()
    };

    this.preStart();
  }

  // 生命周期钩子
  protected async preStart(): Promise<void> {}
  protected async postStop(): Promise<void> {}
  protected async preRestart(reason: Error): Promise<void> {}
  protected async postRestart(reason: Error): Promise<void> {}

  // 停止 Actor
  stop(): void {
    if (this.stopped) return;

    this.stopped = true;

    // 停止所有子 Actor
    for (const child of this.context.children.values()) {
      child.stop();
    }

    // 拒绝所有 pending asks
    for (const [id, { reject, timer }] of this.pendingAsks) {
      clearTimeout(timer);
      reject(new Error('Actor stopped'));
    }
    this.pendingAsks.clear();

    this.postStop();
  }

  // 调度处理
  protected scheduleProcessing(): void {
    if (this.processing || this.stopped) return;

    this.processing = true;
    queueMicrotask(() => this.processMailbox());
  }

  // 处理邮箱
  private async processMailbox(): Promise<void> {
    while (this.mailbox.length > 0 && !this.stopped) {
      const message = this.mailbox.shift()!;

      try {
        // 检查是否是 Ask 响应
        if (message.correlationId && this.pendingAsks.has(message.correlationId)) {
          const pending = this.pendingAsks.get(message.correlationId)!;
          clearTimeout(pending.timer);
          pending.resolve(message.payload);
          this.pendingAsks.delete(message.correlationId);
          continue;
        }

        await this.receive(message);
      } catch (error) {
        await this.handleFailure(error as Error, message);
      }
    }

    this.processing = false;
  }

  // 发送消息 (Tell)
  tell(type: string, payload: any): void {
    if (this.stopped) {
      console.warn(`Actor ${this.path} is stopped, message ignored`);
      return;
    }

    const message: Message = {
      type,
      payload,
      from: null,
      timestamp: Date.now(),
      messageId: uuidv4()
    };

    this.mailbox.push(message);
    this.scheduleProcessing();
  }

  // 请求-响应 (Ask)
  ask(type: string, payload: any, options: AskOptions = {}): Promise<any> {
    if (this.stopped) {
      return Promise.reject(new Error('Actor stopped'));
    }

    const timeout = options.timeout || 5000;
    const correlationId = uuidv4();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAsks.delete(correlationId);
        reject(new Error('Ask timeout'));
      }, timeout);

      this.pendingAsks.set(correlationId, { resolve, reject, timer });

      const message: Message = {
        type,
        payload,
        from: this.context?.self || null,
        timestamp: Date.now(),
        messageId: uuidv4(),
        correlationId,
        replyTo: this.context?.self
      };

      this.mailbox.push(message);
      this.scheduleProcessing();
    });
  }

  // 回复消息
  protected reply(originalMessage: Message, response: any): void {
    if (originalMessage.replyTo) {
      originalMessage.replyTo.tell(originalMessage.type + '_response', {
        correlationId: originalMessage.correlationId,
        payload: response
      });
    }
  }

  // 创建子 Actor
  protected actorOf<T extends Actor>(
    actorClass: new (props: ActorProps) => T,
    props: Omit<ActorProps, 'parent' | 'system'>
  ): ActorRef {
    const child = new actorClass({
      ...props,
      parent: this,
      system: this.context.system
    });

    child.start();
    this.context.children.set(child.path, child);

    return child;
  }

  // 错误处理
  protected async handleFailure(error: Error, message: Message): Promise<void> {
    console.error(`Actor ${this.path} failed:`, error);

    if (this.context.parent) {
      this.context.parent.tell('child_failed', {
        child: this,
        error,
        message
      });
    }
  }
}

export { Actor, ActorRef, Message, ActorContext, ActorProps, SupervisionDirective, SupervisionStrategy };
```

## 三、Actor System 实现

```typescript
// src/actor/ActorSystem.ts

class ActorSystem {
  public readonly name: string;
  private actors: Map<string, ActorRef> = new Map();
  private deadLetters: DeadLetterActor;
  private guardian: GuardianActor;

  constructor(name: string) {
    this.name = name;

    // 创建 Guardian
    this.guardian = new GuardianActor({
      name: 'guardian',
      system: this
    });
    this.guardian.start();

    // 创建死信队列
    this.deadLetters = new DeadLetterActor({
      name: 'dead-letters',
      system: this,
      parent: this.guardian
    });
    this.deadLetters.start();
    this.actors.set(this.deadLetters.path, this.deadLetters);
  }

  // 创建 Actor
  actorOf<T extends Actor>(
    actorClass: new (props: ActorProps) => T,
    props: Omit<ActorProps, 'parent' | 'system'>
  ): ActorRef {
    const actor = new actorClass({
      ...props,
      parent: this.guardian,
      system: this
    });

    actor.start();
    this.actors.set(actor.path, actor);

    return actor;
  }

  // 查找 Actor
  actorSelection(path: string): ActorRef | null {
    return this.actors.get(path) || this.deadLetters;
  }

  // 停止系统
  async terminate(): Promise<void> {
    // 停止所有 Actor
    for (const actor of this.actors.values()) {
      actor.stop();
    }
    this.actors.clear();
    this.guardian.stop();
  }
}

// Guardian Actor
class GuardianActor extends Actor {
  async receive(message: Message): Promise<void> {
    // Guardian 主要用于监督顶层 Actor
    if (message.type === 'child_failed') {
      console.error('Guardian received child failure:', message.payload);
    }
  }
}

// 死信队列 Actor
class DeadLetterActor extends Actor {
  private deadLetters: Array<{
    message: Message;
    reason: string;
    timestamp: number;
  }> = [];

  async receive(message: Message): Promise<void> {
    this.deadLetters.push({
      message,
      reason: message.payload?.reason || 'Unknown',
      timestamp: Date.now()
    });

    if (this.deadLetters.length > 10000) {
      this.deadLetters.shift();
    }

    console.warn('Dead letter:', message.type, message.payload);
  }

  getDeadLetters() {
    return this.deadLetters;
  }
}

export { ActorSystem };
```

## 四、监督者 Actor

```typescript
// src/actor/SupervisorActor.ts

interface ChildContext {
  actor: ActorRef;
  restartCount: number;
  lastRestartTime: number;
  ActorClass: new (props: ActorProps) => Actor;
  props: ActorProps;
}

abstract class SupervisorActor extends Actor {
  protected children: Map<string, ChildContext> = new Map();
  protected abstract supervisionStrategy: SupervisionStrategy;

  async receive(message: Message): Promise<void> {
    if (message.type === 'child_failed') {
      await this.handleChildFailure(
        message.payload.child,
        message.payload.error,
        message.payload.message
      );
    }
  }

  // 创建子 Actor（带监督）
  protected actorOf<T extends Actor>(
    actorClass: new (props: ActorProps) => T,
    props: Omit<ActorProps, 'parent' | 'system'>
  ): ActorRef {
    const fullProps: ActorProps = {
      ...props,
      parent: this,
      system: this.context.system
    };

    const actor = new actorClass(fullProps);
    actor.start();

    this.children.set(actor.path, {
      actor,
      restartCount: 0,
      lastRestartTime: 0,
      ActorClass: actorClass,
      props: fullProps
    });

    this.context.children.set(actor.path, actor);
    return actor;
  }

  // 处理子 Actor 失败
  private async handleChildFailure(
    child: ActorRef,
    error: Error,
    failedMessage: Message | null
  ): Promise<void> {
    const childContext = this.children.get(child.path);
    if (!childContext) {
      console.warn(`Unknown child failed: ${child.path}`);
      return;
    }

    const directive = this.supervisionStrategy.decider(error);

    console.log(`Child ${child.path} failed, directive: ${directive}`);

    switch (directive) {
      case SupervisionDirective.Resume:
        await this.resumeChild(childContext);
        break;

      case SupervisionDirective.Restart:
        await this.restartChild(childContext, error);
        break;

      case SupervisionDirective.Stop:
        await this.stopChild(childContext);
        break;

      case SupervisionDirective.Escalate:
        await this.escalate(child, error);
        break;
    }
  }

  private async resumeChild(context: ChildContext): Promise<void> {
    // 继续处理下一条消息
    console.log(`Resuming child ${context.actor.path}`);
  }

  private async restartChild(context: ChildContext, error: Error): Promise<void> {
    const now = Date.now();
    const strategy = this.supervisionStrategy;
    const maxRetries = strategy.maxRetries || 3;
    const timeRange = strategy.withinTimeRange || 60000;

    // 检查重启限制
    if (now - context.lastRestartTime < timeRange) {
      if (context.restartCount >= maxRetries) {
        console.error(`Child exceeded max retries: ${context.actor.path}`);
        await this.stopChild(context);
        return;
      }
      context.restartCount++;
    } else {
      context.restartCount = 1;
    }

    context.lastRestartTime = now;

    // 停止旧 Actor
    const oldActor = context.actor as Actor;
    await oldActor.preRestart(error);
    oldActor.stop();

    // 创建新 Actor
    const newActor = new context.ActorClass(context.props);
    await newActor.postRestart(error);
    newActor.start();

    // 更新上下文
    context.actor = newActor;
    this.context.children.set(newActor.path, newActor);

    console.log(`Restarted child ${newActor.path}`);
  }

  private async stopChild(context: ChildContext): Promise<void> {
    const actor = context.actor as Actor;
    await actor.preStop();
    actor.stop();

    this.children.delete(actor.path);
    this.context.children.delete(actor.path);

    console.log(`Stopped child ${actor.path}`);
  }

  private async escalate(child: ActorRef, error: Error): Promise<void> {
    if (this.context.parent) {
      this.context.parent.tell('child_failed', {
        child,
        error,
        message: null
      });
    } else {
      console.error(`Top-level escalation:`, error);
      const context = this.children.get(child.path);
      if (context) {
        await this.stopChild(context);
      }
    }
  }
}

export { SupervisorActor, ChildContext };
```

## 五、Main Agent Actor 实现

```typescript
// src/actors/MainAgentActor.ts

interface PendingTask {
  taskId: string;
  actor: ActorRef;
  spec: TaskSpec;
  dispatchedAt: number;
}

interface TaskResult {
  taskId: string;
  result: any;
  completedAt: number;
}

class MainAgentActor extends SupervisorActor {
  private agentContext: AgentContext;
  private pendingTasks: Map<string, PendingTask> = new Map();
  private taskResults: Map<string, TaskResult> = new Map();

  protected supervisionStrategy: SupervisionStrategy = {
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

  constructor(props: ActorProps) {
    super(props);
    this.agentContext = props.initialContext || new AgentContext();
  }

  async receive(message: Message): Promise<void> {
    // 先处理监督消息
    if (message.type === 'child_failed') {
      return super.receive(message);
    }

    switch (message.type) {
      case 'user_input':
        await this.handleUserInput(message.payload);
        break;

      case 'task_completed':
        await this.handleTaskCompleted(message.from, message.payload);
        break;

      case 'task_failed':
        await this.handleTaskFailed(message.from, message.payload);
        break;

      case 'interaction_request':
        await this.handleInteractionRequest(message.from, message.payload);
        break;

      case 'shutdown':
        await this.shutdown();
        break;

      case 'get_status':
        this.reply(message, this.getStatus());
        break;
    }
  }

  // 用户输入处理
  private async handleUserInput(input: string): Promise<void> {
    console.log('User input:', input);

    // 推理
    const plan = await this.reason(input);

    // 执行计划
    for (const action of plan.actions) {
      await this.executeAction(action);
    }
  }

  // 推理（简化版）
  private async reason(input: string): Promise<Plan> {
    // 分析用户意图
    const intent = await this.analyzeIntent(input);

    // 生成执行计划
    const actions = await this.planActions(intent);

    return { intent, actions };
  }

  // 执行动作
  private async executeAction(action: Action): Promise<void> {
    switch (action.type) {
      case 'dispatch_task':
        await this.dispatchTask(action.spec);
        break;

      case 'wait_for_tasks':
        await this.waitForTasks(action.taskIds);
        break;

      case 'report':
        await this.reportToUser(action.message);
        break;
    }
  }

  // 派发任务
  private async dispatchTask(spec: TaskSpec): Promise<string> {
    const taskId = generateId();

    const taskActor = this.actorOf(TaskActor, {
      name: `task-${taskId}`,
      taskId,
      spec
    });

    this.pendingTasks.set(taskId, {
      taskId,
      actor: taskActor,
      spec,
      dispatchedAt: Date.now()
    });

    taskActor.tell('start', { taskId, spec });

    console.log(`Dispatched task ${taskId}: ${spec.description}`);
    return taskId;
  }

  // 处理任务完成
  private async handleTaskCompleted(from: ActorRef | null, payload: any): Promise<void> {
    const { taskId, result } = payload;

    this.pendingTasks.delete(taskId);
    this.taskResults.set(taskId, {
      taskId,
      result,
      completedAt: Date.now()
    });

    this.agentContext.addResult(taskId, result);

    console.log(`Task ${taskId} completed: ${result.summary}`);

    // 继续推理
    await this.continueReasoning();
  }

  // 处理任务失败
  private async handleTaskFailed(from: ActorRef | null, payload: any): Promise<void> {
    const { taskId, error } = payload;

    this.pendingTasks.delete(taskId);

    console.error(`Task ${taskId} failed: ${error}`);

    // 可以选择重试或报告错误
  }

  // 处理交互请求
  private async handleInteractionRequest(from: ActorRef | null, payload: any): Promise<void> {
    const { taskId, question, options } = payload;

    // 询问用户
    const answer = await this.askUser(question, options);

    // 返回给任务 Actor
    if (from) {
      from.tell('interaction_response', { answer });
    }
  }

  // 等待任务完成
  private async waitForTasks(taskIds: string[]): Promise<void> {
    const pending = taskIds.filter(id => this.pendingTasks.has(id));

    if (pending.length === 0) return;

    return new Promise(resolve => {
      const check = () => {
        const stillPending = pending.filter(id => this.pendingTasks.has(id));
        if (stillPending.length === 0) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // 优雅关闭
  private async shutdown(): Promise<void> {
    console.log('Main Agent shutting down...');

    // 等待所有 pending tasks
    const pending = Array.from(this.pendingTasks.keys());
    if (pending.length > 0) {
      console.log(`Waiting for ${pending.length} tasks...`);
      await this.waitForTasks(pending);
    }

    // 汇总结果
    const results = Array.from(this.taskResults.values());
    if (results.length > 0) {
      await this.reportToUser({
        type: 'summary',
        tasks: results.map(r => ({
          id: r.taskId,
          summary: r.result.summary
        }))
      });
    }

    // 停止
    this.stop();

    console.log('Main Agent shutdown complete');
  }

  // 获取状态
  private getStatus() {
    return {
      pendingTasks: this.pendingTasks.size,
      completedTasks: this.taskResults.size,
      children: this.context.children.size
    };
  }

  // 辅助方法（简化实现）
  private async analyzeIntent(input: string): Promise<Intent> {
    return { type: 'task', description: input };
  }

  private async planActions(intent: Intent): Promise<Action[]> {
    return [
      { type: 'dispatch_task', spec: { type: 'explore', description: intent.description } }
    ];
  }

  private async continueReasoning(): Promise<void> {
    // 检查是否需要继续执行
  }

  private async askUser(question: string, options?: any): Promise<string> {
    console.log('Asking user:', question);
    return 'user answer';
  }

  private async reportToUser(message: any): Promise<void> {
    console.log('Report to user:', message);
  }
}

// 辅助类型和类
class AgentContext {
  private results: Map<string, any> = new Map();

  addResult(taskId: string, result: any): void {
    this.results.set(taskId, result);
  }

  getResult(taskId: string): any {
    return this.results.get(taskId);
  }
}

interface TaskSpec {
  type: string;
  description: string;
  params?: any;
  maxRetries?: number;
}

interface Plan {
  intent: Intent;
  actions: Action[];
}

interface Intent {
  type: string;
  description: string;
}

interface Action {
  type: string;
  [key: string]: any;
}

class NetworkError extends Error {}
class ValidationError extends Error {}
class FatalError extends Error {}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export { MainAgentActor, AgentContext, TaskSpec };
```

## 六、Task Actor 实现

```typescript
// src/actors/TaskActor.ts

interface TaskResult {
  taskId: string;
  summary: string;
  data: any;
}

class TaskActor extends Actor {
  private taskId!: string;
  private spec!: TaskSpec;
  private state: 'idle' | 'running' | 'completed' | 'failed' = 'idle';
  private retryCount: number = 0;

  private pendingInteraction: ((answer: any) => void) | null = null;

  async receive(message: Message): Promise<void> {
    switch (message.type) {
      case 'start':
        await this.execute();
        break;

      case 'cancel':
        await this.cancel();
        break;

      case 'interaction_response':
        this.handleInteractionResponse(message.payload);
        break;

      case 'get_status':
        this.reply(message, {
          taskId: this.taskId,
          state: this.state,
          retryCount: this.retryCount
        });
        break;
    }
  }

  // 执行任务
  private async execute(): Promise<void> {
    this.state = 'running';

    try {
      const result = await this.doWork();

      this.state = 'completed';

      // 通知父 Actor
      if (this.context.parent) {
        this.context.parent.tell('task_completed', {
          taskId: this.taskId,
          result
        });
      }

    } catch (error) {
      this.state = 'failed';
      this.retryCount++;

      const maxRetries = this.spec.maxRetries || 0;

      if (this.retryCount <= maxRetries) {
        console.log(`Task ${this.taskId} retrying (${this.retryCount}/${maxRetries})`);
        await this.execute();
      } else {
        // 通知失败
        if (this.context.parent) {
          this.context.parent.tell('task_failed', {
            taskId: this.taskId,
            error: (error as Error).message,
            retryCount: this.retryCount
          });
        }

        throw error;
      }
    }
  }

  // 实际工作
  private async doWork(): Promise<TaskResult> {
    console.log(`Task ${this.taskId} executing: ${this.spec.description}`);

    switch (this.spec.type) {
      case 'explore':
        return await this.explore(this.spec.params);

      case 'research':
        return await this.research(this.spec.params);

      case 'execute':
        return await this.executeCommand(this.spec.params);

      default:
        throw new Error(`Unknown task type: ${this.spec.type}`);
    }
  }

  // 探索代码库
  private async explore(params: any): Promise<TaskResult> {
    // 模拟探索
    await this.sleep(1000);

    return {
      taskId: this.taskId,
      summary: 'Explored codebase',
      data: { files: 100, patterns: [] }
    };
  }

  // 研究
  private async research(params: any): Promise<TaskResult> {
    // 可能需要交互
    if (params.needsClarification) {
      const answer = await this.requestInteraction(
        '需要更多信息，请描述您想要研究的内容？'
      );
      console.log('User answered:', answer);
    }

    await this.sleep(2000);

    return {
      taskId: this.taskId,
      summary: 'Research completed',
      data: { findings: [] }
    };
  }

  // 执行命令
  private async executeCommand(params: any): Promise<TaskResult> {
    await this.sleep(500);

    return {
      taskId: this.taskId,
      summary: 'Command executed',
      data: { output: 'success' }
    };
  }

  // 请求交互
  protected async requestInteraction(question: string, options?: any): Promise<any> {
    if (!this.context.parent) {
      throw new Error('No parent to handle interaction');
    }

    // 发送请求
    this.context.parent.tell('interaction_request', {
      taskId: this.taskId,
      question,
      options
    });

    // 等待响应
    return new Promise(resolve => {
      this.pendingInteraction = resolve;
    });
  }

  // 处理交互响应
  private handleInteractionResponse(payload: any): void {
    if (this.pendingInteraction) {
      this.pendingInteraction(payload.answer);
      this.pendingInteraction = null;
    }
  }

  // 取消任务
  private async cancel(): Promise<void> {
    this.state = 'failed';

    if (this.context.parent) {
      this.context.parent.tell('task_failed', {
        taskId: this.taskId,
        error: 'Cancelled by user',
        retryCount: 0
      });
    }
  }

  // 辅助
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export { TaskActor, TaskResult };
```

## 七、使用示例

```typescript
// src/main.ts

async function main() {
  // 创建 Actor 系统
  const system = new ActorSystem('coding-agent');

  try {
    // 创建 Main Agent
    const mainAgent = system.actorOf(MainAgentActor, {
      name: 'main-agent',
      initialContext: new AgentContext()
    });

    // 发送用户输入
    mainAgent.tell('user_input', '帮我探索这个项目的结构');

    // 等待一段时间
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 获取状态
    const status = await mainAgent.ask('get_status', {});
    console.log('Status:', status);

  } finally {
    // 关闭系统
    await system.terminate();
  }
}

main().catch(console.error);
```

## 八、测试

```typescript
// src/__tests__/Actor.test.ts

import { ActorSystem } from '../actor/ActorSystem';
import { Actor, ActorProps, Message } from '../actor/Actor';

class TestActor extends Actor {
  public receivedMessages: Message[] = [];

  async receive(message: Message): Promise<void> {
    this.receivedMessages.push(message);

    if (message.type === 'echo') {
      this.reply(message, { echo: message.payload });
    }
  }
}

describe('Actor', () => {
  let system: ActorSystem;

  beforeEach(() => {
    system = new ActorSystem('test-system');
  });

  afterEach(async () => {
    await system.terminate();
  });

  test('should receive tell messages', async () => {
    const actor = system.actorOf(TestActor, { name: 'test' });

    actor.tell('test', { data: 'hello' });

    await new Promise(resolve => setTimeout(resolve, 100));

    expect((actor as TestActor).receivedMessages.length).toBe(1);
    expect((actor as TestActor).receivedMessages[0].payload.data).toBe('hello');
  });

  test('should respond to ask messages', async () => {
    const actor = system.actorOf(TestActor, { name: 'test' });

    const response = await actor.ask('echo', { data: 'hello' });

    expect(response.echo.data).toBe('hello');
  });

  test('should timeout on ask', async () => {
    class SlowActor extends Actor {
      async receive(message: Message): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const actor = system.actorOf(SlowActor, { name: 'slow' });

    await expect(
      actor.ask('test', {}, { timeout: 100 })
    ).rejects.toThrow('Ask timeout');
  });
});
```

## 九、总结

本实现提供了完整的 Actor 系统：

1. **Actor 基类**：消息处理、生命周期管理
2. **Actor System**：Actor 创建和管理
3. **监督者**：错误处理和监督策略
4. **Main Agent**：协调者实现
5. **Task Actor**：任务执行器实现

可以直接用于构建多 Agent 系统，并根据需要扩展分布式功能。
