# Prompt Cache And Continuation 技术方案

## 1. 文档目标

本文档说明 `D:\work\coding-agent-v2` 当前 Prompt Cache 与 Responses Continuation 的实现原理、设计取舍、具体改动文件、关键代码逻辑、数据验证结论，以及为什么最终采用：

- 默认开启 `prompt_cache_key`
- 默认关闭自动 `previous_response_id`
- 保留显式 `previous_response_id` 能力
- 完整持久化 `usage` 与 `metadata`

本文档既是实现说明，也是后续继续优化的技术基线。

---

## 2. 背景问题

最开始出现的问题不是单一 bug，而是几个现象叠加在一起：

- 多轮对话里 `cached_tokens` 经常为 `0`
- 明明每轮消息是追加的，但缓存命中并不稳定
- 启用自动 `previous_response_id` 后，缓存有时好了，但多轮执行会断
- 由于 `usage` 早期没有完整保存，导致难以判断到底是缓存没命中，还是数据没记录下来

经过对 `.renx\data.db` 和日志的连续分析，最终得到几个结论：

1. 历史会话大多数都是严格 append-only 的。
2. 旧问题并不主要是本地上下文拼接错误。
3. 真正影响缓存稳定性的关键因素之一，是没有稳定传递 `prompt_cache_key`。
4. `previous_response_id` 在当前网关上语义续传不稳定，容易导致工具链执行中断。

换句话说，问题本质上是两种能力混在了一起：

- Prompt Cache 路由能力
- 服务端状态续传能力

这两者不能用同一套默认策略粗暴处理。

---

## 3. 最终方案结论

当前最终方案采用：

- 默认使用“全量重放 + `prompt_cache_key`”
- 默认不自动启用 `previous_response_id`
- 保留显式 `previous_response_id`
- 保留 continuation 元数据与开关，方便未来在更稳定的 provider 上启用

原因很直接：

- 在当前网关环境里，`prompt_cache_key` 是稳定有效的
- 自动 `previous_response_id` 续传是不稳定的
- “全量重放 + 缓存路由”比“服务端续传”更稳

一句话总结：

> 用 `prompt_cache_key` 解决缓存命中，用 full replay 保证语义稳定，用完整 `usage + metadata` 保证可分析，用保守开关保留 continuation 能力但不让它默认破坏多轮执行。

---

## 4. 核心原理

## 4.1 `prompt_cache_key` 是做什么的

`prompt_cache_key` 的作用不是“续传”，而是“缓存路由”。

它的本质是告诉上游：

> 这几轮请求属于同一条会话的同一条前缀缓存链，请尽量路由到同一棵 prefix cache 上。

它适合解决的问题是：

- 我每轮都在全量重放历史
- 但历史大部分内容没变
- 我希望上游把这些重复前缀识别为可复用缓存

所以它对应的是：

- 更稳定的 `cached_tokens`
- 更稳定的 prefix reuse

但它不负责：

- 让服务端延续上一条 response 的内部状态

---

## 4.2 `previous_response_id` 是做什么的

`previous_response_id` 的作用是服务端 continuation。

它的本质是告诉上游：

> 这一轮不是一条完全新的请求，而是上一条 response 的继续。

理论上它有两个好处：

1. 不必重复发送全部历史，只需要发增量。
2. 服务端可以基于上一条 response 的内部状态继续推理。

但它要求上游实现足够稳定，否则会出现：

- 续传语义漂移
- 工具链上下文断裂
- 模型开始泛化闲聊，而不是继续当前任务

当前环境里正是第二种情况，所以它不能作为默认策略。

---

## 4.3 为什么最终选择全量重放

全量重放看起来更“笨”，但在当前环境里它更稳。

原因是：

1. 本地消息链是可控的。
2. `prompt_cache_key` 可以让上游仍然复用大部分 prefix。
3. 即使上游不支持稳定 continuation，全量重放也不会破坏语义。

也就是说，当前策略不是“放弃缓存”，而是：

- 不依赖不稳定的服务端状态续传
- 依赖稳定的缓存前缀复用

---

## 5. 端到端实现链路

完整调用链如下：

