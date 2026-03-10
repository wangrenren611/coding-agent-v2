# Actor 模型理论基础

> 理解 Actor 模型的核心思想，以及它为什么是构建多 Agent 系统的最佳选择。

## 一、起源与核心思想

Actor 模型由 Carl Hewitt 在 1973 年提出，最初是为了解决**并发计算**中的根本问题。

### 核心哲学

> **"一切皆 Actor，通过异步消息传递通信，没有共享状态。"**

这直接解决了多线程编程的三个经典难题：

| 问题 | Actor 解决方案 |
|------|---------------|
| **竞态条件** | 没有共享状态 → 没有竞态 |
| **死锁** | 没有锁 → 没有死锁 |
| **内存可见性** | 消息传递天然同步 → 没有可见性问题 |

## 二、Actor 的定义

一个 Actor 是具有以下特性的计算实体：

```typescript
Actor = {
  状态 (State),      // 私有状态，外部不可直接访问
  行为 (Behavior),   // 消息处理逻辑
  邮箱 (Mailbox),    // 接收消息的队列
  子 Actor 引用      // 创建的子 Actor
}
```

### 三个基本操作

1. **发送消息** 给其他 Actor（异步，不等待）
2. **创建子 Actor**（动态创建，形成层级结构）
3. **决定下一个行为**（处理完消息后的状态变化）

### 基本代码结构

```typescript
abstract class Actor {
  // 私有状态
  protected state: any;

  // 邮箱
  protected mailbox: Message[] = [];

  // 消息处理（子类实现）
  abstract receive(message: Message): Promise<void>;

  // 发送消息
  tell(to: ActorRef, type: string, payload: any): void;

  // 创建子 Actor
  actorOf<T extends Actor>(actorClass: any, props: any): ActorRef;
}
```

## 三、与传统模型的对比

### 3.1 共享内存模型 vs Actor 模型

```
┌──────────────────────────────────────────────┐
│            传统共享内存模型                   │
├──────────────────────────────────────────────┤
│                                              │
│  Thread A ←─────┐                            │
│       │         │      竞态条件              │
│       ▼         ▼      死锁风险              │
│  ┌─────────────────────┐                     │
│  │   共享状态 (Memory)  │ ← 需要锁            │
│  └─────────────────────┘                     │
│       ▲         ▲      内存可见性问题        │
│       │         │                            │
│  Thread B ←─────┘                            │
│                                              │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│            Actor 模型                         │
├──────────────────────────────────────────────┤
│                                              │
│  Actor A                  Actor B            │
│  ┌────────┐               ┌────────┐         │
│  │ 状态 A │──msg──▶       │ 状态 B │         │
│  │ 邮箱 A │               │ 邮箱 B │         │
│  └────────┘               └────────┘         │
│                                              │
│  ✓ 无共享状态 → 无竞态                        │
│  ✓ 无锁 → 无死锁                             │
│  ✓ 消息传递 → 天然同步                        │
│                                              │
└──────────────────────────────────────────────┘
```

### 3.2 详细对比表

| 维度 | 共享内存模型 | Actor 模型 |
|------|------------|-----------|
| **状态访问** | 直接访问，需要锁 | 通过消息间接访问 |
| **并发控制** | 手动加锁 | 天然无锁 |
| **错误隔离** | 一个崩溃影响全局 | Actor 独立，故障隔离 |
| **调试难度** | 难（竞态条件不可预测） | 较易（消息顺序确定） |
| **分布式** | 需要复杂的同步机制 | 天然支持（位置透明） |

## 四、Actor 模型的核心特性

### 4.1 封装性

每个 Actor 的状态完全私有：

```typescript
class CounterActor extends Actor {
  private count = 0;  // 外部无法直接访问

  async receive(message: Message) {
    switch (message.type) {
      case 'increment':
        this.count++;  // 只能通过消息修改
        break;
      case 'get':
        this.reply(message, this.count);  // 只能通过消息读取
        break;
    }
  }
}

// 外部使用
counterActor.tell('increment', {});
// counterActor.count  // ❌ 编译错误：私有属性
```

### 4.2 异步消息传递

消息发送是异步的，发送者不等待：

```typescript
// 发送消息（立即返回）
actorA.tell('do_something', { data: '...' });

// 继续执行其他任务
doOtherWork();

// 结果通过回调处理
async receive(message: Message) {
  if (message.type === 'result') {
    handleResult(message.payload);
  }
}
```

### 4.3 位置透明性

代码不关心 Actor 在哪里：

```typescript
// 本地 Actor
const localActor = system.actorSelection("/user/main");

// 远程 Actor（代码完全一样）
const remoteActor = system.actorSelection("akka://system@remote:2552/user/main");

// 发送消息（完全透明）
localActor.tell('task', payload);
remoteActor.tell('task', payload);  // 代码不变
```

### 4.4 行为可变

Actor 可以在处理消息时改变自己的行为：

