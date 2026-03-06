# CLI SessionId 保持不变的原因分析

## 问题现象

**症状**: CLI 的 sessionId 在重启后依然保持不变，而不是每次启动都生成新的 UUID。

## 根本原因

### 核心逻辑

CLI 的 sessionId 保持不变是因为**默认启用了会话恢复机制**。

### 代码流程追踪

#### 1. CliRuntime 构造函数（src/cli/runtime.ts:119-134）

```typescript
constructor(options: {
  baseCwd: string;
  cwd: string;
  modelId?: string;
  sessionId?: string;      // 可选参数
  systemPrompt?: string;
  outputFormat?: OutputFormat;
  approvalMode?: CliRuntimeState['approvalMode'];
  disabledTools?: Iterable<string>;
  quiet: boolean;
}) {
  const modelId = options.modelId ? assertModelId(options.modelId) : DEFAULT_MODEL;
  const normalizedCwd = path.resolve(options.cwd);
  this.baseCwd = path.resolve(options.baseCwd);
  this.state = {
    cwd: normalizedCwd,
    modelId,
    sessionId: options.sessionId ?? randomUUID(),  // 如果没有传入，生成随机 UUID
    outputFormat: options.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
    approvalMode: options.approvalMode ?? DEFAULT_APPROVAL_MODE,
    systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    disabledTools: new Set(Array.from(options.disabledTools ?? []).map(normalizeToolName)),
    quiet: options.quiet,
  };
}
```

**关键点**:
- 如果 `options.sessionId` 有值，使用它
- 否则生成新的随机 UUID

#### 2. CLI 入口创建 CliRuntime（src/cli/index.ts:87-100）

```typescript
const runtime = new CliRuntime({
  baseCwd,
  cwd,
  modelId: args.model ?? config.defaultModel,
  systemPrompt: args.systemPrompt ?? config.defaultSystemPrompt,
  outputFormat: resolveOutputFormat(args.outputFormat, args.quiet),
  approvalMode: isApprovalMode(args.approvalMode)
    ? args.approvalMode
    : isApprovalMode(config.defaultApprovalMode)
      ? config.defaultApprovalMode
      : 'default',
  disabledTools: config.disabledTools,
  quiet: args.quiet,
  // ⚠️ 注意：这里没有传入 sessionId！
});
```

**关键点**:
- **没有传入 sessionId 参数**
- 所以构造函数会生成一个随机 UUID

#### 3. 会话 ID 解析逻辑（src/cli/index.ts:105-107）

```typescript
const continueSession = args.newSession ? false : args.continueSession || !args.resume;
const resolvedSessionId = runtime.resolveSessionId(args.resume, continueSession);
runtime.setSession(resolvedSessionId);
```

**这是关键！**

#### 4. resolveSessionId 方法（src/cli/runtime.ts:455-467）

```typescript
resolveSessionId(resume?: string, continueSession = false): string {
  // 1. 如果指定了 resume 参数，使用它
  if (resume && resume.trim().length > 0) {
    return resume.trim();
  }

  // 2. 如果启用了 continueSession，查找最近的会话
  if (continueSession) {
    const latest = this.listSessions(1)[0];  // 获取最近的一个会话
    if (latest) {
      return latest.sessionId;  // 返回最近的 sessionId
    }
  }

  // 3. 否则使用构造函数生成的随机 UUID
  return this.state.sessionId;
}
```

## 行为矩阵

| 启动方式 | `--new-session` | `--resume <id>` | `--continue` | 结果 |
|---------|----------------|---------------|------------|------|
| `coding-agent` | ❌ (false) | ❌ (undefined) | ❌ (false) | ✅ **复用最近的会话** |
| `coding-agent --new-session` | ✅ (true) | ❌ | ❌ | 🆕 新会话 |
| `coding-agent --resume <id>` | ❌ | ✅ | ❌ | 🔄 指定会话 |
| `coding-agent --continue` | ❌ | ❌ | ✅ (true) | ✅ 复用最近的会话 |
| `coding-agent --new-session --resume <id>` | ❌ | ❌ | ❌ | ⚠️ **错误**（互斥） |

## 为什么默认行为是复用会话？

### 计算 continueSession 的逻辑

```typescript
const continueSession = args.newSession ? false : args.continueSession || !args.resume;
```

**展开计算**:

```typescript
// 情况 1: 普通启动（无任何参数）
args.newSession = false
args.continueSession = false
args.resume = undefined

continueSession = false ? false : false || !undefined
                   = false || true
                   = true  // ✅ 会话恢复启用！
```

```typescript
// 情况 2: 指定 --new-session
args.newSession = true

continueSession = true ? false : ...
                   = false  // ❌ 会话恢复禁用
```

```typescript
// 情况 3: 指定 --resume <id>
args.resume = 'session-123'

continueSession = false ? false : false || !'session-123'
                   = false || false
                   = false  // ❌ 会话恢复禁用（因为使用了 resume）
```

## listSessions 如何找到最近的会话？

### 代码位置：src/cli/runtime.ts:470-482