```text
Agent.runStream
  -> mergeLLMConfig
      -> 自动注入 prompt_cache_key = conversationId
  -> buildLLMRequestPlan
      -> 决定 full replay / incremental continuation
  -> llmProvider.generateStream
      -> OpenAICompatibleProvider.buildRequestParams
      -> ResponsesAdapter.transformRequest
      -> POST /responses
  -> parse stream chunks
      -> 提取 responseId / usage / tool_calls / text
  -> 生成 assistant message
      -> 持久化 metadata / usage 全字段
```

---

## 6. 实际改动文件清单

这一节是“改了哪些文件，分别加了哪些代码”的完整说明。

## 6.1 `src/agent/agent/index.ts`

这是本次改动的核心文件。

### 新增或强化的内容

1. 增加 continuation 元数据结构：

```ts
type ContinuationMetadata = { ... }
type LLMRequestPlan = { ... }
```

2. 增加请求与响应的归一化哈希工具：

```ts
function normalizeValueForHash(value: unknown): unknown
function hashValueForContinuation(value: unknown): string
```

3. 增加 continuation 读取与规划逻辑：

```ts
private readContinuationMetadata(message: Message)
private buildLLMRequestPlan(messages: Message[], config: AgentInput['config'])
```

4. 增加 Agent 级开关：

```ts
enableServerSideContinuation?: boolean
```

5. 在 `mergeLLMConfig(...)` 中自动注入：

```ts
prompt_cache_key: conversationId
```

6. 在 `callLLMAndProcessStream(...)` 中记录 assistant metadata：

```ts
responseId
llmRequestConfigHash
llmRequestInputHash
llmRequestInputMessageCount
llmResponseMessageHash
continuationMode
previousResponseIdUsed
continuationBaselineMessageCount
continuationDeltaMessageCount
```

### 当前默认逻辑

如果没有显式开启 `enableServerSideContinuation`，则直接返回 full replay：

```ts
if (!this.config.enableServerSideContinuation) {
  return {
    llmMessages,
    requestMessages: llmMessages,
    requestConfig: config,
    requestConfigHash,
    requestInputHash,
    requestInputMessageCount,
    continuationMode: 'full',
    continuationDeltaMessageCount: llmMessages.length,
  };
}
```

### 新增的代码注释

本文件新增了两类关键注释：

1. 为什么默认关闭自动 server-side continuation：

```ts
// Keep server-side continuation opt-in. In the current gateway environment
// full replay + prompt_cache_key is more stable than automatic previous_response_id chaining.
```

2. 为什么 tool result 的 delta 必须把 paired tool_call 一起带上：

```ts
// If the delta contains a tool result, the paired assistant tool_call must
// be included as well, otherwise the Responses gateway rejects the request shape.
```

3. 为什么自动注入 `prompt_cache_key`：

```ts
// Use the conversation id as the default sticky cache routing key so
// repeated full replays can still hit provider-side prefix caching.
```

### 它解决的问题

- 让缓存策略与续传策略分离
- 让默认行为稳定
- 让请求可追踪、可分析

---

## 6.2 `src/agent/utils/message.ts`

这个文件的主体逻辑早已存在，但本次方案中它承担了 continuation 的关键修正职责。

### 方案中实际依赖的方法

- `getAssistantToolCalls(...)`
- `getToolCallId(...)`
- `processToolCallPairs(...)`

### 关键逻辑

当 active window 中存在某条 `tool` 消息时，如果它对应的 assistant `tool_calls` 不在 active 中，则把对应 assistant 一并移动到 active。

伪代码：

```ts
function processToolCallPairs(pending, active):
    map = tool_call_id -> assistant_message

    for each tool_result in active:
        if tool_result depends on assistant_tool_call:
            move assistant_tool_call into active too
```

### 它解决的问题

避免发送出这种非法结构：

```text
tool_result only
without preceding assistant.tool_calls
```

否则上游会报：

```text
messages with role "tool" must be a response to a preceeding message with "tool_calls"
```

---

## 6.3 `src/agent/agent/message-utils.ts`

这个文件没有大改，但它是整个请求标准化的基础。

### 方案中依赖的方法

- `shouldSendMessageToLLM(...)`
- `convertMessageToLLMMessage(...)`
- `mergeLLMConfig(...)`

### 它实际承担的职责