```typescript
class ConnectionActor extends Actor {
  private behavior = 'disconnected';

  async receive(message: Message) {
    switch (this.behavior) {
      case 'disconnected':
        if (message.type === 'connect') {
          await this.connect(message.payload);
          this.behavior = 'connected';  // 行为改变
        }
        break;

      case 'connected':
        if (message.type === 'send_data') {
          await this.sendData(message.payload);
        }
        break;
    }
  }
}
```

## 五、Actor 模型的数学基础

### 5.1 形式化定义

Actor 系统可以形式化定义为：

```
ActorSystem = (A, M, →)

其中：
- A 是 Actor 的集合
- M 是消息的集合
- → 是转换关系 (a, m) → (a', ms)
  - a: 处理消息前的 Actor 状态
  - m: 接收的消息
  - a': 处理消息后的 Actor 状态
  - ms: 发送出的消息序列
```

### 5.2 关键性质

1. **封装性**：Actor 状态只能被该 Actor 自己访问
2. **公平性**：发送的消息最终会被处理
3. **顺序性**：同一发送者的消息按顺序到达

## 六、为什么适合多 Agent 系统

### 6.1 本质同构

```
Actor 模型          多 Agent 系统
─────────────────        ─────────────────
Actor                    Agent
消息                     工具调用 / 结果
邮箱                     任务队列 / 结果队列
状态                     上下文窗口
子 Actor                 子 Agent
监督树                   任务层级
```

**这不是"类比"，这是本质上的同构。**

### 6.2 解决多 Agent 的核心问题

| 问题 | 传统方案 | Actor 方案 |
|------|---------|-----------|
| **上下文污染** | 手动隔离 | 天然隔离（Actor 独立状态） |
| **结果回流** | 轮询或遗忘 | 消息传递（有接收保证） |
| **生命周期管理** | 回调地狱 | 监督树（Supervision Tree） |
| **错误传播** | 全局崩溃 | 错误隔离 + 上报 |
| **分布式** | 复杂的 RPC | 透明（消息传递位置无关） |

### 6.3 具体映射

```typescript
// 多 Agent 系统中的概念映射到 Actor 模型

// 1. 主 Agent → 主 Actor
class MainAgentActor extends Actor {
  // 协调所有子任务
}

// 2. 子任务 → 子 Actor
class TaskActor extends Actor {
  // 执行具体任务
}

// 3. 任务派发 → 消息发送
mainActor.tell('dispatch_task', { type: 'explore', ... });

// 4. 结果回流 → 消息回调
taskActor.tell(parent, 'task_completed', result);

// 5. 错误处理 → 监督策略
supervisorStrategy = { onFailure: 'restart' }
```

## 七、与其他并发模型的对比

### 7.1 Actor vs CSP (Communicating Sequential Processes)

| 维度 | Actor | CSP |
|------|-------|-----|
| **通信方式** | 直接发送（知道接收者） | 通过 Channel（匿名） |
| **耦合度** | 较高（需要知道地址） | 较低（只需 Channel） |
| **适用场景** | 分布式系统 | 本地并发 |
| **代表实现** | Akka, Erlang | Go, Clojure core.async |

### 7.2 Actor vs async/await

| 维度 | Actor | async/await |
|------|-------|-------------|
| **思维模型** | 独立实体 + 消息 | 线性流程 + 中断点 |
| **状态管理** | Actor 内部封装 | 需要手动管理 |
| **错误处理** | 监督策略 | try/catch |
| **适用场景** | 复杂并发系统 | 简单异步操作 |

## 八、总结

### Actor 模型的核心价值

1. **理论完备**：有严格的数学定义，行为可预测
2. **无数据竞争**：没有共享状态，彻底消除竞态条件
3. **组合性强**：Actor 可以自由组合，构建复杂系统
4. **天然分布式**：位置透明性，无缝扩展

### 对多 Agent 系统的启示

多 Agent 系统本质上**就是** Actor 系统：

- Agent = Actor
- 工具调用 = 消息传递
- 子任务 = 子 Actor
- 错误处理 = 监督策略

**采用 Actor 模型不是"类比"，而是回归本质。**

## 参考资料

### 经典论文
- Carl Hewitt, et al. "A Universal Modular Actor Formalism for Artificial Intelligence" (1973)
- Gul Agha. "Actors: A Model of Concurrent Computation in Distributed Systems" (1986)

### 生产级框架
- [Akka](https://akka.io/) (Scala/Java): 最成熟的 Actor 框架
- [Erlang/OTP](https://www.erlang.org/): Actor 模型的工业实践
- [Orleans](https://dotnet.github.io/orleans/) (.NET): 虚拟 Actor 模型
- [Actix](https://actix.rs/) (Rust): 高性能 Actor 框架

### TypeScript/JavaScript 实现
- [Akka.js](https://github.com/akka-js/akka-js): Akka 的 TypeScript 移植
- [Nact](https://github.com/ncthbrt/nact): Node.js Actor 系统
