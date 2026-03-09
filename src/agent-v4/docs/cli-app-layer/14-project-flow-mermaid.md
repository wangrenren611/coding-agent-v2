# 14. 项目流程图（Mermaid，详细版）

本文给出 CLI 应用层基于 `StatelessAgent` 的完整流程图，重点回答：

- 什么时候做什么
- 每一步写哪些表
- 终态如何收敛
- 异步索引何时触发

---

## 1. 端到端总流程（含命令分支）

```mermaid
flowchart TD
  A["CLI Process Start"] --> B["Load Config + Init Ports/Adapters"]
  B --> C{"Command Type?"}

  C -->|"agent run"| D["Resolve conversationId/executionId"]
  C -->|"agent run-status"| Q1["Query runs by executionId"]
  C -->|"agent run-list"| Q2["Query runs by conversationId"]

  Q1 --> Q3["Render status output"]
  Q2 --> Q4["Render run list output"]
  Q3 --> Z["Exit"]
  Q4 --> Z

  D --> E["ExecutionStore.create status=CREATED"]
  E --> F["EventStore.append user_message event"]
  F --> G["MessageProjection.upsertFromEvent"]
  G --> H["ExecutionStore.patch status=RUNNING"]
  H --> I["Build AgentInput and start runStream"]
  I --> I1["Listen agent tool_chunk emitter"]
  I1 --> I2["Normalize tool_chunk -> tool_stream envelope"]
  I2 --> K["EventStore.append(event envelope)"]

  I --> J{"Stream Event Received?"}
  J -->|"chunk/reasoning_chunk/tool_call/progress/checkpoint/compaction/tool_result"| K["EventStore.append(event envelope)"]
  J -->|"done"| K1["EventStore.append(done event)"]
  J -->|"error"| K2["EventStore.append(error event)"]
  K --> L["EventSink.publish to CLI"]
  K1 --> L1["EventSink.publish done"]
  K2 --> L2["EventSink.publish error"]
  L --> M{"Need Projection/State Update?"}

  M -->|"message-like event"| N["MessageProjection.upsertFromEvent"]
  M -->|"progress"| O["ExecutionStore.patch stepIndex"]
  M -->|"checkpoint"| P["CheckpointStore.save + patch stepIndex"]
  M -->|"compaction"| R["SummaryStore.append (if enabled)"]
  M -->|"no"| S["Continue stream loop"]

  N --> S
  O --> S
  P --> S
  R --> S
  S --> J

  L1 --> T["Map done.finishReason -> COMPLETED"]
  L2 --> U["Map errorCode -> FAILED/CANCELLED + terminalReason"]

  T --> V["ExecutionStore.patch terminal fields + completedAt"]
  U --> V
  V --> W["Optional RunLogStore.append warn/error"]
  W --> X["Trigger async indexing job"]
  X --> Y["Render final summary to CLI"]
  Y --> Z
```

---

## 2. 运行时序图（谁在什么时候做什么）

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant CLI as CLI Command
  participant App as AgentAppService
  participant Orch as RunOrchestrator
  participant Agent as StatelessAgent.runStream
  participant Exec as ExecutionStore
  participant Event as EventStore
  participant Proj as MessageProjectionStore
  participant Sum as SummaryStore
  participant Ckpt as CheckpointStore
  participant Sink as EventSink(CLI)
  participant Log as RunLogStore
  participant Idx as Indexer

  User->>CLI: agent run --conversation --message
  CLI->>App: runForeground(request)
  App->>Orch: start(request)
  Orch->>Exec: create(CREATED)
  Orch->>Event: append(user_message)
  Orch->>Proj: upsertFromEvent(user_message)
  Orch->>Exec: patch(RUNNING)
  Orch->>Agent: runStream(input)

  loop For each StreamEvent
    Agent-->>Orch: event(type,data)
    Orch->>Event: append(event envelope)
    Orch->>Sink: publish(event)
    alt event=progress
      Orch->>Exec: patch(stepIndex)
    else event=checkpoint
      Orch->>Ckpt: save(checkpoint)
      Orch->>Exec: patch(stepIndex)
    else event=chunk/reasoning_chunk/tool_call/tool_result
      Orch->>Proj: upsertFromEvent(event)
    else event=compaction
      Orch->>Sum: append(summary projection)
    end
  end

  par Tool chunk bridge
    Agent-->>Orch: emit(tool_chunk)
    Orch->>Event: append(tool_stream envelope)
    Orch->>Sink: publish(tool_stream)
  end

  alt Terminal done
    Orch->>Exec: patch(status=COMPLETED, terminalReason)
    Orch->>Log: append(info sampled)
  else Terminal error
    Orch->>Exec: patch(status=FAILED/CANCELLED, terminalReason,errorCode)
    Orch->>Log: append(warn/error)
  end

  Orch->>Idx: enqueue/reindex(conversation scope)
  Orch-->>App: RunResult
  App-->>CLI: Final output
  CLI-->>User: Exit