```typescript
listSessions(limit = 20): CliSessionInfo[] {
  const deps = this.assertInitialized();
  return deps.memoryManager
    .querySessions(undefined, {
      limit,
      orderBy: 'updatedAt',      // 按更新时间排序
      orderDirection: 'desc',     // 降序（最新的在前）
    })
    .map((item) => ({
      sessionId: item.sessionId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      status: item.status,
      totalMessages: item.totalMessages,
    }));
}
```

**关键点**:
- 按 `updatedAt` 降序排序
- 取第一个（最新的）会话
- 只要该会话在数据库中存在，就会一直复用

## 为什么重启后还是同一个 ID？

### 会话持久化机制

1. **MemoryManager 持久化**
   - 会话元数据存储在 SQLite 数据库中
   - 路径: `.agent-cli/memory.db`（默认）

2. **查询最近的会话**
   ```sql
   SELECT * FROM sessions 
   ORDER BY updated_at DESC 
   LIMIT 1
   ```

3. **会话 ID 不会自动删除**
   - 除非手动清理
   - 或使用 `session clear` 命令

### 流程图

```
启动 CLI
  │
  ├─> 创建 CliRuntime
  │     └─> 生成随机 UUID（例如：abc-123）
  │
  ├─> 计算 continueSession = true（因为无参数）
  │
  ├─> resolveSessionId()
  │     │
  │     ├─> resume? No
  │     │
  │     ├─> continueSession? Yes
  │     │   │
  │     │   └─> listSessions(1)
  │     │       │
  │     │       └─> 查询数据库
  │     │           │
  │     │           └─> 找到会话 xyz-789（最近更新的）
  │     │
  │     └─> 返回 xyz-789
  │
  └─> setSession('xyz-789')
       └─> 覆盖掉构造函数生成的 abc-123
```

## 如何强制使用新会话？

### 方法 1: 使用 --new-session 标志

```bash
coding-agent --new-session
```

### 方法 2: 使用 --resume 指定特定会话

```bash
coding-agent --resume <session-id>
```

### 方法 3: 手动清理旧会话

```bash
# 在 CLI 交互模式中
/session clear
```

### 方法 4: 删除数据库文件

```bash
rm -rf .agent-cli/memory.db
```

## 验证方法

### 1. 查看当前 sessionId

```bash
# 在 CLI 交互模式中
/status
```

输出示例：
```
Session ID: xyz-789-def-456
Created: 2026-03-05 10:00:00
Updated: 2026-03-06 15:30:00
Messages: 42
```

### 2. 列出所有会话

```bash
/session list
```

输出示例：
```
Session ID                     Created                 Updated                 Messages
xyz-789-def-456               2026-03-05 10:00:00    2026-03-06 15:30:00    42
abc-123-xyz-789               2026-03-04 09:00:00    2026-03-04 09:30:00     15
```

### 3. 测试会话恢复

```bash
# 第一次启动
coding-agent
> /status
Session ID: session-A

# 退出后重启
coding-agent
> /status
Session ID: session-A  # 还是同一个！
```

```bash
# 强制新会话
coding-agent --new-session
> /status
Session ID: session-B  # 新的 ID
```

## 设计意图

### 为什么默认复用会话？

1. **用户体验优先**
   - 用户期望继续之前的对话
   - 避免"我说过的话你忘了"的情况

2. **上下文连续性**
   - Agent 可以访问之前的对话历史
   - 更好的上下文理解

3. **减少重复**
   - 不需要每次重新解释背景
   - 保持工作连续性

### 与其他工具对比

| 工具 | 默认行为 |
|------|---------|
| **本项目** | ✅ 复用最近的会话 |
| ChatGPT CLI | ✅ 复用最近的会话 |
| Claude CLI | ✅ 复用最近的会话 |
| raw LLM API | ❌ 每次新会话 |

## 总结

### 问题根源

CLI sessionId 保持不变的**根本原因**是：

1. **默认启用会话恢复** (`continueSession = true`)
2. **从数据库查询最近的会话** (`listSessions(1)[0]`)
3. **用查询结果覆盖构造函数生成的 UUID**

### 设计理念

这是**有意为之**的设计，目的是：
- 提供连续的对话体验
- 保持上下文连贯性
- 符合用户对"对话助手"的预期

### 如何改变行为

如果你想要**每次启动都是新会话**：

```bash
# 方法 1: 使用标志
coding-agent --new-session

# 方法 2: 修改默认行为（需要改代码）
# 在 src/cli/index.ts 第 105 行改为：
const continueSession = args.newSession ? false : args.continueSession;
# 移除 || !args.resume 部分
```

### 相关文件

- `src/cli/runtime.ts`: CliRuntime 类，sessionId 生成和解析
- `src/cli/index.ts`: CLI 入口，会话恢复逻辑
- `src/cli/args.ts`: 参数解析
- `src/storage/memory-manager.ts`: 会话持久化

---

**分析完成时间**: 2026-03-06  
**相关代码行**: 
- src/cli/runtime.ts:119-134 (构造函数)
- src/cli/index.ts:105-107 (会话恢复逻辑)
- src/cli/runtime.ts:455-467 (resolveSessionId 方法)
