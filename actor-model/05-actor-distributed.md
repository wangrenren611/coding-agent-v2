# Actor 分布式扩展

> 理解 Actor 模型如何实现分布式扩展，包括位置透明性、集群架构和故障转移。

## 一、位置透明性

### 1.1 核心概念

位置透明性是 Actor 模型的关键特性：**代码不关心 Actor 在哪里**。

```typescript
// 本地 Actor
const localActor = system.actorSelection("/user/main-agent");

// 远程 Actor（代码完全一样）
const remoteActor = system.actorSelection(
  "akka://system@remote-host:2552/user/main-agent"
);

// 发送消息（完全透明）
localActor.tell('task', payload);
remoteActor.tell('task', payload);  // 代码不变
```

### 1.2 Actor 路径

```
本地路径：
  /user/main-agent

远程路径：
  akka://coding-agent@192.168.1.10:2552/user/main-agent
  │      │             │            │    │
  │      │             │            │    └─ Actor 路径
  │      │             │            └─ 协议
  │      │             └─ 主机:端口
  │      └─ 系统名
  └─ 协议名
```

### 1.3 Actor 引用解析

```typescript
class ActorResolver {
  private localActors: Map<string, ActorRef>;
  private remoteNodes: Map<string, RemoteNode>;

  resolve(path: string): ActorRef {
    // 解析路径
    const parsed = this.parsePath(path);

    if (parsed.isLocal) {
      // 本地 Actor
      return this.localActors.get(parsed.localPath)!;
    } else {
      // 远程 Actor
      return this.resolveRemote(parsed);
    }
  }

  private resolveRemote(parsed: ParsedPath): ActorRef {
    const node = this.remoteNodes.get(parsed.address);
    if (!node) {
      throw new Error(`Unknown remote node: ${parsed.address}`);
    }

    // 返回远程 Actor 引用（代理）
    return new RemoteActorRef(
      node,
      parsed.localPath
    );
  }
}
```

## 二、集群架构

### 2.1 集群拓扑

```
┌─────────────────────────────────────────────────────┐
│                   Actor Cluster                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Node 1 (主节点)           Node 2 (工作节点)       │
│  ┌──────────────┐          ┌──────────────┐        │
│  │ Main Agent   │          │ Task Workers │        │
│  │ Orchestrator │◀──msg───▶│ Pool         │        │
│  └──────────────┘          └──────────────┘        │
│         │                          │                │
│         │                          │                │
│         ▼                          ▼                │
│  ┌────────────────────────────────────────┐        │
│  │         Cluster Router                 │        │
│  │  - 路由策略（轮询、随机、最少负载）     │        │
│  │  - 故障转移                            │        │
│  │  - 负载均衡                            │        │
│  └────────────────────────────────────────┘        │
│                                                     │
│  Node 3 (专用节点)                                  │
│  ┌──────────────┐                                  │
│  │ Research     │                                  │
│  │ Agent        │                                  │
│  └──────────────┘                                  │
└─────────────────────────────────────────────────────┘
```

### 2.2 节点角色

```typescript
enum NodeRole {
  Coordinator,  // 协调节点，运行 Main Agent
  Worker,       // 工作节点，运行 Task Actors
  Specialized,  // 专用节点，运行特定类型 Actor
  Proxy         // 代理节点，处理外部通信
}

interface ClusterNode {
  id: string;
  address: string;
  port: number;
  roles: NodeRole[];
  status: 'joining' | 'up' | 'leaving' | 'down' | 'removed';
  metrics: NodeMetrics;
}
```

### 2.3 集群配置