1. 过滤空 assistant-text 噪音消息
2. 把本地 `Message` 转换为标准 `LLMRequestMessage`
3. 清洗 tool call arguments，保证是合法 JSON

### 它对当前方案的重要性

`buildLLMRequestPlan(...)` 的哈希计算、full replay、以及 continuation 判定，都是建立在这里产出的标准化消息之上的。

---

## 6.4 `src/providers/types/api.ts`

这个文件是协议层类型入口。

### 新增或保留的关键字段

```ts
prompt_cache_key?: string
prompt_cache_retention?: string
previous_response_id?: string
```

### 它解决的问题

- 让缓存路由参数进入类型系统
- 让 continuation 参数进入类型系统
- 避免运行时有参数，编译期却看不见

---

## 6.5 `src/providers/openai-compatible.ts`

这个文件负责把 Agent 层传来的配置透传给具体 Adapter。

### 当前关键逻辑

`buildRequestParams(...)` 会把 `extraOptions` 继续传递给 Adapter：

```ts
const requestBody = this.adapter.transformRequest({
  ...extraOptions,
  model: ...,
  messages,
  stream,
  tools,
})
```

因此以下字段都可以继续向下透传：

- `prompt_cache_key`
- `prompt_cache_retention`
- `previous_response_id`

### 它解决的问题

确保 Agent 层决定的缓存/续传参数不会在 Provider 层丢失。

---

## 6.6 `src/providers/adapters/responses.ts`

这是 `/responses` 协议适配层核心文件。

### 本次方案相关的关键实现

1. 把 assistant `tool_calls` 转成 `function_call`

```ts
if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
  for (const toolCall of message.tool_calls) {
    items.push({
      type: 'function_call',
      call_id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    })
  }
}
```

2. 把 tool result 转成 `function_call_output`

```ts
if (message.role === 'tool') {
  items.push({
    type: 'function_call_output',
    call_id: message.tool_call_id,
    output: this.contentToText(message.content),
  })
}
```

3. 把 usage 全字段映射回来

```ts
return {
  ...usage,
  prompt_tokens: promptTokens,
  completion_tokens: completionTokens,
  total_tokens: usage.total_tokens ?? promptTokens + completionTokens,
}
```

### 本次补充的代码注释

新增了说明性注释：

```ts
// Assistant tool-call turns may legitimately have empty text content.
// The actual semantic payload is carried by function_call items below.
```

### 为什么这条注释重要

因为真实数据里大量 `tool-call` assistant 的 `content=""`，这不是 bug。

对 `/responses` 来说，真正的语义负载在：

- `function_call`
- `function_call_output`

不是 assistant 的空文本。

---

## 6.7 `src/agent/app/sqlite-agent-app-store.ts`

这个文件负责把消息与运行数据持久化到 SQLite。

### 关键持久化字段

- `tool_calls_json`
- `usage_json`
- `metadata_json`

### 关键序列化逻辑

```ts
message.tool_calls ? JSON.stringify(message.tool_calls) : null
message.usage ? JSON.stringify(message.usage) : null
message.metadata ? JSON.stringify(message.metadata) : null
```

### 它解决的问题

这一步很关键，因为没有它就无法从 `.renx\data.db` 里分析：

- `cached_tokens`
- `responseId`
- `continuationMode`
- `previousResponseIdUsed`
- request/input hash

所以“完整 usage 持久化”是本次技术方案真正能落地分析的前提。

---

## 6.8 `src/agent/agent/__test__/index.test.ts`

这是本次实现最重要的测试文件之一。

### 新增或强化的测试点

1. tool-call/tool-result delta 成对进入 continuation
2. append-only 历史在 continuation 开启时可以复用 `previous_response_id`
3. 配置变化时 fallback 到 full replay
4. prefix 不一致时 fallback 到 full replay
5. 自动注入 `prompt_cache_key`
6. 调用方显式设置 `prompt_cache_key` 时不覆盖
7. 默认关闭自动 continuation 后，不会自动带 `previous_response_id`

### 这些测试的意义

它们把“缓存”和“续传”的边界固定下来，避免以后改代码时再次把两个能力混在一起。

---

## 6.9 `src/providers/__tests__/responses-adapter.test.ts`

