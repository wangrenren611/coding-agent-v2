# 架构图与数据流

## 1. 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Application Layer                                   │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                MinimalStatelessAgentApplication                             │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │  │
│  │  │ Input Validator │  │ Event Handler   │  │ Usage Tracker  │          │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘          │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                Agent Layer (v4)                                   │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                         StatelessAgent                                      │  │
│  │  ┌──────────────┬──────────────┬──────────────┬──────────────┐          │  │
│  │  │ LLM Caller   │ Tool Manager │ Error Handler│ Compaction   │          │  │
│  │  │              │              │              │              │          │  │
│  │  │ • Stream     │ • Policy    │ • Retry      │ • Token Est. │          │  │
│  │  │ • Chunk Merge│ • Validation│ • Backoff    │ • Summarize  │          │  │
│  │  │ • Usage Track│ • Execution│ • Normalize  │              │          │  │
│  │  └──────────────┴──────────────┴──────────────┴──────────────┘          │  │
│  │  ┌──────────────┬──────────────┬──────────────┬──────────────┐          │  │
│  │  │ Concurrency  │ Timeout      │ Telemetry    │ Checkpoint   │          │  │
│  │  │              │              │              │              │          │  │
│  │  │ • Waves      │ • Budget     │ • Metrics    │ • Resume     │          │  │
│  │  │ • Locks      │ • Scope      │ • Traces     │ • State      │          │  │
│  │  └──────────────┴──────────────┴──────────────┴──────────────┘          │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└──────────┬────────────────────────────────────┬─────────────────────────────────┘
           │                                    │
           ▼                                    ▼
┌──────────────────────────┐    ┌──────────────────────────────────────────────┐
│    Provider Layer         │    │               Tool Layer                     │
│  ┌──────────────────────┐│    │  ┌────────────────────────────────────────┐ │
│  │  Provider Registry   ││    │  │        DefaultToolManager              │ │
│  │  ┌────────────────┐ ││    │  │  ┌──────────────┬──────────────────┐  │ │
│  │  │ Model Config   │ ││    │  │  │ Policy Check │ Validation       │  │ │
│  │  │ Factory        │ ││    │  │  │ • Built-in   │ • Zod Schema     │  │ │
│  │  └────────────────┘ ││    │  │  │ • Callback   │ • Safe Parse     │  │ │
│  └──────────────────────┘│    │  │  └──────────────┴──────────────────┘  │ │
│  ┌──────────────────────┐│    │  │  ┌──────────────┬──────────────────┐  │ │
│  │ OpenAICompatible     ││    │  │  │ Confirm      │ Execution        │  │ │
│  │ Provider             ││    │  │  │ • Callback   │ • BaseTool      │  │ │
│  │  ┌────────────────┐ ││    │  │  │ • Timeout    │ • Context       │  │ │
│  │  │ Adapter        │ ││    │  │  └──────────────┴──────────────────┘  │ │
│  │  │ • Standard     │ ││    │  └────────────────────────────────────────┘ │
│  │  │ • Anthropic    │ ││    │  ┌────────────────────────────────────────┐ │
│  │  │ • Kimi         │ ││    │  │              Tools                     │ │
│  │  └────────────────┘ ││    │  │  ┌────────────────┬─────────────────┐ │ │
│  │  ┌────────────────┐ ││    │  │  │  BashTool      │ WriteFileTool   │ │ │
│  │  │ HTTP Client    │ ││    │  │  │ • Execute Cmd  │ • Direct/Resume │ │ │
│  │  │ • Timeout      │ ││    │  │  │ • Stream Out   │ • Buffer Session│ │ │
│  │  │ • Retry-After  │ ││    │  │  │ • Abort        │ • Finalize      │ │ │
│  │  └────────────────┘ ││    │  │  └────────────────┴─────────────────┘ │ │
│  │  ┌────────────────┐ ││    │  └────────────────────────────────────────┘ │
│  │  │ Stream Parser  │ ││    └──────────────────────────────────────────────┘
│  │  │ • SSE          │ ││
│  │  │ • JSON Chunk   │ ││
│  │  └────────────────┘ ││
│  └──────────────────────┘│
└──────────────────────────┘
```

## 2. 数据流图

### 2.1 请求流（Request Flow）

```
┌─────────┐
│  User   │
└────┬────┘
     │ Input: { conversationId, executionId, userInput, maxSteps }
     ▼