```typescript
interface ClusterConfig {
  // 节点配置
  node: {
    id: string;
    host: string;
    port: number;
    roles: NodeRole[];
  };

  // 种子节点（用于发现其他节点）
  seedNodes: string[];

  // 故障检测
  failureDetector: {
    heartbeatInterval: number;     // 心跳间隔 (ms)
    threshold: number;             // 失败阈值
    acceptableLostPing: number;    // 可接受的心跳丢失
  };

  // 下线策略
  downingProvider: 'auto-down' | 'manual' | 'quorum';

  // 分片配置（可选）
  sharding?: {
    numberOfShards: number;
    role: string;
  };
}

const config: ClusterConfig = {
  node: {
    id: 'node-1',
    host: '192.168.1.10',
    port: 2552,
    roles: [NodeRole.Coordinator, NodeRole.Worker]
  },
  seedNodes: [
    'akka://coding-agent@192.168.1.10:2552',
    'akka://coding-agent@192.168.1.11:2552'
  ],
  failureDetector: {
    heartbeatInterval: 1000,
    threshold: 10,
    acceptableLostPing: 3
  },
  downingProvider: 'auto-down'
};
```

## 三、路由策略

### 3.1 路由器类型

```typescript
// 1. 轮询路由 (Round Robin)
const roundRobinRouter = system.actorOf(
  RoundRobinPool.props({
    nrOfInstances: 5,
    childProps: TaskActor.props
  })
);
// 消息按顺序轮流发送

// 2. 随机路由 (Random)
const randomRouter = system.actorOf(
  RandomPool.props({
    nrOfInstances: 5,
    childProps: TaskActor.props
  })
);
// 随机选择目标

// 3. 最少负载路由 (Least Loaded)
const leastLoadedRouter = system.actorOf(
  LeastLoadedPool.props({
    nrOfInstances: 5,
    childProps: TaskActor.props
  })
);
// 选择当前负载最低的 Actor

// 4. 一致性哈希路由 (Consistent Hashing)
const consistentHashRouter = system.actorOf(
  ConsistentHashingPool.props({
    nrOfInstances: 5,
    hashMapping: (msg) => msg.taskId
  })
);
// 相同 key 的消息路由到同一 Actor
```

### 3.2 路由器实现

```typescript
abstract class Router {
  protected routees: ActorRef[] = [];

  abstract route(message: Message): ActorRef;

  addRoutee(actor: ActorRef): void {
    this.routees.push(actor);
  }

  removeRoutee(actor: ActorRef): void {
    this.routees = this.routees.filter(r => r !== actor);
  }
}

class RoundRobinRouter extends Router {
  private currentIndex = 0;

  route(message: Message): ActorRef {
    if (this.routees.length === 0) {
      throw new Error('No routees available');
    }

    const target = this.routees[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.routees.length;
    return target;
  }
}

class LeastLoadedRouter extends Router {
  private loads: Map<string, number> = new Map();

  route(message: Message): ActorRef {
    let minLoad = Infinity;
    let target: ActorRef | null = null;

    for (const routee of this.routees) {
      const load = this.loads.get(routee.path) || 0;
      if (load < minLoad) {
        minLoad = load;
        target = routee;
      }
    }

    return target!;
  }

  updateLoad(actorPath: string, load: number): void {
    this.loads.set(actorPath, load);
  }
}

class ConsistentHashingRouter extends Router {
  private virtualNodes: Map<string, ActorRef> = new Map();
  private virtualNodeCount = 100;

  constructor(routees: ActorRef[]) {
    super();
    this.routees = routees;
    this.buildVirtualNodes();
  }

  private buildVirtualNodes(): void {
    for (const routee of this.routees) {
      for (let i = 0; i < this.virtualNodeCount; i++) {
        const key = this.hash(`${routee.path}-${i}`);
        this.virtualNodes.set(key, routee);
      }
    }
  }

  route(message: Message): ActorRef {
    const key = this.hash(message.payload.taskId);

    // 找到最近的虚拟节点
    const sortedKeys = Array.from(this.virtualNodes.keys()).sort();
    for (const nodeKey of sortedKeys) {
      if (nodeKey >= key) {
        return this.virtualNodes.get(nodeKey)!;
      }
    }

    // 回环到第一个节点
    return this.virtualNodes.get(sortedKeys[0])!;
  }

  private hash(key: string): string {
    // 使用一致性哈希算法
    return crypto.createHash('md5').update(key).digest('hex');
  }
}
```