这个测试文件用于保证 `/responses` 适配层行为正确。

### 覆盖点

- assistant tool calls -> `function_call`
- tool result -> `function_call_output`
- usage 全字段映射
- `cached_tokens` 正确保留

### 它解决的问题

保证我们在数据库和日志里看到的 `cached_tokens` 是真实上游 usage，而不是适配层丢字段造成的假象。

---

## 6.10 新增文档文件

新增文件：

- `PROMPT_CACHE_AND_CONTINUATION_TECHNICAL_SOLUTION.md`

### 作用

- 汇总原理
- 汇总代码改动
- 汇总数据验证
- 作为团队继续迭代的技术基线

---

## 7. 请求规划逻辑详解

## 7.1 `buildLLMRequestPlan(...)` 为什么存在

这个方法的职责不是“发请求”，而是“先判断该怎么发请求”。

输出一个规划对象：

```ts
type LLMRequestPlan = {
  llmMessages
  requestMessages
  requestConfig
  requestConfigHash
  requestInputHash
  requestInputMessageCount
  continuationMode
  previousResponseIdUsed
  continuationBaselineMessageCount
  continuationDeltaMessageCount
}
```

它要回答三个问题：

1. 本轮发全部历史还是发增量？
2. 本轮是否允许使用 `previous_response_id`？
3. 如果允许，增量窗口是否合法？

---

## 7.2 当前默认路径

当前默认路径很简单：

```ts
if no explicit previous_response_id
and enableServerSideContinuation == false:
    send full replay
```

这保证生产默认行为稳定。

---

## 7.3 为什么 continuation 还要保留

虽然默认不用，但 continuation 逻辑和元数据仍然保留，因为它有三个价值：

1. 方便未来在更稳定的 provider 上启用
2. 方便测试协议能力
3. 方便继续做 A/B 对比分析

---

## 7.4 continuation 需要哪些校验

如果显式启用 continuation，必须同时满足：

1. 配置哈希一致
2. 历史前缀哈希一致
3. assistant 自身输出哈希一致
4. delta 窗口必须是合法边界

伪代码如下：

```ts
for candidate assistant from newest to oldest:
    metadata = readContinuationMetadata(candidate)
    if no metadata:
        continue

    if metadata.config_hash != current.config_hash:
        break

    if prefix_hash != metadata.request_input_hash:
        break

    if assistant_hash != metadata.response_hash:
        break

    delta = processToolCallPairs(prefix, suffix).active

    return incremental_request(previous_response_id=metadata.responseId, delta)
```

这套校验是 continuation 能力可用的前提。

---

## 8. 为什么 tool-call/tool-result 不能拆开

对于 `/responses` 协议来说：

- assistant 的 tool call 是 `function_call`
- tool result 是 `function_call_output`

如果只发后者，不发前者，上游无法理解这个 tool result 是对哪次调用的回应。

这就是为什么必须保证：

```text
assistant.tool_calls
tool.tool_call_id
```

必须成对存在。

这也是 `processToolCallPairs(...)` 必须参与 continuation 规划的原因。

---

## 9. 为什么 `tool-call` 的 `content = ""` 是正常的

这一点在数据分析里非常重要。

对 `/responses` 来说，assistant 的一轮输出可能是：

- 文本回复
- tool call
- 文本 + tool call 混合

其中纯 tool-call 场景下，assistant `content=""` 完全合法。

真正重要的是：

```ts
tool_calls: [...]
```

Adapter 会把它变成：

```json
{
  "type": "function_call",
  "call_id": "...",
  "name": "...",
  "arguments": "..."
}
```

所以“空 content”不能被当作异常。

---

## 10. 为什么完整保存 `usage`

如果只保存：

- `prompt_tokens`
- `completion_tokens`
- `total_tokens`

那我们根本无法分析 Prompt Cache。

因为 Prompt Cache 的关键证据在：

```json
input_tokens_details.cached_tokens
```

因此必须保留 usage 全字段。

当前统一做法是：

- 收到什么 usage，就完整保存什么 usage
- 再补充标准字段映射

这样未来 provider 新增字段时，也无需再改数据库结构。

---

## 11. 数据侧验证结论

## 11.1 失败案例：自动 continuation 导致语义漂移

