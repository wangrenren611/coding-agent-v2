# Actor 消息传递机制

> 深入理解 Actor 模型的消息传递机制，包括消息类型、投递保证和顺序保证。

## 一、消息类型

### 1.1 Tell（发后即忘）

最基础的消息类型，发送后不等待响应。

```typescript
// 语法
actor.tell(type: string, payload: any): void

// 示例
taskActor.tell('start', { taskId: '123', spec: {...} });
// 立即返回，不等待任务完成
```

**特点**：
- 完全异步
- 性能最高
- 适用于不需要确认的场景

**使用场景**：
- 启动后台任务
- 发送日志
- 事件通知

### 1.2 Ask（请求-响应）

发送消息并等待响应，类似于 RPC 调用。

```typescript
// 语法
actor.ask(type: string, payload: any, options?: { timeout?: number }): Promise<any>

// 示例
try {
  const status = await taskActor.ask('get_status', { taskId: '123' }, {
    timeout: 5000  // 5秒超时
  });
  console.log('任务状态:', status);
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('请求超时');
  }
}
```

**特点**：
- 有超时机制
- 阻塞调用者
- 内部创建临时 Actor 处理响应

**使用场景**：
- 查询状态
- 需要确认的操作
- 同步协调点

### 1.3 Forward（转发）

将收到的消息转发给另一个 Actor，保留原始发送者信息。

```typescript
// 语法
actor.forward(message: Message): void

// 示例
class ProxyActor extends Actor {
  async receive(message: Message): Promise<void> {
    // 转发给目标 Actor
    // 目标 Actor 收到的 message.from 是原始发送者，不是 ProxyActor
    this.targetActor.forward(message);
  }
}
```

**特点**：
- 保留原始发送者
- 用于代理/路由场景
- 实现透明转发

### 1.4 Reply（响应）

回复收到的消息。

```typescript
// 语法
this.reply(originalMessage: Message, response: any): void

// 示例
class TaskActor extends Actor {
  async receive(message: Message): Promise<void> {
    switch (message.type) {
      case 'get_status':
        // 回复发送者
        this.reply(message, {
          state: this.state,
          progress: this.progress
        });
        break;
    }
  }
}
```

## 二、消息结构

### 2.1 标准消息格式

```typescript
interface Message {
  // 消息类型（必填）
  type: string;

  // 消息内容（必填）
  payload: any;

  // 发送者引用（系统填充）
  from: ActorRef | null;

  // 时间戳（系统填充）
  timestamp: number;

  // 关联ID（用于请求-响应匹配）
  correlationId?: string;

  // 回复地址（用于 ask 模式）
  replyTo?: ActorRef;
}
```

### 2.2 消息类型定义

```typescript
// 推荐使用常量定义消息类型
const MessageTypes = {
  // 任务生命周期
  TASK_START: 'task:start',
  TASK_PROGRESS: 'task:progress',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  TASK_CANCEL: 'task:cancel',

  // 查询
  GET_STATUS: 'query:get_status',
  GET_METRICS: 'query:get_metrics',

  // 控制
  SHUTDOWN: 'control:shutdown',
  PAUSE: 'control:pause',
  RESUME: 'control:resume',

  // 交互
  INTERACTION_REQUEST: 'interaction:request',
  INTERACTION_RESPONSE: 'interaction:response'
} as const;
```

### 2.3 类型安全的 Payload

```typescript
// 使用 TypeScript 泛型确保类型安全
interface TypedMessage<T = any> {
  type: string;
  payload: T;
  from: ActorRef | null;
  timestamp: number;
}

// 定义具体 Payload 类型
interface TaskStartPayload {
  taskId: string;
  spec: TaskSpec;
}

interface TaskCompletedPayload {
  taskId: string;
  result: TaskResult;
}

interface TaskFailedPayload {
  taskId: string;
  error: string;
  retryCount: number;
}

// 类型安全的消息处理
class TypedTaskActor extends Actor {
  async receive(message: TypedMessage): Promise<void> {
    switch (message.type) {
      case MessageTypes.TASK_START:
        await this.handleStart(message.payload as TaskStartPayload);
        break;

      case MessageTypes.TASK_CANCEL:
        await this.handleCancel(message.payload as { taskId: string });
        break;
    }
  }
}
```

## 三、消息投递保证

### 3.1 三种投递语义

```
┌────────────────────────────────────────┐
│        消息投递语义                     │
├────────────────────────────────────────┤
│                                        │
│  At-most-once（最多一次）              │
│  - 可能丢失，不重复                    │
│  - 性能最高                            │
│  - 适用：日志、监控、事件通知          │
│                                        │
│  At-least-once（至少一次）             │
│  - 不丢失，可能重复                    │
│  - 需要幂等处理                        │
│  - 适用：任务执行、命令                │
│                                        │
│  Exactly-once（恰好一次）              │
│  - 不丢失，不重复                      │
│  - 代价最高                            │
│  - 适用：关键结果、财务操作            │
│                                        │
└────────────────────────────────────────┘
```