### 3.3 集群感知路由

```typescript
class ClusterAwareRouter extends Router {
  private cluster: Cluster;
  private targetRole: string;

  constructor(cluster: Cluster, targetRole: string) {
    super();
    this.cluster = cluster;
    this.targetRole = targetRole;
    this.updateRoutees();
  }

  private updateRoutees(): void {
    // 获取具有目标角色的所有节点上的 Actor
    const nodes = this.cluster.getNodesWithRole(this.targetRole);

    this.routees = nodes.flatMap(node => {
      return node.getActorsWithRole(this.targetRole);
    });
  }

  route(message: Message): ActorRef {
    if (this.routees.length === 0) {
      this.updateRoutees();  // 尝试刷新
    }

    return this.selectRoutee(message);
  }

  protected abstract selectRoutee(message: Message): ActorRef;
}
```

## 四、故障转移

### 4.1 节点故障检测

```typescript
class FailureDetector {
  private heartbeatInterval: number;
  private threshold: number;
  private nodes: Map<string, NodeState> = new Map();

  constructor(config: FailureDetectorConfig) {
    this.heartbeatInterval = config.heartbeatInterval;
    this.threshold = config.threshold;

    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    setInterval(() => {
      for (const [nodeId, state] of this.nodes) {
        this.checkNode(nodeId, state);
      }
    }, this.heartbeatInterval);
  }

  private checkNode(nodeId: string, state: NodeState): void {
    const timeSinceLastHeartbeat = Date.now() - state.lastHeartbeat;

    if (timeSinceLastHeartbeat > this.threshold) {
      // 标记节点为不可用
      state.status = 'unreachable';

      // 触发故障转移
      this.onNodeUnreachable(nodeId);
    }
  }

  receiveHeartbeat(nodeId: string): void {
    const state = this.nodes.get(nodeId);
    if (state) {
      state.lastHeartbeat = Date.now();
      state.status = 'reachable';
    }
  }

  private onNodeUnreachable(nodeId: string): void {
    console.warn(`Node ${nodeId} is unreachable`);

    // 通知集群管理器
    this.cluster.onNodeDown(nodeId);
  }
}
```

### 4.2 Actor 迁移

```typescript
class ActorMigrator {
  private cluster: Cluster;

  // 迁移 Actor 到新节点
  async migrateActor(
    actorPath: string,
    targetNode: ClusterNode
  ): Promise<void> {
    // 1. 获取当前 Actor 状态
    const actor = this.system.actorSelection(actorPath);
    const state = await actor.ask('get_state');

    // 2. 在目标节点创建新 Actor
    const remoteSystem = this.cluster.getRemoteSystem(targetNode);
    const newActor = await remoteSystem.actorOf(
      actor.constructor,
      {
        name: this.extractName(actorPath),
        initialState: state
      }
    );

    // 3. 转发未处理的消息
    const pendingMessages = actor.getPendingMessages();
    for (const msg of pendingMessages) {
      newActor.tell(msg.type, msg.payload);
    }

    // 4. 停止旧 Actor
    actor.stop();

    // 5. 更新路由表
    this.cluster.updateRouting(actorPath, newActor.path);
  }
}
```

### 4.3 单例模式

确保集群中只有一个 Actor 实例运行：