会话：

- `opentui-1773435333416`

现象：

- `cached_tokens` 已经命中
- 但 assistant 在工具结果后给出泛化闲聊回复
- 任务没有沿着当前 bug 分析继续执行

结论：

- `previous_response_id` 在当前网关上不能作为默认策略

---

## 11.2 成功案例：全量重放 + prompt_cache_key

会话：

- `opentui-1773435670923`

统计结果：

- assistant steps: `17`
- cache hit steps: `15`
- `cached_tokens = 0` 的 step: `2`
  - 首轮冷启动 1 条
  - 孤立异常 1 条
- max cached tokens: `12416`
- avg cached tokens when hit: `8610.13`

更重要的是：

- 多轮工具执行一直推进到 `step 17`
- 所有 assistant step 都是 `continuationMode = "full"`
- `previousResponseIdUsed = null`
- 但缓存命中稳定存在

这证明当前策略是对的：

- 不自动 continuation
- 仍然可以稳定命中缓存
- 并且多轮执行不再断

---

## 11.3 为什么会偶尔出现一条 `cached_tokens = 0`

在成功案例里，`step 14` 出现过一次孤立 `0`，但下一轮马上恢复命中。

这更像：

- 上游 cache block 记账波动
- 网关侧单轮 usage 统计异常

而不像本地问题。

原因是：

- `config hash` 没变
- 输入消息数严格追加
- 下一轮立刻恢复高命中

如果是本地 context 真坏了，通常不会只掉一轮又立刻恢复。

---

## 12. 当前真实执行逻辑

当前生产逻辑可以概括为：

```ts
function runAgentStep(messages, inputConfig, conversationId):
    tools = resolveTools()

    config = mergeConfig(inputConfig, tools, abortSignal)

    if config.prompt_cache_key is empty:
        config.prompt_cache_key = conversationId

    requestPlan = buildLLMRequestPlan(messages, config)

    // 默认:
    // requestPlan.mode = full
    // requestPlan.requestMessages = all llm messages

    stream = provider.generateStream(
        requestPlan.requestMessages,
        requestPlan.requestConfig
    )

    assistant = collectStream(stream)
    assistant.metadata.responseId = chunk.id
    assistant.metadata.request hashes = ...
    assistant.usage = full usage payload

    if assistant has tool_calls:
        execute tools
        append tool results
        continue next step
    else:
        finish
```

如果未来显式开启 continuation，则逻辑变成：

```ts
if enableServerSideContinuation:
    find latest valid assistant baseline
    validate config hash / input prefix hash / response hash
    delta = processToolCallPairs(prefix, suffix).active
    send previous_response_id + delta
```

---

## 13. 当前方案的优缺点

### 优点

1. 在当前 provider 上稳定。
2. 多轮工具执行已恢复正常。
3. Prompt Cache 已稳定生效。
4. 数据可观测性显著增强。
5. 保留未来切回 continuation 的能力。

### 缺点

1. 仍然是 full replay，请求体会持续增大。
2. 依赖上游 Prompt Cache，而不是服务端 continuation。
3. 偶发仍可能出现单轮 `cached_tokens = 0` 的统计波动。

---

## 14. 后续可选优化

1. 增加 provider 能力矩阵：

- supports_prompt_cache_key
- supports_stable_previous_response_id
- supports_incremental_responses_items

2. 增加 debug 请求快照：

- request body hash
- message count
- prompt_cache_key
- previous_response_id

3. 增加缓存异常探测规则：

- 连续命中
- 中间单轮掉 `0`
- 下一轮恢复

则自动标记为“上游缓存波动”

---

## 15. 最终结论

本项目当前最优实践不是“强行用 continuation”，而是：

- 全量重放消息
- 自动注入 `prompt_cache_key = conversationId`
- 完整持久化 `usage / metadata`
- 默认关闭自动 `previous_response_id`

同时保留：

- 显式 `previous_response_id`
- `enableServerSideContinuation`
- continuation 哈希链
- tool-call/tool-result 合法边界处理

最终目标不是让某个参数“看起来更高级”，而是让系统在当前 provider 上：

- 缓存稳定命中
- 多轮执行稳定推进
- 出问题时可以从数据中直接定位原因