┌──────────────────────────────────────────────────────────────┐
│  MinimalStatelessAgentApplication                            │
│  1. Validate input                                           │
│  2. Create Message: { role: 'user', content: userInput }     │
│  3. Call agent.runStream({ messages, ... })                  │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  StatelessAgent.runStream()                                  │
│                                                              │
│  Loop: while (stepIndex < maxSteps) {                       │
│    ├─ Check: AbortSignal?                                   │
│    ├─ Check: MaxRetries?                                    │
│    ├─ Compact messages (if needed)                          │
│    ├─ Call LLM (with timeout budget)                        │
│    │   └─> Yield: chunk, reasoning_chunk, tool_call events │
│    ├─ Has tool calls?                                       │
│    │   ├─ Yes: Execute tools                                │
│    │   │   └─> Yield: tool_result events                    │
│    │   │   └─> Continue loop                                │
│    │   └─ No: Stop loop                                     │
│    └─ Yield: done event                                     │
│  }                                                           │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 LLM 调用流

```
┌──────────────────────────────────────────────────────────────┐
│  StatelessAgent.callLLMAndProcessStream()                    │
│                                                              │
│  1. Create LLM abort scope (70% of total budget)            │
│  2. Merge LLM config (model, temperature, tools)            │
│  3. Call provider.generateStream(messages, config)          │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  OpenAICompatibleProvider.generateStream()                   │
│                                                              │
│  1. Build request params (Adapter.transformRequest)         │
│     - Convert message format                                │
│     - Add tools                                             │
│     - Set streaming options                                 │
│  2. HTTP POST to endpoint                                   │
│  3. Return AsyncGenerator<Chunk>                            │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  HTTP Client + Stream Parser                                 │
│                                                              │
│  HTTP Request:                                               │
│    POST /v1/chat/completions                                 │
│    Headers: Authorization, Content-Type                      │
│    Body: { model, messages, stream: true, tools }            │
│                                                              │
│  Stream Response:                                            │
│    data: {"choices":[{"delta":{"content":"..."}}]}           │
│    data: {"choices":[{"delta":{"tool_calls":[...]}}]}        │
│    data: [DONE]                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 工具执行流
```
┌──────────────────────────────────────────────────────────────┐
│  StatelessAgent.processToolCalls()                           │
│                                                              │
│  1. Build execution waves (parallel vs exclusive)           │
│  2. For each wave:                                           │
│     - If parallel: execute concurrently (with locks)         │
│     - If exclusive: execute sequentially                     │
│  3. Collect results                                          │
│  4. Create tool result message                               │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  DefaultToolManager.execute()                                │
│                                                              │
│  1. Parse arguments (JSON)                                   │
│  2. Find tool handler                                       │
│  3. Validate arguments (Zod)                                │
│  4. Policy check (callback)                                 │
│     └─> Denied? Return error                                │
│  5. Built-in policy check                                   │
│     └─> Dangerous command? Return error                     │
│  6. Confirmation needed?                                    │
│     └─> Ask user (callback)                                 │
│     └─> Denied? Return error                                │
│  7. Execute tool (BaseTool.execute)                         │
│  8. Return ToolResult                                       │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  BashTool.execute()                                          │
│                                                              │
│  1. Spawn child process (shell -c)                          │
│  2. Set timeout (default 60s)                               │
│  3. Stream stdout/stderr (via onChunk callback)             │
│  4. Handle abort signal                                     │
│  5. Collect output                                          │
│  6. Return result { success, output, metadata }             │
└──────────────────────────────────────────────────────────────┘
```

## 3. 错误处理流程
```
                    ┌─────────────────┐
                    │  Error Occurs   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Normalize Error │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐  ┌─────────────────┐  ┌────────────────┐
│ AgentError    │  │ LLMError        │  │ ToolError      │
│               │  │                 │  │                │
│ • Aborted     │  │ • Retryable     │  │ • Not Found    │
│ • MaxRetries  │  │   - Rate Limit  │  │ • Validation   │
│ • Timeout     │  │   - Server      │  │ • Execution    │
│ • Unknown     │  │ • Permanent     │  │ • Denied       │
│               │  │   - Auth        │  │                │
│               │  │   - Not Found   │  │                │
│               │  │ • Aborted       │  │                │
└───────┬───────┘  └────────┬────────┘  └────────┬───────┘
        │                   │                    │
        │           ┌───────▼───────┐            │
        │           │ Is Retryable? │            │
        │           └───────┬───────┘            │
        │                   │                    │
        │          ┌────────┴────────┐          │
        │          │                 │          │
        │          ▼                 ▼          │
        │    ┌──────────┐     ┌──────────┐     │
        │    │   Yes    │     │    No    │     │
        │    └─────┬────┘     └────┬─────┘     │
        │          │               │           │
        │          ▼               ▼           │
        │  ┌────────────────┐  ┌──────────┐   │
        │  │ Calculate      │  │ Yield    │   │
        │  │ Backoff        │  │ Error    │   │
        │  └────────┬───────┘  │ Event    │   │
        │           │          └──────────┘   │
        │           ▼                         │
        │     ┌─────────────┐                │
        │     │ Sleep       │                │
        │     │ (with abort)│                │
        │     └──────┬──────┘                │
        │            │                        │
        │            ▼                        │
        │     ┌─────────────┐                │
        └────►│ Retry Loop  │◄───────────────┘
              └─────────────┘