```

---

## 3. 执行状态机（终止语义）

```mermaid
stateDiagram-v2
  [*] --> CREATED
  CREATED --> RUNNING: run started
  RUNNING --> COMPLETED: done(stop|max_steps)
  RUNNING --> FAILED: error(timeout|max_retries|other)
  RUNNING --> CANCELLED: error(AGENT_ABORTED)
  COMPLETED --> [*]
  FAILED --> [*]
  CANCELLED --> [*]
```

---

## 4. 触发点 -> 动作 -> 写表（详细）

| 阶段 | 触发点 | 动作 | 主要写表 |
|---|---|---|---|
| 初始化 | `agent run` 启动 | 建立运行记录 | `runs` |
| 输入入库 | 用户消息进入 | 写事实事件并更新投影 | `events`, `messages` |
| 进入运行 | runStream 开始 | 状态置为运行中 | `runs` |
| 流式过程 | 每个 stream event | 先写事件，再发布到 CLI | `events` |
| 工具流桥接 | `tool_chunk` emitter | 归一化为 `tool_stream` 并发布 | `events` |
| 过程同步 | `progress` | 更新 stepIndex | `runs` |
| 过程同步 | `checkpoint` | 保存断点与步数 | `checkpoints`, `runs` |
| 消息投影 | `chunk/reasoning/tool_*` | 更新消息读模型 | `messages` |
| 压缩阶段 | `compaction` | 事件已在统一入口落库，此处仅落摘要（若启用） | `summaries` |
| 工具幂等 | tool executeOnce | 防重放副作用 | `tool_ledger` |
| 错误诊断 | warn/error | 记录技术日志（可选） | `run_logs` |
| 终态收敛 | `done/error` | 写终态、终止原因、错误包 | `runs` |
| 后台索引 | run 结束后异步 | 更新检索索引 | `files`, `chunks`, `chunks_fts`, `chunks_vec`, `embedding_cache` |

---

## 5. 异步索引流程（run 结束后）

```mermaid
flowchart LR
  A["Run Terminal"] --> B["Collect changed message ranges"]
  B --> C["Materialize virtual files: conversation/{id}/seq-range"]
  C --> D["Chunking text"]
  D --> E["Embedding compute (with embedding_cache lookup)"]
  E --> F["Upsert files + chunks"]
  F --> G{"FTS enabled?"}
  G -->|"Yes"| H["Upsert chunks_fts"]
  G -->|"No"| I["Skip FTS"]
  H --> J{"Vector enabled?"}
  I --> J
  J -->|"Yes"| K["Upsert chunks_vec"]
  J -->|"No"| L["Skip Vec"]
  K --> M["Index done"]
  L --> M