```typescript
class ClusterSingleton {
  private cluster: Cluster;
  private singletonRole: string;
  private currentSingleton: ActorRef | null = null;

  async start(): Promise<void> {
    // 尝试成为单例持有者
    await this.tryAcquireSingleton();

    // 监听集群事件
    this.cluster.on('member_down', (node) => {
      if (node.hasRole(this.singletonRole)) {
        // 单例节点下线，重新选举
        this.tryAcquireSingleton();
      }
    });
  }

  private async tryAcquireSingleton(): Promise<void> {
    // 使用分布式锁或 Leader 选举
    const acquired = await this.cluster.acquireLock(
      `singleton:${this.singletonRole}`,
      this.cluster.selfNode.id
    );

    if (acquired) {
      // 启动单例 Actor
      this.currentSingleton = this.system.actorOf(
        MainAgentActor,
        { name: 'singleton-main-agent' }
      );
    }
  }

  getSingleton(): ActorRef {
    if (this.currentSingleton) {
      return this.currentSingleton;
    }

    // 查找当前单例持有者
    const holder = this.cluster.getSingletonHolder(this.singletonRole);
    return this.system.actorSelection(
      `akka://${this.cluster.name}@${holder.address}/user/singleton-main-agent`
    );
  }
}
```

## 五、分布式数据

### 5.1 分布式数据复制

```typescript
enum ReplicationStrategy {
  WriteAll,     // 写所有节点
  WriteQuorum,  // 写大多数节点
  WriteOne,     // 写一个节点
  ReadAll,      // 读所有节点
  ReadQuorum,   // 读大多数节点
  ReadOne       // 读一个节点
}

class DistributedData {
  private cluster: Cluster;
  private replicationFactor: number;

  async write(key: string, value: any, strategy: ReplicationStrategy): Promise<void> {
    const nodes = this.selectReplicaNodes(key);

    switch (strategy) {
      case ReplicationStrategy.WriteAll:
        await Promise.all(
          nodes.map(node => node.write(key, value))
        );
        break;

      case ReplicationStrategy.WriteQuorum:
        const quorum = Math.floor(this.replicationFactor / 2) + 1;
        await this.writeQuorum(nodes, key, value, quorum);
        break;

      case ReplicationStrategy.WriteOne:
        await nodes[0].write(key, value);
        break;
    }
  }

  async read(key: string, strategy: ReplicationStrategy): Promise<any> {
    const nodes = this.selectReplicaNodes(key);

    switch (strategy) {
      case ReplicationStrategy.ReadQuorum:
        const quorum = Math.floor(this.replicationFactor / 2) + 1;
        return this.readQuorum(nodes, key, quorum);

      case ReplicationStrategy.ReadOne:
        return nodes[0].read(key);

      default:
        throw new Error('Not implemented');
    }
  }

  private async writeQuorum(
    nodes: ClusterNode[],
    key: string,
    value: any,
    quorum: number
  ): Promise<void> {
    let successCount = 0;

    await Promise.all(
      nodes.map(async (node) => {
        try {
          await node.write(key, value);
          successCount++;
        } catch (error) {
          console.warn(`Write failed on ${node.id}`);
        }
      })
    );

    if (successCount < quorum) {
      throw new Error('Write quorum not achieved');
    }
  }
}
```

### 5.2 CRDT (Conflict-Free Replicated Data Types)

```typescript
// G-Counter (Grow-only Counter)
class GCounter {
  private counts: Map<string, number> = new Map();
  private nodeId: string;

  increment(): void {
    const current = this.counts.get(this.nodeId) || 0;
    this.counts.set(this.nodeId, current + 1);
  }

  value(): number {
    let total = 0;
    for (const count of this.counts.values()) {
      total += count;
    }
    return total;
  }

  merge(other: GCounter): void {
    for (const [nodeId, count] of other.counts) {
      const localCount = this.counts.get(nodeId) || 0;
      this.counts.set(nodeId, Math.max(localCount, count));
    }
  }
}

// LWW-Register (Last-Writer-Wins Register)
class LWWRegister<T> {
  private value: T | null = null;
  private timestamp: number = 0;
  private nodeId: string;

  set(value: T): void {
    this.value = value;
    this.timestamp = Date.now();
  }

  get(): T | null {
    return this.value;
  }