### 3.2 At-Most-Once 实现

```typescript
class AtMostOnceDelivery {
  send(target: ActorRef, type: string, payload: any): void {
    // 直接发送，无重试
    target.mailbox.push({
      type,
      payload,
      from: this.context.self,
      timestamp: Date.now()
    });
  }
}
```

### 3.3 At-Least-Once 实现

```typescript
class AtLeastOnceDelivery {
  private pendingAcks: Map<string, PendingMessage> = new Map();
  private retryInterval = 1000;
  private maxRetries = 3;

  send(target: ActorRef, type: string, payload: any): void {
    const messageId = generateId();

    const message: Message = {
      type,
      payload,
      from: this.context.self,
      timestamp: Date.now(),
      messageId,
      requiresAck: true
    };

    // 存储待确认消息
    this.pendingAcks.set(messageId, {
      message,
      target,
      retryCount: 0,
      lastSent: Date.now()
    });

    // 发送消息
    target.mailbox.push(message);

    // 启动重试定时器
    this.scheduleRetry(messageId);
  }

  private scheduleRetry(messageId: string): void {
    setTimeout(() => {
      const pending = this.pendingAcks.get(messageId);
      if (!pending) return;  // 已确认

      if (pending.retryCount >= this.maxRetries) {
        // 超过重试次数，放弃
        this.pendingAcks.delete(messageId);
        this.onDeliveryFailed(pending);
        return;
      }

      // 重试发送
      pending.retryCount++;
      pending.lastSent = Date.now();
      pending.target.mailbox.push(pending.message);

      // 再次调度
      this.scheduleRetry(messageId);
    }, this.retryInterval);
  }

  // 收到确认
  handleAck(messageId: string): void {
    this.pendingAcks.delete(messageId);
  }
}
```

### 3.4 Exactly-Once 实现

```typescript
class ExactlyOnceDelivery {
  private processedIds: Set<string> = new Set();
  private pendingAcks: Map<string, PendingMessage> = new Map();

  // 发送端
  send(target: ActorRef, type: string, payload: any): void {
    const messageId = generateId();

    // 使用 At-Least-Once 发送
    this.atLeastOnce.send(target, type, {
      ...payload,
      messageId
    });
  }

  // 接收端
  async receive(message: Message): Promise<void> {
    const { messageId } = message.payload;

    // 检查是否已处理
    if (this.processedIds.has(messageId)) {
      // 已处理，只发送确认
      this.sendAck(message.from, messageId);
      return;
    }

    try {
      // 处理消息
      await this.processMessage(message);

      // 标记为已处理
      this.processedIds.add(messageId);

      // 发送确认
      this.sendAck(message.from, messageId);

    } catch (error) {
      // 处理失败，不发送确认，发送端会重试
      throw error;
    }
  }

  private sendAck(target: ActorRef, messageId: string): void {
    target.tell('ack', { messageId });
  }
}
```

## 四、消息顺序保证

### 4.1 Actor 模型的顺序保证

```
Actor 模型的关键保证：
"从 Actor A 发送到 Actor B 的消息，按发送顺序到达"

Actor A                    Actor B
  │                          │
  ├─ msg1 ──────────────────▶│
  ├─ msg2 ──────────────────▶│
  └─ msg3 ──────────────────▶│
                             │
                        处理顺序: msg1 → msg2 → msg3
```

### 4.2 跨发送者无顺序保证

```typescript
// 不同发送者的消息不保证顺序
Actor A ── msgA1 ──▶
                    │
Actor B ── msgB1 ──▶├──▶ Actor C
                    │
Actor A ── msgA2 ──▶│
                    │
             可能的顺序: msgA1, msgB1, msgA2
             也可能是: msgB1, msgA1, msgA2
```

### 4.3 需要严格顺序的解决方案