```

---

## 6. 落地顺序建议（与流程图一致）

1. 先实现运行主链路：`runs + events + messages + checkpoints`  
2. 再接入 `tool_ledger`（幂等）与 `run_logs`（可选）  
3. 最后实现异步索引链路：`files/chunks/fts/vec/cache`

---

## 7. 单次 `agent run` 详细时间线（何时写什么）

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant CLI as CLI
  participant App as AppService
  participant Orch as RunOrchestrator
  participant Agent as StatelessAgent
  participant DB as SQLite(agent.db)
  participant Worker as Index Worker

  User->>CLI: 输入命令与用户消息
  CLI->>App: runForeground(request)
  App->>Orch: start(request)

  Orch->>DB: INSERT runs(status=CREATED)
  Note over DB: 表: runs

  Orch->>DB: INSERT events(type=user_message, seq=1)
  Orch->>DB: UPSERT messages(投影用户消息)
  Note over DB: 表: events, messages

  Orch->>DB: UPDATE runs(status=RUNNING, started_at)
  Orch->>Agent: runStream(input)

  loop 每个 StreamEvent
    Agent-->>Orch: event(type, payload)
    Orch->>DB: INSERT events(seq+1, event envelope)
    alt type = chunk/reasoning_chunk/tool_call/tool_result
      Orch->>DB: UPSERT messages(assistant/tool 投影)
      Note over DB: 表: messages
    else type = progress
      Orch->>DB: UPDATE runs(step_index)
      Note over DB: 表: runs
    else type = checkpoint
      Orch->>DB: INSERT checkpoints(step, blob)
      Orch->>DB: UPDATE runs(last_checkpoint_seq, step_index)
      Note over DB: 表: checkpoints, runs
    else type = compaction
      Orch->>DB: INSERT summaries(覆盖区间、版本、token)
      Note over DB: 表: summaries（compaction 事件已在统一入口写入 events）
    else type = tool_call + tool_result(副作用工具)
      Orch->>DB: UPSERT tool_ledger(idempotency_key,status,pending_expires_at_ms)
      Note over DB: 表: tool_ledger
    end
  end

  alt Terminal = done
    Orch->>DB: UPDATE runs(status=COMPLETED, terminal_reason, completed_at)
  else Terminal = error
    Orch->>DB: UPDATE runs(status=FAILED/CANCELLED, terminal_reason, error_code, completed_at)
    Orch->>DB: INSERT run_logs(level=warn/error, message)
    Note over DB: 表: run_logs
  end

  Orch->>Worker: 触发异步索引任务(conversation scope)
  Worker->>DB: UPSERT files/chunks/chunks_fts/chunks_vec/embedding_cache
  Note over DB: 表: files, chunks, chunks_fts, chunks_vec, embedding_cache

  App-->>CLI: 返回 RunResult + 最终摘要
  CLI-->>User: 渲染退出
```

---

## 8. 失败重试与恢复执行（`agent resume`）

说明：
- **单次 run 内重试**由内核处理（`terminalReason=max_retries` 表示内核预算耗尽）。
- **跨 run 恢复**由 CLI 应用层处理（`agent resume` 创建新 `run_id`）。

### 8.1 恢复决策流程（何时恢复、何时冷启动）

```mermaid
flowchart TD
  A["Trigger: agent resume or retry policy"] --> B["Load previous run + context facts"]
  B --> B1["Read runs/events/messages/summaries/checkpoints"]
  B1 --> C{"Recoverable state exists?"}

  C -->|"No"| D["Create new run as cold start"]
  C -->|"Yes"| E["Pick restore point from checkpoint/seq"]

  D --> F["Build AgentInput from latest context window"]
  E --> F1["Build AgentInput from restore point + delta"]
  F1 --> F

  F --> G["INSERT runs(status=created)"]
  G --> H["INSERT events(type=resume_requested)"]
  H --> I["UPDATE runs(status=running, started_at)"]
  I --> J["Start runStream"]

  J --> K{"Terminal?"}
  K -->|"done(stop|max_steps)"| L["UPDATE runs -> completed"]
  K -->|"error(aborted/timeout/max_retries/other)"| M["UPDATE runs -> failed/cancelled + error_json"]

  L --> N["Trigger async indexing + return summary"]
  M --> O["INSERT run_logs(warn/error)"]
  O --> P{"Retryable and budget left?"}
  P -->|"Yes"| Q["Suggest next resume (new run)"]
  P -->|"No"| R["Stop and surface error"]
```

