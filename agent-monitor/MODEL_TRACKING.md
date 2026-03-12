# 模型 Token 使用追踪

## 当前状态

⚠️ **注意**: 当前数据库 (`~/.agent-v4/agent.db`) 中的 `messages` 表**没有直接存储模型名称**字段。

### 现有数据结构

```sql
CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  step_index INTEGER,
  role TEXT NOT NULL,
  type TEXT NOT NULL,
  content_json TEXT NOT NULL,      -- 消息内容
  reasoning_content TEXT,
  tool_call_id TEXT,
  tool_calls_json TEXT,
  usage_json TEXT,                  -- Token 使用量
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL
);
```

`usage_json` 字段包含 Token 使用量，但**不包含模型信息**：
```json
{
  "prompt_tokens": 7552,
  "completion_tokens": 40,
  "total_tokens": 7592,
  "completion_tokens_details": {
    "reasoning_tokens": 27,
    "text_tokens": 40
  }
}
```

## 可用的统计功能

### 1. 按执行 ID 分组 (`/api/models?type=by-execution`)

显示每个运行的 Token 使用情况：

```json
{
  "byExecution": [
    {
      "execution_id": "exec_1773285505464_my7b1cge6",
      "total_tokens": 2062743,
      "prompt_tokens": 2056001,
      "completion_tokens": 6742,
      "message_count": 15,
      "status": "RUNNING",
      "created_at_ms": 1773285505464
    }
  ]
}
```

### 2. 按模型分组 (`/api/models`)

当前由于缺少模型信息，所有记录都归类为 `"unknown"`。

## 改进建议

### 方案 1: 修改数据库结构 (推荐)

在 `messages` 表中添加 `model` 字段：

```sql
ALTER TABLE messages ADD COLUMN model TEXT;
```

然后在插入消息时记录模型信息：

```typescript
db.prepare(`
  INSERT INTO messages (..., model, usage_json, ...)
  VALUES (?, ?, ?, ..., ?, ?, ...)
`).run(..., modelId, JSON.stringify(usage), ...);
```

### 方案 2: 从 content_json 中提取

如果模型信息存储在 `content_json` 中，可以更新查询逻辑：

```typescript
const model = JSON.parse(msg.content_json)?.model || 'unknown';
```

### 方案 3: 关联 runs 表

在 `runs` 表中添加模型字段，然后通过 `execution_id` 关联：

```sql
ALTER TABLE runs ADD COLUMN model TEXT;
```

## 临时解决方案

目前可以通过以下方式查看模型使用情况：

1. **查看运行详情**: 在运行详情页面查看具体执行的 Token 使用
2. **按执行分组**: 使用 `/api/models?type=by-execution` 查看每个运行的统计
3. **环境变量**: 检查 `AGENT_MODEL` 环境变量了解默认使用的模型

```bash
# 查看当前配置的模型
echo $AGENT_MODEL

# 查看可用模型
sqlite3 ~/.agent-v4/agent.db "SELECT DISTINCT json_extract(content_json, '$.model') FROM messages WHERE content_json IS NOT NULL;"
```

## 未来改进

计划在 agent-v4 中添加模型追踪功能：

1. 在每次 API 调用时记录模型 ID
2. 在数据库中添加模型字段
3. 在监控界面中添加模型筛选和统计
4. 支持按模型、时间范围、状态等多维度统计

## 相关 API

| 端点 | 描述 |
|------|------|
| `GET /api/models` | 按模型分组的 Token 统计 |
| `GET /api/models?type=by-execution` | 按执行分组的 Token 统计 |
| `GET /api/stats` | 总体统计 |
| `GET /api/stats?type=daily` | 每日 Token 使用趋势 |

## 联系

如需添加模型追踪功能，请修改：
- `src/agent-v4/agent/index.ts` - 记录模型信息到数据库
- `lib/db.ts` - 添加模型字段查询
- `app/api/models/route.ts` - 改进模型统计逻辑