  merge(other: LWWRegister<T>): void {
    if (other.timestamp > this.timestamp) {
      this.value = other.value;
      this.timestamp = other.timestamp;
    } else if (other.timestamp === this.timestamp) {
      // 时间戳相同，使用 nodeId 决定
      if (other.nodeId > this.nodeId) {
        this.value = other.value;
      }
    }
  }
}
```

## 六、序列化与远程通信

### 6.1 消息序列化

```typescript
interface MessageSerializer {
  serialize(message: Message): Buffer;
  deserialize(buffer: Buffer): Message;
}

class ProtobufSerializer implements MessageSerializer {
  private messageSchemas: Map<string, any> = new Map();

  registerSchema(messageType: string, schema: any): void {
    this.messageSchemas.set(messageType, schema);
  }

  serialize(message: Message): Buffer {
    const schema = this.messageSchemas.get(message.type);
    if (!schema) {
      throw new Error(`Unknown message type: ${message.type}`);
    }

    const payload = schema.encode(message.payload).finish();
    const header = Buffer.alloc(8);
    header.writeUInt32BE(message.type.length, 0);
    header.writeUInt32BE(payload.length, 4);

    return Buffer.concat([
      header,
      Buffer.from(message.type),
      payload
    ]);
  }

  deserialize(buffer: Buffer): Message {
    const typeLength = buffer.readUInt32BE(0);
    const payloadLength = buffer.readUInt32BE(4);

    const type = buffer.slice(8, 8 + typeLength).toString();
    const payloadBuffer = buffer.slice(8 + typeLength, 8 + typeLength + payloadLength);

    const schema = this.messageSchemas.get(type);
    const payload = schema.decode(payloadBuffer);

    return { type, payload };
  }
}
```

### 6.2 远程传输

```typescript
class RemoteTransport {
  private server: net.Server;
  private connections: Map<string, net.Socket> = new Map();
  private serializer: MessageSerializer;

  async start(port: number): Promise<void> {
    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    await new Promise<void>((resolve) => {
      this.server.listen(port, () => resolve());
    });
  }

  private handleConnection(socket: net.Socket): void {
    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;

    socket.on('data', (data) => {
      this.handleData(remoteAddress, data);
    });

    socket.on('close', () => {
      this.connections.delete(remoteAddress);
    });

    this.connections.set(remoteAddress, socket);
  }

  send(targetAddress: string, message: Message): void {
    const socket = this.connections.get(targetAddress);
    if (!socket) {
      throw new Error(`No connection to ${targetAddress}`);
    }

    const serialized = this.serializer.serialize(message);
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(serialized.length, 0);

    socket.write(Buffer.concat([lengthBuffer, serialized]));
  }

  private handleData(remoteAddress: string, data: Buffer): void {
    // 解析消息并路由到本地 Actor
    const message = this.serializer.deserialize(data);
    this.deliverToLocalActor(message);
  }
}
```

## 七、集群监控

### 7.1 集群状态监控

```typescript
class ClusterMonitor extends Actor {
  private cluster: Cluster;

  async receive(message: Message): Promise<void> {
    switch (message.type) {
      case 'get_cluster_state':
        this.reply(message, this.getClusterState());
        break;

      case 'get_node_metrics':
        this.reply(message, this.getNodeMetrics(message.payload.nodeId));
        break;
    }
  }

  private getClusterState(): ClusterState {
    return {
      members: this.cluster.getMembers().map(node => ({
        id: node.id,
        address: node.address,
        roles: node.roles,
        status: node.status,
        upSince: node.upSince
      })),
      unreachable: this.cluster.getUnreachable(),
      leader: this.cluster.getLeader(),
      selfNode: this.cluster.selfNode.id
    };
  }