### 8.2 恢复执行时序（写表顺序）

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant CLI as CLI
  participant App as AppService
  participant DB as SQLite(agent.db)
  participant Agent as StatelessAgent
  participant Worker as Index Worker

  User->>CLI: agent resume --conversation <id>
  CLI->>App: resumeForeground(request)

  App->>DB: SELECT runs(最近终态)
  App->>DB: SELECT checkpoints(最新可用断点)
  App->>DB: SELECT messages/summaries(恢复上下文)
  App->>App: 计算 restore point 与输入窗口

  App->>DB: INSERT runs(status=CREATED, request_json含resume来源)
  App->>DB: INSERT events(type=resume_requested)
  App->>DB: UPDATE runs(status=RUNNING)
  App->>Agent: runStream(input)

  loop 每个 StreamEvent
    Agent-->>App: event(type, payload)
    App->>DB: INSERT events(event envelope)
    alt type = chunk/reasoning_chunk/tool_call/tool_result
      App->>DB: UPSERT messages
    else type = progress
      App->>DB: UPDATE runs(step_index)
    else type = checkpoint
      App->>DB: INSERT checkpoints
      App->>DB: UPDATE runs(last_checkpoint_seq, step_index)
    else type = compaction
      App->>DB: INSERT summaries
    end
  end

  alt done
    App->>DB: UPDATE runs(status=COMPLETED, terminal_reason, completed_at)
    App->>Worker: 触发索引更新
  else error
    App->>DB: UPDATE runs(status=FAILED/CANCELLED, terminal_reason, error_json, completed_at)
    App->>DB: INSERT run_logs(level=warn/error)
  end

  App-->>CLI: ResumeResult
  CLI-->>User: 输出恢复结果
```

---

## 9. 并发冲突与幂等（`tool_ledger` 原子化）

目标：
- 同一 `run_id + tool_call_id` 在并发情况下只允许一次副作用执行。
- 其余并发请求返回已存在结果或等待执行完成。

### 9.1 `executeOnce` 原子流程（推荐实现）

```mermaid
flowchart TD
  A["Receive tool_call(run_id, tool_call_id)"] --> B["BEGIN IMMEDIATE TRANSACTION"]
  B --> C{"INSERT tool_ledger(status='pending', pending_expires_at_ms) success?"}

  C -->|"Yes (winner)"| D["Commit lock row"]
  D --> E["Execute side-effect tool once"]
  E --> F["BEGIN IMMEDIATE TRANSACTION"]
  F --> G["UPDATE tool_ledger SET status='success/failed', result_json, updated_at_ms"]
  G --> H["COMMIT"]
  H --> I["Return fresh tool_result"]

  C -->|"No (conflict)"| J["SELECT existing ledger row"]
  J --> K{"status is success/failed?"}
  K -->|"Yes"| L["Return stored result_json directly"]
  K -->|"No (pending)"| M["Backoff + poll by key；若 pending 过期可抢占"]
  M --> N{"Reached timeout?"}
  N -->|"No"| J
  N -->|"Yes"| O["Return retryable timeout error"]
```

### 9.2 两个并发请求竞争同一工具调用

```mermaid
sequenceDiagram
  autonumber
  participant W1 as Worker-1
  participant W2 as Worker-2
  participant DB as SQLite tool_ledger
  participant Tool as Side-effect Tool

  W1->>DB: BEGIN IMMEDIATE + INSERT (run_id,tool_call_id,status=pending,pending_expires_at_ms)
  DB-->>W1: OK (winner)

  W2->>DB: BEGIN IMMEDIATE + INSERT same key
  DB-->>W2: UNIQUE CONFLICT
  W2->>DB: SELECT by (run_id,tool_call_id)
  DB-->>W2: status=pending
  W2->>W2: backoff polling

  W1->>Tool: execute()
  Tool-->>W1: result/error
  W1->>DB: UPDATE status=success/failed, result_json, updated_at_ms
  DB-->>W1: committed

  W2->>DB: SELECT by key (after backoff)
  DB-->>W2: status=success/failed + result_json
  W2-->>W2: return stored result (no second execution)
