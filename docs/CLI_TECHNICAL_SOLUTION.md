# CLI 技术方案文档（实现原理）

> 文档类型：Technical Design / Implementation Principles  
> 适用版本：当前 `src/cli` 实现  
> 日期：2026-03-07

---

## 1. 背景与目标

本方案用于实现一个“类似 Claude Code 交互体验”的终端 Agent UI，满足以下核心目标：

1. 使用终端原生滚动条浏览历史消息（scrollback）。
2. 在底部显示实时状态（运行中、spinner、确认态）。
3. 已完成消息不可变，处理中消息可动态更新。
4. 输入区支持长文本、粘贴、换行、退格、中断等复杂交互。
5. 代码结构可维护、可测试、可扩展。

---

## 2. 约束与非目标

## 2.1 约束

1. 运行环境是普通终端（TTY），并且需兼容非 TTY 退化模式。
2. 事件来源是 Agent Hook 流，存在异步与分段输出。
3. 终端输入在 raw mode 下会产生碎片化 chunk，需容错解析。
4. 大段粘贴在不同终端中行为不一致（有无 bracketed paste、尾随换行差异）。

## 2.2 非目标

1. 不实现全屏 TUI 框架（如 ncurses 风格布局管理）。
2. 不实现内部历史滚动容器作为主显示机制。
3. 不在第一阶段实现复杂编辑器功能（多光标、光标移动、撤销树）。

---

## 3. 总体架构

系统分为 5 层：

1. 事件桥接层（Plugin）
2. 控制器层（Controller）
3. 输入解析层（Input Parser）
4. 渲染编排层（Terminal UI）
5. 局部刷新层（Live Region）

对应文件：

1. `src/cli/plugin.ts`
2. `src/cli/controller.ts`
3. `src/cli/input-parser.ts`
4. `src/cli/terminal-ui.ts`
5. `src/cli/live-region.ts`

---

## 4. 核心设计：双层渲染模型

## 4.1 不可变日志层（Immutable Log）

职责：

1. 记录所有完成态消息。
2. 仅追加写入 stdout。
3. 保证进入终端 scrollback。

特性：

1. 不重绘，不回收，不覆盖。
2. 天然支持终端原生滚动与复制。

## 4.2 可变实时层（Live Overlay）

职责：

1. 渲染运行中状态（spinner、thinking、confirming、tools 数量）。
2. 渲染底部实时输入（由控制器使用 `log-update` 管理）。

特性：

1. 可反复覆盖更新。
2. 不写入历史。
3. 必须在写历史日志前隐藏，写完后恢复。

## 4.3 写屏协议

协议顺序：

1. `hide live region`
2. `append immutable logs`
3. `restore live region`

该协议防止 live 内容污染历史日志，也防止日志覆盖 live 区。

---

## 5. 事件驱动设计

统一事件模型定义在 `src/cli/types.ts`，关键事件：

1. `message.user` / `message.system`
2. `run.start` / `run.finish` / `run.error`
3. `stream.text` / `assistant.snapshot`
4. `stream.tool`
5. `tool.confirm.request` / `tool.confirm.decision`
6. `step` / `stop`

设计原则：

1. 控制器只发事件，不关心具体渲染细节。
2. UI 只消费标准事件，不依赖 Agent 内部实现细节。
3. 插件负责把 Agent Hook 语义转换为 UI 事件语义。

---

## 6. 控制器设计（交互主循环）

控制器 `AgentTerminalController` 负责：

1. 启动交互循环（`run()`）。
2. 读取输入（TTY raw / 非 TTY readline）。
3. 路由 slash 命令。
4. 调用 `agent.run()` 并转发结果到 UI。
5. 处理中断（SIGINT）与工具确认。

关键状态：

1. `closed`
2. `runInFlight`
3. `cancelInputCapture`

关键保证：

1. `runInFlight` 时 SIGINT 触发 `agent.abort()`，而不是直接退出进程。
2. 非 TTY 自动降级为普通 `readline.question`。
3. 所有异常都转换为 `run.error` 事件，避免静默失败。

---

## 7. 输入解析原理

解析器 `parseRawInputChunk` 输出状态：

1. `buffer`
2. `submitted`
3. `aborted`
4. `inBracketedPaste`
5. `pending`

处理规则：

1. Ctrl+C -> `aborted=true`
2. Enter（`\r`/`\n`）-> `submitted=true`
3. Backspace -> 删除末尾 code point
4. ANSI 序列 -> 跳过
5. Bracketed paste -> 按块接收内容，不在中间提交
6. 跨 chunk 的 marker 前缀 -> 用 `pending` 缓冲

关键修复策略：

1. 修正 “unwrapped paste 启发式过宽” 造成的 Ctrl+C/Backspace/Enter 被绕过问题。
2. 修正 `a\n`、`hello\n`、`\r`、`\r\n` 等提交判定。

---

## 8. 输入区实现原理

## 8.1 为什么不使用 readline 默认输入框

1. 需要自定义粘贴折叠、原子删除、动态渲染策略。
2. 需要与底部实时状态统一协作，避免覆盖。

## 8.2 输入渲染流程

