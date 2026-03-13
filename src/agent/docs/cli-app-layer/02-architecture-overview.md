# 02. 总体架构

## 1. 分层

- Kernel Layer：`StatelessAgent` 与工具内核。
- Application Layer：执行编排、状态流转、回调桥接。
- Port Layer：存储、上下文、事件、账本抽象。
- Adapter Layer：本地文件/SQLite、CLI 事件输出实现。
- Interface Layer：CLI 命令。

## 2. 依赖方向

仅允许：`CLI -> App -> Port -> Adapter`，以及 `App -> Kernel`。

禁止：
- CLI 直接依赖 Kernel 内部模块。
- Adapter 直接调用 Kernel。
- Kernel 反向依赖 App/Adapter。

## 3. 核心设计原则

- 单一职责：内核只执行，应用层只编排。
- 无状态优先：跨执行状态一律外置到存储。
- 事件源优先：`runStream` 事件作为事实源，读模型可重建。
- 双通道桥接：`runStream` + `tool_chunk`（桥接为 `tool_stream`）。
- 事件驱动：统一 `CliEvent`，屏蔽内核事件差异。
- 可替换：所有外部依赖通过 Port 注入。

## 4. 逻辑结构图

- `AgentAppService`：外部 Facade。
- `RunOrchestrator`：单次执行调度器。
- `ExecutionStorePort`：执行状态持久化。
- `ExecutionStepStorePort`：步骤级状态持久化。
- `EventStorePort`：事件事实源持久化。
- `MessageProjectionStorePort`：消息读模型投影。
- `CheckpointStorePort`：检查点持久化。
- `ConversationStorePort`：会话存在性与元信息读取。
- `EventSinkPort`：事件发布。
- `ContextProviderPort`：上下文加载。