```typescript
// 方案1：使用序列号
class OrderedMessage {
  type: string;
  payload: any;
  sequenceNumber: number;
}

class OrderedReceiver extends Actor {
  private expectedSeq = 0;
  private buffer: Map<number, Message> = new Map();

  async receive(message: OrderedMessage): Promise<void> {
    if (message.sequenceNumber === this.expectedSeq) {
      // 处理当前消息
      await this.processMessage(message);
      this.expectedSeq++;

      // 检查缓冲区是否有后续消息
      while (this.buffer.has(this.expectedSeq)) {
        const nextMessage = this.buffer.get(this.expectedSeq)!;
        await this.processMessage(nextMessage);
        this.buffer.delete(this.expectedSeq);
        this.expectedSeq++;
      }
    } else if (message.sequenceNumber > this.expectedSeq) {
      // 缓存乱序消息
      this.buffer.set(message.sequenceNumber, message);
    }
    // 忽略已处理的消息 (sequenceNumber < expectedSeq)
  }
}

// 方案2：使用专用顺序通道
class OrderedChannel {
  private sender: ActorRef;
  private receiver: ActorRef;
  private pendingQueue: Message[] = [];
  private processing = false;

  async send(message: Message): Promise<void> {
    this.pendingQueue.push(message);

    if (!this.processing) {
      this.processing = true;
      await this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    while (this.pendingQueue.length > 0) {
      const message = this.pendingQueue.shift()!;
      await this.receiver.ask(message.type, message.payload);
    }
    this.processing = false;
  }
}
```

## 五、邮箱实现

### 5.1 基本邮箱

```typescript
class Mailbox {
  private queue: Message[] = [];
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  push(message: Message): boolean {
    if (this.queue.length >= this.maxSize) {
      return false;  // 邮箱已满
    }
    this.queue.push(message);
    return true;
  }

  pop(): Message | undefined {
    return this.queue.shift();
  }

  peek(): Message | undefined {
    return this.queue[0];
  }

  size(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }
}
```

### 5.2 优先级邮箱

```typescript
class PriorityMailbox extends Mailbox {
  private queues: Map<number, Message[]> = new Map();
  private priorities: number[];

  constructor(priorityLevels: number[] = [0, 1, 2]) {
    super();
    this.priorities = priorityLevels.sort((a, b) => b - a);  // 降序
    for (const p of this.priorities) {
      this.queues.set(p, []);
    }
  }

  push(message: Message & { priority?: number }): boolean {
    const priority = message.priority ?? 1;  // 默认优先级
    const queue = this.queues.get(priority);
    if (!queue) return false;
    queue.push(message);
    return true;
  }

  pop(): Message | undefined {
    for (const priority of this.priorities) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        return queue.shift();
      }
    }
    return undefined;
  }
}
```

### 5.3 持久化邮箱

```typescript
class PersistentMailbox extends Mailbox {
  private storage: MessageStorage;
  private actorPath: string;

  async push(message: Message): Promise<boolean> {
    // 先持久化
    await this.storage.save(this.actorPath, message);
    // 再入队
    return super.push(message);
  }

  pop(): Message | undefined {
    const message = super.pop();
    if (message) {
      // 删除持久化记录
      this.storage.delete(this.actorPath, message.messageId);
    }
    return message;
  }

  // 恢复未处理的消息
  async recover(): Promise<void> {
    const messages = await this.storage.loadAll(this.actorPath);
    for (const message of messages) {
      super.push(message);
    }
  }
}
```

## 六、死信队列

### 6.1 什么是死信

以下情况的消息会进入死信队列：
- 目标 Actor 不存在
- 邮箱已满
- 消息处理失败且无法恢复
- 消息超时

### 6.2 死信队列实现

```typescript
class DeadLetterActor extends Actor {
  private deadLetters: DeadLetter[] = [];
  private maxSize = 10000;

  async receive(message: Message): Promise<void> {
    const deadLetter: DeadLetter = {
      originalMessage: message,
      reason: message.payload.reason,
      timestamp: Date.now(),
      target: message.payload.target
    };

    if (this.deadLetters.length >= this.maxSize) {
      // 移除最旧的
      this.deadLetters.shift();
    }

    this.deadLetters.push(deadLetter);

    // 记录日志
    console.warn(`Dead letter: ${deadLetter.reason}`, {
      target: deadLetter.target,
      type: deadLetter.originalMessage.type
    });
  }

  // 查询死信
  getDeadLetters(filter?: DeadLetterFilter): DeadLetter[] {
    let result = this.deadLetters;

    if (filter?.target) {
      result = result.filter(d => d.target === filter.target);
    }
    if (filter?.since) {
      result = result.filter(d => d.timestamp >= filter.since);
    }

    return result;
  }
}
```

### 6.3 死信监控

```typescript
class DeadLetterMonitor extends Actor {
  private deadLetterActor: ActorRef;
  private alertThreshold = 10;  // 每分钟超过10个死信就告警

  async startMonitoring(): Promise<void> {
    setInterval(async () => {
      const deadLetters = await this.deadLetterActor.ask('get_recent', {
        since: Date.now() - 60000
      });

      if (deadLetters.length > this.alertThreshold) {
        this.sendAlert({
          type: 'dead_letter_spike',
          count: deadLetters.length,
          samples: deadLetters.slice(0, 5)
        });
      }
    }, 60000);
  }
}
```

## 七、消息序列化

### 7.1 本地消息