1. 解析 raw chunk 得到 `state.buffer`
2. 应用粘贴可视策略（折叠/隐藏粘贴正文）
3. 构建显示帧（自动换行 + 宽字符宽度处理）
4. 通过 `log-update` 局部刷新
5. 光标回到输入末尾

## 8.3 粘贴折叠机制

数据结构：`CollapsedPasteSegment`

1. `id`
2. `start`
3. `end`
4. `lineCount`

行为：

1. 超过阈值（行数或字符数）折叠为 `[Pasted text #N +X lines]`
2. 发送时仍使用原始 `state.buffer`
3. 退格时可把尾部 segment 一次性整体删除
4. 连续分包粘贴会合并成同一个 segment

## 8.4 粘贴中的可视化策略

1. Bracketed paste 进行中：隐藏粘贴正文，显示粘贴前内容
2. 粘贴结束后：直接显示最终折叠结果
3. 防止“先刷全文再折叠”带来的闪烁与信息噪音

## 8.5 防误提交策略

问题：

1. 某些终端在 paste end 后同 chunk 附带换行

策略：

1. 若刚退出 bracketed paste 且尾部是纯换行，则抑制本次 submit
2. 用户需再按 Enter 才发送

## 8.6 防抖动策略

1. 粘贴期间不按每个 chunk 立即重绘
2. 普通重绘采用短节流（16ms）
3. 避免终端“清行-重画”频闪

---

## 9. 消息渲染原理

## 9.1 assistant 消息

两种来源协同：

1. `stream.text`（增量）
2. `assistant.snapshot`（完整快照）

策略：

1. 增量优先实时输出，提高响应性
2. 快照补齐缺失后缀，避免丢内容
3. 若增量已输出，快照不重复打印
4. `reasoning_content` 在同条消息内先于 `content` 输出

## 9.2 tool 消息

1. start：打印工具标题（绿色点 + 粗体）
2. stdout/stderr：仅缓冲，不实时刷到历史
3. end/error：生成摘要块（树形 `└` 结构）
4. 过长输出按 compact 规则截断展示

## 9.3 markdown 支持

assistant content 通过 `marked + marked-terminal` 渲染：

1. 支持常用 Markdown 展示
2. 渲染失败自动回退纯文本

---

## 10. 状态机设计

顶层状态：

1. `idle`
2. `running`
3. `waiting_confirm`
4. `completed`
5. `error`
6. `exiting`

状态驱动作用：

1. 决定是否显示底部 spinner
2. 决定 status 文案（thinking/confirming）
3. 决定是否清理 live 区

---

## 11. 稳定性与容错

## 11.1 资源管理

1. `close()` 幂等
2. SIGINT handler 在退出时移除
3. raw mode 必须在所有退出路径恢复

## 11.2 输入安全

1. 清理 ANSI 与控制字符
2. escape 序列长度受限，降低正则风险
3. pending carry 仅保留 marker 前缀必要长度

## 11.3 渲染安全

1. live 区写入有去重（相同帧不重绘）
2. `withHidden` 有深度计数，支持嵌套调用
3. 发生异常时优先保证终端状态可恢复

---

## 12. 测试策略

测试目录：`src/cli/__tests__`

重点覆盖：

1. 输入解析正确性（提交、中断、粘贴、跨 chunk）
2. 粘贴折叠与 segment 合并
3. 占位符原子删除
4. 粘贴尾随换行抑制提交
5. assistant snapshot 与 stream 协同去重
6. 用户消息间距与块结构

建议回归命令：

```bash
pnpm vitest run src/cli/__tests__
```

---

## 13. 性能与复杂度评估

时间复杂度（单次输入事件）：

1. 解析：O(n)
2. 粘贴 segment 合并：O(1) 摊还（尾段合并）
3. 渲染帧构建：O(n)

空间复杂度：

1. 输入缓冲：O(n)
2. segment 列表：O(k)，k 为折叠段数量（通常很小）

性能结论：

1. 对终端交互负载足够轻量
2. 主要瓶颈在终端 I/O 刷新，不在计算逻辑

---

## 14. 扩展方案

## 14.1 可配置项建议

1. 粘贴折叠阈值（行数/字符）
2. 重绘节流间隔
3. 粘贴中可视策略（静默/显示提示）
4. tool 输出 compact 默认值

## 14.2 中长期演进

1. 把输入渲染从 controller 中拆分为 `InputRegionManager`
2. 引入成熟 Unicode 宽度库替换手写宽度逻辑
3. 增加 ANSI 快照测试，验证复杂终端行为

---

## 15. 交付标准（验收）

满足以下条件视为方案落地完成：

1. 用户消息、assistant、tool 输出均进入 scrollback。
2. 运行状态在底部动态更新，不污染历史。
3. 大段粘贴不刷全文，不抖动，最终显示单个折叠占位符。
4. 占位符可一次 Backspace 删除对应整段粘贴内容。
5. 粘贴结束不会因尾随换行自动发送。
6. `src/cli/__tests__` 全量通过。

---

## 16. 关联实现文档

若需要更细节的实现说明，请参考：

1. `docs/CLI_IMPLEMENTATION_GUIDE.md`
2. `docs/terminal-agent-ui-architecture.md`