```

### 9.3 触发点 -> 动作 -> 写表（幂等专题）

| 场景 | 触发点 | 动作 | 写表 |
|---|---|---|---|
| 首次执行 | 未命中账本 | 插入 `pending + pending_expires_at_ms` 占位并成为执行者 | `tool_ledger` |
| 并发冲突 | 主键冲突 | 读取已有记录；若 `pending` 则轮询或按过期租约抢占 | `tool_ledger` |
| 执行成功 | 工具返回成功 | 更新状态为 `success` 并落结果 | `tool_ledger` |
| 执行失败 | 工具返回失败 | 更新状态为 `failed` 并落错误包 | `tool_ledger` |
| 读取复用 | 命中 `success/failed` | 直接返回已有 `result_json` | 仅读取 |
| 轮询超时 | 长时间 `pending` | 返回可重试错误并记日志 | `run_logs`（可选） |

### 9.4 与主流程的拼接点

```mermaid
flowchart LR
  A["Stream event: tool_call"] --> B["IdempotentExecutor.executeOnce"]
  B --> C{"winner?"}
  C -->|"Yes"| D["真实执行工具 + 回写 ledger"]
  C -->|"No"| E["读取/等待 ledger 结果"]
  D --> F["Emit tool_result event"]
  E --> F
  F --> G["EventStore.append + MessageProjection.upsert"]
```

---

## 10. 终态分流与 CLI 输出策略

### 10.1 终态分流（`done/error` -> 状态/退出码/展示）

```mermaid
flowchart TD
  A["Receive terminal stream event"] --> A1["INSERT events(type=done/error)"]
  A1 --> B{"event.type"}

  B -->|"done"| C{"finishReason"}
  C -->|"stop"| C1["status=COMPLETED terminalReason=stop exit=0"]
  C -->|"max_steps"| C2["status=COMPLETED terminalReason=max_steps exit=0 + show budget hint"]

  B -->|"error"| D{"errorCode"}
  D -->|"AGENT_ABORTED"| D1["status=CANCELLED terminalReason=aborted exit=130"]
  D -->|"AGENT_TIMEOUT_BUDGET_EXCEEDED"| D2["status=FAILED terminalReason=timeout exit=1"]
  D -->|"AGENT_MAX_RETRIES_REACHED"| D3["status=FAILED terminalReason=max_retries exit=1"]
  D -->|"other"| D4["status=FAILED terminalReason=error exit=1"]

  C1 --> E["UPDATE runs terminal fields + completed_at"]
  C2 --> E
  D1 --> E
  D2 --> E
  D3 --> E
  D4 --> E

  E --> G{"need log?"}
  G -->|"warn/error or sampled info"| H["INSERT run_logs"]
  G -->|"no"| I["skip run_logs"]
  H --> J["Render final summary and exit"]
  I --> J
```

### 10.2 用户中断（SIGINT）路径

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant CLI as CLI
  participant Orch as RunOrchestrator
  participant Agent as StatelessAgent
  participant DB as SQLite(agent.db)

  User->>CLI: Ctrl+C (SIGINT)
  CLI->>Orch: requestAbort(executionId)
  Orch->>Agent: abort signal
  Agent-->>Orch: error(errorCode=AGENT_ABORTED)
  Orch->>DB: INSERT events(type=error,payload_json)
  Orch->>DB: UPDATE runs(status=CANCELLED,terminal_reason=aborted,completed_at)
  Orch->>DB: INSERT run_logs(level=warn,code=AGENT_ABORTED)
  Orch-->>CLI: terminal result(cancelled)
  CLI-->>User: 输出取消摘要 + exit 130
```