本地 Actor 之间可以直接传递对象引用：

```typescript
// 本地消息，直接传递对象
const result = { data: largeObject, metadata: {...} };
targetActor.tell('result', result);
```

### 7.2 远程消息

远程 Actor 需要序列化：

```typescript
interface MessageSerializer {
  serialize(message: Message): Buffer;
  deserialize(buffer: Buffer): Message;
}

class JSONSerializer implements MessageSerializer {
  serialize(message: Message): Buffer {
    return Buffer.from(JSON.stringify(message));
  }

  deserialize(buffer: Buffer): Message {
    return JSON.parse(buffer.toString());
  }
}

// 处理不可序列化的数据
class SafeSerializer implements MessageSerializer {
  serialize(message: Message): Buffer {
    const safeMessage = this.makeSerializable(message);
    return Buffer.from(JSON.stringify(safeMessage));
  }

  private makeSerializable(message: Message): any {
    return {
      type: message.type,
      payload: this.deepClone(message.payload),
      timestamp: message.timestamp,
      messageId: message.messageId
    };
  }

  private deepClone(obj: any): any {
    // 处理循环引用、函数、Symbol 等
    return JSON.parse(JSON.stringify(obj, (key, value) => {
      if (typeof value === 'function') {
        return `[Function: ${value.name}]`;
      }
      if (typeof value === 'symbol') {
        return value.toString();
      }
      return value;
    }));
  }
}
```

## 八、消息压缩

### 8.1 大消息压缩

```typescript
class CompressingSender {
  private threshold = 10240;  // 10KB 以上压缩

  send(target: ActorRef, type: string, payload: any): void {
    const serialized = JSON.stringify(payload);

    if (serialized.length > this.threshold) {
      const compressed = this.compress(serialized);
      target.tell(type, {
        __compressed: true,
        data: compressed.toString('base64')
      });
    } else {
      target.tell(type, payload);
    }
  }

  private compress(data: string): Buffer {
    return zlib.deflateSync(Buffer.from(data));
  }
}

class DecompressingReceiver {
  async receive(message: Message): Promise<void> {
    let payload = message.payload;

    if (payload.__compressed) {
      const decompressed = this.decompress(
        Buffer.from(payload.data, 'base64')
      );
      payload = JSON.parse(decompressed);
    }

    await this.processMessage(message.type, payload);
  }

  private decompress(data: Buffer): string {
    return zlib.inflateSync(data).toString();
  }
}
```

## 九、最佳实践

### 9.1 消息设计原则

1. **不可变**：消息一旦创建就不应修改
2. **可序列化**：所有字段都应该是可序列化的
3. **自描述**：包含足够的信息让接收者理解上下文
4. **适度大小**：避免超大消息，考虑分块或引用

```typescript
// ❌ 不好的设计
const badMessage = {
  type: 'data',
  payload: hugeArray  // 数百万条数据
};

// ✓ 好的设计
const goodMessage = {
  type: 'data_reference',
  payload: {
    storageKey: 'data-123',
    range: { start: 0, end: 1000 },
    totalCount: 1000000
  }
};
```

### 9.2 消息命名约定

```typescript
// 推荐的命名格式：domain:action
const MessageTypes = {
  // 任务域
  'task:start': 'task:start',
  'task:progress': 'task:progress',
  'task:complete': 'task:complete',
  'task:fail': 'task:fail',

  // 查询域
  'query:status': 'query:status',
  'query:metrics': 'query:metrics',

  // 控制域
  'control:pause': 'control:pause',
  'control:resume': 'control:resume',
  'control:shutdown': 'control:shutdown'
};
```

### 9.3 错误处理

```typescript
class RobustMessageHandler {
  async receive(message: Message): Promise<void> {
    try {
      await this.handleMessage(message);
    } catch (error) {
      // 发送错误响应
      if (message.replyTo) {
        message.replyTo.tell('error', {
          messageId: message.messageId,
          error: {
            type: error.constructor.name,
            message: error.message,
            stack: error.stack
          }
        });
      }

      // 记录错误
      this.logError(message, error);

      // 决定是否重新抛出（触发监督）
      if (this.shouldEscalate(error)) {
        throw error;
      }
    }
  }
}
```

## 十、总结

### 消息传递的核心要点

1. **Tell vs Ask**：理解何时用哪种模式
2. **投递保证**：根据业务需求选择合适的语义
3. **顺序保证**：了解 Actor 模型的顺序语义
4. **邮箱管理**：选择合适的邮箱类型
5. **死信处理**：监控和处理无法投递的消息

### 下一步

- 阅读 [监督策略](./04-actor-supervision.md) 了解错误处理
- 阅读 [分布式扩展](./05-actor-distributed.md) 了解远程消息传递