```

## 4. 并发控制流程
```
┌──────────────────────────────────────────────────────────────┐
│  Tool Calls: [A, B, C, D, E]                                 │
│                                                              │
│  A: exclusive (bash)                                         │
│  B: parallel-safe (read_file)                                │
│  C: parallel-safe (read_file)                                │
│  D: exclusive (bash)                                         │
│  E: parallel-safe (read_file)                                │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Build Execution Waves                                       │
│                                                              │
│  Wave 1: [A] (exclusive)                                    │
│  Wave 2: [B, C, E] (parallel)                               │
│  Wave 3: [D] (exclusive)                                    │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Execute Wave 1: [A]                                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ A (exclusive) ─────────────────────────────────────────▶││
│  └─────────────────────────────────────────────────────────┘│
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Execute Wave 2: [B, C, E] (maxConcurrent = 2)              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ B ────────────────┐                                    ││
│  │                   │                                     ││
│  │ C ────────────────┼──────────────────▶                  ││
│  │                   │                                     ││
│  │ E                 └──────────────────▶                  ││
│  └─────────────────────────────────────────────────────────┘│
│  Note: E starts after B or C finishes (concurrency limit)   │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Execute Wave 3: [D]                                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ D (exclusive) ─────────────────────────────────────────▶││
│  └─────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

## 5. 超时预算分配
```
Total Budget: 100000ms (100s)
├── LLM Stage: 70000ms (70%)
│   ├── Step 1 LLM Call: ~20000ms
│   ├── Step 2 LLM Call: ~15000ms
│   └── Step 3 LLM Call: ~10000ms
│
└── Tool Stage: 30000ms (30%)
    ├── Tool Call Timeout: min(toolTimeout, remainingBudget)
    └── Distributed across tool calls

Example Timeline:
Time    Event
0ms     Agent starts
0ms     LLM Step 1 starts (budget: 70s)
20s     LLM Step 1 ends
20s     Tool execution starts (budget: 30s)
25s     Tool execution ends
25s     LLM Step 2 starts (budget: 70s - 20s = 50s remaining)
40s     LLM Step 2 ends
40s     Tool execution starts (budget: 30s - 5s = 25s remaining)
45s     Tool execution ends
...
100s    Timeout budget exceeded (if not finished)
```

## 6. 消息压缩流程
```
Messages: [M1, M2, M3, M4, M5, M6, M7, M8, M9, M10]
           ↑                         ↑
        Keep                      Remove

┌──────────────────────────────────────────────────────────────┐
│  Trigger Condition:                                          │
│  currentTokens >= (maxTokens - maxOutputTokens) * 0.8        │
│                                                              │
│  Example:                                                    │
│  maxTokens = 128000                                          │
│  maxOutputTokens = 4096                                      │
│  threshold = (128000 - 4096) * 0.8 = 98723 tokens            │
│                                                              │
│  currentTokens = 100000 (>= threshold)                       │
│  → Compaction triggered                                      │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Compaction Process:                                         │
│                                                              │
│  1. Keep first N messages (keepMessagesNum = 20)            │
│  2. Summarize remaining messages using LLM                  │
│  3. Replace with summary message                            │
│  4. Return removed message IDs                              │
│                                                              │
│  Before: [M1...M10] (100000 tokens)                         │
│  After:  [M1, M2, Summary] (50000 tokens)                   │
└──────────────────────────────────────────────────────────────┘
```

## 7. 流式事件类型
```
StreamEvent Types:
├── chunk             # LLM 文本片段
│   └─ data: { content: string }
│
├── reasoning_chunk   # LLM 思考片段（如果支持）
│   └─ data: { reasoningContent: string }
│
├── tool_call         # 工具调用开始
│   └─ data: { toolCallId, toolName, arguments }
│
├── tool_result       # 工具执行结果
│   └─ data: { toolCallId, result }
│
├── tool_stream       # 工具流式输出
│   └─ data: { toolCallId, type, content }
│
├── progress          # 执行进度
│   └─ data: { stepIndex, currentAction, messageCount }
│
├── checkpoint        # 检查点（可恢复）
│   └─ data: { stepIndex, lastMessageId, canResume }
│
├── compaction        # 消息压缩事件
│   └─ data: { removedMessageIds, messageCountBefore, messageCountAfter }
│
├── done              # 完成
│   └─ data: { finishReason, steps }
│
└── error             # 错误
    └─ data: ErrorContract
```

---

**生成时间**: 2024-03-09
