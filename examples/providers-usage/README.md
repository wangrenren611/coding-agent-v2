# Providers 使用示例

这个目录提供了一个可直接运行的 `providers` 示例，覆盖以下场景：

- 通过 `ProviderRegistry.createFromEnv` 按模型创建 Provider
- 非流式调用：`generate()`
- 流式调用：`generateStream()`
- 超时/取消与错误分类处理
- 手动创建 `OpenAICompatibleProvider`（不走 Registry）

## 目录结构

```text
examples/providers-usage/
├── README.md            # 详细说明（本文件）
├── index.ts             # 主示例（Registry 方式）
├── manual-provider.ts   # 手动实例化 OpenAICompatibleProvider
└── shared.ts            # 公共方法（消息构造、错误处理、chunk 文本提取）
```

## 快速开始

在仓库根目录执行：

```bash
pnpm example:providers list-models
```

查看支持的 `modelId` 以及对应环境变量。然后设置模型所需 API Key，例如：

```bash
export GLM_API_KEY="your-key"
```

执行非流式与流式示例：

```bash
pnpm example:providers non-stream glm-4.7 "解释一下 TypeScript 条件类型"
pnpm example:providers stream glm-4.7 "写一个二分查找函数"
```

## 主示例命令

`examples/providers-usage/index.ts` 支持命令：

- `list-models`
- `non-stream [modelId] [prompt]`
- `stream [modelId] [prompt]`
- `stream-timeout [modelId] [prompt] [timeoutMs]`

示例：

```bash
pnpm example:providers list-models
pnpm example:providers non-stream glm-4.7 "说明 Promise.allSettled 和 Promise.all 的区别"
pnpm example:providers stream glm-4.7 "写一个快速排序函数"
pnpm example:providers stream-timeout glm-4.7 "写 500 行注释" 1
```

`stream-timeout` 用于演示超时取消场景。该命令会传入 `AbortSignal.timeout(timeoutMs)`。

## 手动实例化示例

`examples/providers-usage/manual-provider.ts` 演示直接使用 `OpenAICompatibleProvider`：

```bash
pnpm example:providers:manual "给我一段 Node.js 文件读取示例"
```

默认读取以下环境变量：

- `OPENAI_API_KEY`（或 `GLM_API_KEY`）
- `OPENAI_API_BASE_URL` / `OPENAI_API_BASE` / `GLM_API_BASE`
- `OPENAI_MODEL`（可选，不设置默认 `gpt-4o-mini`）

## 错误处理说明

示例中统一使用以下错误分类：

- `isRetryableError(error)`：网络抖动、超时、5xx、429 等可重试错误
- `isPermanentError(error)`：参数错误、鉴权失败、模型不存在等永久错误
- `isAbortedError(error)`：调用方主动取消

同时，流模式里如果服务端在 chunk 中返回错误对象（`chunk.error`），`OpenAICompatibleProvider.generateStream()` 会在请求层直接抛出错误：

- 永久错误码/消息模式 -> `LLMPermanentError`
- 其他临时错误 -> `LLMRetryableError`

因此调用方只需要在 `for await ... of` 外层 `try/catch` 即可，不需要在 Agent 层重复解析 chunk 错误。

## 推荐接入方式

- 生产使用优先走 `ProviderRegistry.createFromEnv(modelId)`，保证模型配置集中管理
- 只有在接第三方私有兼容网关时，才手动 `new OpenAICompatibleProvider(...)`
- 流式和非流式使用两个方法，不要混用 `stream` 参数强行切换方法语义
