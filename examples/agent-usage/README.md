# Agent Usage Example

这个示例展示如何：
- 使用 `ProviderRegistry` 创建模型 Provider
- 使用环境变量创建全局 `MemoryManager` 与 `Logger`
- 使用同一个 `sessionId` 连续运行两轮 `agent.run(...)`，验证上下文恢复

## 运行前准备

1. 设置模型 API Key（示例以 `glm-4.7` 为默认）：

```bash
export GLM_API_KEY=your_key
```

2. 可选：设置运行时存储与日志（参考项目根目录 `.env.example`）：

```bash
export AGENT_STORAGE_BACKEND=file
export AGENT_STORAGE_DIR=./data/agent-memory
export AGENT_LOG_FILE_ENABLED=true
export AGENT_LOG_DIR=./logs
export AGENT_LOG_FILE=agent.log
export AGENT_LOG_LEVEL=INFO
```

> 说明：如果未显式设置日志变量，本示例会默认启用文件日志并写到
> `./examples/agent-usage/logs/agent-example.log`。

## 运行

```bash
pnpm example:agent
```

或传参：

```bash
pnpm example:agent glm-4.7 "初始化一个脚手架项目" "继续给我检查清单"
```

## 输出说明

- `First Run`：首轮回答
- `Second Run`：同 session 下的第二轮回答（会从存储恢复上下文）
- `Memory Summary`：展示历史消息数与存储路径
- 日志文件：默认在 `examples/agent-usage/logs/agent-example.log`