### 10.3 终态输出矩阵（速查）

| 终态来源 | status | terminalReason | CLI 退出码 | 用户可见提示 |
|---|---|---|---|---|
| `done.stop` | `COMPLETED` | `stop` | `0` | 正常完成 |
| `done.max_steps` | `COMPLETED` | `max_steps` | `0` | 达到步数上限（建议 `resume`） |
| `error.AGENT_ABORTED` | `CANCELLED` | `aborted` | `130` | 用户中断或上层取消 |
| `error.AGENT_TIMEOUT_BUDGET_EXCEEDED` | `FAILED` | `timeout` | `1` | 预算超时（可重试） |
| `error.AGENT_MAX_RETRIES_REACHED` | `FAILED` | `max_retries` | `1` | 达到重试上限（建议检查工具/网络） |
| `error.*` | `FAILED` | `error` | `1` | 未分类失败（查看 `errorCode`） |

---

## 11. 查询命令流程（`run-status` / `run-list`）

说明：
- 两个命令是**只读路径**，不写 `events/messages/runs`。
- 默认直接查投影表（`runs`），`--verbose` 再补查 `execution_steps/events`。

### 11.1 `agent run-status --execution <id>`

```mermaid
flowchart TD
  A["CLI receive run-status"] --> B["Parse args + validate executionId"]
  B --> C["SELECT * FROM runs WHERE run_id=?"]
  C --> D{"Found?"}
  D -->|"No"| E["Render not found + exit 2"]
  D -->|"Yes"| F["Render core fields(status,terminalReason,stepIndex,timestamps)"]
  F --> G{"--verbose ?"}
  G -->|"No"| H["Exit 0"]
  G -->|"Yes"| I["SELECT execution_steps ORDER BY step_index DESC LIMIT N"]
  I --> J["SELECT events ORDER BY seq DESC LIMIT M"]
  J --> K["Render detail blocks + exit 0"]
```

### 11.2 `agent run-status --watch` 轮询路径

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant CLI as CLI
  participant DB as SQLite(agent.db)

  User->>CLI: agent run-status --execution <id> --watch
  loop 每 interval_ms
    CLI->>DB: SELECT status,step_index,terminal_reason,updated_at_ms FROM runs WHERE run_id=?
    DB-->>CLI: row
    CLI-->>User: 刷新单行进度
    alt status in completed/failed/cancelled
      CLI-->>User: 输出终态摘要
      CLI-->>User: 退出
    end
  end
```

### 11.3 `agent run-list --conversation <id>`

```mermaid
flowchart TD
  A["CLI receive run-list"] --> B["Parse filters(status/limit/cursor)"]
  B --> C["SELECT conversation exists?"]
  C --> D{"Exists?"}
  D -->|"No"| E["Render empty/not-found + exit 0"]
  D -->|"Yes"| F["SELECT runs WHERE conversation_id=? AND status filter"]
  F --> G["ORDER BY updated_at_ms DESC LIMIT page_size+1"]
  G --> H{"Has more?"}
  H -->|"Yes"| I["Build next_cursor from last row"]
  H -->|"No"| J["next_cursor = null"]
  I --> K["Render list rows + next_cursor"]
  J --> K
  K --> L{"--verbose ?"}
  L -->|"No"| M["Exit 0"]
  L -->|"Yes"| N["Batch SELECT latest step per run (execution_steps)"]
  N --> O["Render enriched rows + exit 0"]
```

### 11.4 查询命令读表矩阵（速查）

| 命令 | 默认读取表 | `--verbose` 补充读取 | 写表 |
|---|---|---|---|
| `run-status` | `runs` | `execution_steps`, `events` | 无 |
| `run-status --watch` | `runs`（轮询） | - | 无 |
| `run-list` | `conversations`, `runs` | `execution_steps`（批量） | 无 |
