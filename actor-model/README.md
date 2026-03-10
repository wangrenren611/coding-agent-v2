# Actor 模型与多 Agent 系统设计

> 本系列文档深入讲解如何使用 Actor 模型构建多 Agent 系统，解决结果回流、错误隔离、分布式扩展等核心问题。

## 文档索引

| 文档 | 内容 | 适合读者 |
|------|------|---------|
| [01-理论基础](./01-actor-model-theory.md) | Actor 模型的起源、核心概念、与传统模型的对比 | 所有读者 |
| [02-架构设计](./02-actor-architecture.md) | 多 Agent 系统的 Actor 架构设计、核心 Actor 类型 | 架构师 |
| [03-消息传递](./03-actor-messaging.md) | 消息类型、投递保证、顺序保证 | 开发者 |
| [04-监督策略](./04-actor-supervision.md) | 错误处理、容错机制、监督树 | 开发者 |
| [05-分布式扩展](./05-actor-distributed.md) | 位置透明性、集群架构、路由策略、故障转移 | 架构师 |
| [06-完整实现](./06-actor-implementation.md) | 基于 TypeScript 的完整 Actor 系统实现 | 开发者 |
| [07-系统对比](./07-system-comparison.md) | 与当前 Task 系统的对比、迁移路径 | 决策者 |

## 核心观点

### 多 Agent 架构的真实定位

多 Agent 架构的价值，**不在于"更多脑子"**，而在于：

1. **上下文隔离**：主 agent 保留"解决什么"，子 agent 只有"怎么做"
2. **时间隔离**：长任务不绑死主循环
3. **能力隔离**：不同 agent 有不同工具白名单
4. **故障隔离**：子 agent 失败不拖垮主 agent
5. **工作流显式化**：派发、跟踪、收集、合并

### 为什么选择 Actor 模型

Actor 模型与多 Agent 系统存在**本质同构**：

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

### 解决的核心问题

| 问题 | 传统方案 | Actor 方案 |
|------|---------|-----------|
| 上下文污染 | 手动隔离 | 天然隔离（Actor 独立状态） |
| 结果回流 | 轮询或遗忘 | 消息传递（有接收保证） |
| 生命周期管理 | 回调地狱 | 监督树 |
| 错误传播 | 全局崩溃 | 错误隔离 + 上报 |
| 分布式 | 复杂的 RPC | 透明（消息传递位置无关） |

## 快速开始

### 最小示例

```typescript
// 创建 Actor 系统
const system = new ActorSystem('coding-agent');

// 创建 Main Agent
const mainAgent = system.actorOf(MainAgentActor, {
  name: 'main-agent'
});

// 发送用户输入
mainAgent.tell('user_input', '帮我优化这个 API');

// 结果通过消息自动回流
// 无需轮询，不会遗忘
```

### 与当前系统对比

**当前（Task 工具）**：
```typescript
const taskId = await Task({ /* ... */ });
const result = await TaskOutput({ task_id: taskId }); // 需要主动轮询
```

**Actor 模型**：
```typescript
const taskActor = this.actorOf(TaskActor, { /* ... */ });
// 结果通过 handleTaskCompleted() 消息自动到达
```

## 进一步阅读

- [Akka 官方文档](https://akka.io/docs/)
- [Erlang/OTP 设计原则](https://www.erlang.org/doc/design_principles/users_guide.html)
- Carl Hewitt, "A Universal Modular Actor Formalism for Artificial Intelligence" (1973)