  private getNodeMetrics(nodeId: string): NodeMetrics {
    const node = this.cluster.getNode(nodeId);
    return {
      cpuUsage: node.metrics.cpuUsage,
      memoryUsage: node.metrics.memoryUsage,
      actorCount: node.metrics.actorCount,
      messageRate: node.metrics.messageRate
    };
  }
}
```

### 7.2 健康检查

```typescript
class HealthCheckActor extends Actor {
  private cluster: Cluster;
  private checkInterval = 30000;

  async startHealthCheck(): Promise<void> {
    setInterval(async () => {
      await this.performHealthCheck();
    }, this.checkInterval);
  }

  private async performHealthCheck(): Promise<void> {
    const nodes = this.cluster.getMembers();

    for (const node of nodes) {
      try {
        // 发送健康检查消息
        const response = await this.askWithTimeout(
          node.getHealthActor(),
          'health_check',
          {},
          5000
        );

        if (!response.healthy) {
          this.handleUnhealthyNode(node, response);
        }
      } catch (error) {
        this.handleUnresponsiveNode(node);
      }
    }
  }

  private handleUnhealthyNode(node: ClusterNode, response: any): void {
    console.warn(`Node ${node.id} is unhealthy:`, response);
    // 可能需要隔离节点
  }

  private handleUnresponsiveNode(node: ClusterNode): void {
    console.error(`Node ${node.id} is not responding`);
    // 触发故障转移
    this.cluster.markAsDown(node.id);
  }
}
```

## 八、最佳实践

### 8.1 集群设计原则

1. **避免热点**：使用一致性哈希分散负载
2. **故障隔离**：每个节点可以独立故障
3. **渐进式降级**：部分节点故障不影响整体
4. **自动恢复**：节点恢复后自动加入集群

### 8.2 容量规划

```typescript
interface CapacityPlan {
  // 节点数量
  coordinatorNodes: number;  // 通常 1-3
  workerNodes: number;       // 根据负载决定

  // 每个 Worker 的容量
  actorsPerNode: number;
  messagesPerSecond: number;

  // 资源限制
  maxMemoryPerNode: string;
  maxCpuPerNode: number;
}

// 计算所需节点数
function calculateRequiredNodes(
  expectedLoad: LoadProfile
): CapacityPlan {
  const messagesPerNode = 1000;  // 每秒处理消息数
  const workerNodes = Math.ceil(
    expectedLoad.messagesPerSecond / messagesPerNode
  );

  return {
    coordinatorNodes: 1,
    workerNodes,
    actorsPerNode: 100,
    messagesPerSecond: messagesPerNode,
    maxMemoryPerNode: '4GB',
    maxCpuPerNode: 4
  };
}
```

### 8.3 部署建议

```yaml
# Kubernetes 部署示例
apiVersion: apps/v1
kind: Deployment
metadata:
  name: coding-agent-coordinator
spec:
  replicas: 1
  selector:
    matchLabels:
      role: coordinator
  template:
    spec:
      containers:
      - name: coordinator
        image: coding-agent:latest
        env:
        - name: NODE_ROLE
          value: coordinator
        - name: SEED_NODES
          value: "coordinator-0.coordinator:2552"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: coding-agent-worker
spec:
  replicas: 3
  selector:
    matchLabels:
      role: worker
  template:
    spec:
      containers:
      - name: worker
        image: coding-agent:latest
        env:
        - name: NODE_ROLE
          value: worker
        - name: SEED_NODES
          value: "coordinator-0.coordinator:2552"
```

## 九、总结

### 分布式 Actor 核心要点

1. **位置透明性**：代码不关心 Actor 位置
2. **集群管理**：节点发现、成员管理、故障检测
3. **路由策略**：轮询、随机、最少负载、一致性哈希
4. **故障转移**：自动检测、Actor 迁移、单例保护
5. **分布式数据**：复制策略、CRDT

### 下一步

- 阅读 [完整实现](./06-actor-implementation.md) 查看代码实现
- 阅读 [系统对比](./07-system-comparison.md) 了解与现有系统的对比
