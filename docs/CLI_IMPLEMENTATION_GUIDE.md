# CLI 终端 Agent UI 详细实现文档

> 更新时间：2026-03-07  
> 适用范围：`src/cli/*`、`examples/agent-ui/index.ts`  
> 目标：给出“可维护、可扩展、可回归验证”的企业级 CLI UI 设计与实现说明

---

## 1. 文档目标与定位

本文件是当前 CLI 交互层的“实现级”文档，覆盖：

1. 整体架构与职责边界
2. 事件流与状态机
3. 混合渲染协议（历史日志 + 底部实时区）
4. 输入系统（raw mode、粘贴处理、折叠占位符、删除策略）
5. assistant/tool 消息渲染策略
6. 关键 bug 的修复原理
7. 测试矩阵与扩展指南

它不是产品 PRD，而是工程实现规范与落地说明。

---

## 2. 设计原则

### 2.1 原则一：终端原生滚动优先

- 历史消息必须进入终端 scrollback（`stdout` 追加写入）
- 不使用“内部滚动容器”作为主通道

### 2.2 原则二：处理中状态可变、完成态不可变

- 完成消息：不可变日志（Immutable Log）
- 处理中状态：底部可变实时区（Live Overlay）

### 2.3 原则三：输入体验必须抗噪声

- 粘贴大文本时不抖动、不刷屏
- 粘贴可折叠为占位符，发送时仍保留原文
- 删除时可把占位符对应内容作为整体删除

### 2.4 原则四：优先“可验证”

- 所有关键行为配套单测
- bug 修复优先落测试再改逻辑

---

## 3. 模块总览与职责

### 3.1 目录

- `src/cli/controller.ts`
- `src/cli/terminal-ui.ts`
- `src/cli/input-parser.ts`
- `src/cli/live-region.ts`
- `src/cli/plugin.ts`
- `src/cli/markdown-renderer.ts`
- `src/cli/types.ts`

### 3.2 职责划分

#### A. `AgentTerminalController`（控制器）

文件：`src/cli/controller.ts`

- 负责输入采集（TTY raw mode / 非 TTY readline）
- 负责 slash 命令处理（`/help`、`/status`、`/tools`、`/abort`、`/exit`）
- 负责驱动 `agent.run` 生命周期
- 负责粘贴折叠与输入区重绘策略
- 负责与 `TerminalUi` 进行事件交互（`dispatch`）

#### B. `TerminalUi`（渲染编排器）

文件：`src/cli/terminal-ui.ts`

- 接收标准化 `TerminalUiEvent`
- 管理运行状态、assistant 增量缓冲、tool 缓冲
- 负责“不可变日志”写入
- 负责运行中状态行 spinner（通过 `LiveRegionManager`）
- 负责 assistant markdown 渲染、reasoning/content 排序输出

#### C. `parseRawInputChunk`（输入解析器）

文件：`src/cli/input-parser.ts`

- 解析 raw 输入 chunk，输出：
  - `buffer`
  - `submitted`
  - `aborted`
  - `inBracketedPaste`
  - `pending`
- 处理 Ctrl+C、Backspace、Enter、ANSI 序列、Bracketed Paste

#### D. `LiveRegionManager`（实时区局部刷新）

文件：`src/cli/live-region.ts`

- 基于 `log-update` 管理底部可变区域
- 提供 `render/hide/withHidden/clear`
- 保证写历史日志前隐藏实时区，写完再恢复

#### E. `createTerminalUiAgentPlugin`（事件桥接）

文件：`src/cli/plugin.ts`

- 将 Agent Hook 事件转换成 UI 事件：
  - `textDelta -> stream.text`
  - `toolStream -> stream.tool`
  - `toolConfirm -> tool.confirm.request`
  - `step -> step + assistant.snapshot`
  - `stop -> stop`

#### F. `MarkdownRenderer`

文件：`src/cli/markdown-renderer.ts`

- 使用 `marked + marked-terminal`
- 将 assistant 内容 markdown 渲染为终端文本

---

## 4. 事件模型（TerminalUiEvent）

定义文件：`src/cli/types.ts`

核心事件分组：

1. 会话与运行
- `init`
- `run.start`
- `run.finish`
- `run.error`
- `step`
- `stop`
- `exit`

2. 消息流
- `message.user`
- `message.system`
- `stream.text`
- `assistant.snapshot`

3. 工具相关
- `stream.tool`
- `tool.confirm.request`
- `tool.confirm.decision`

4. 设置/输入
- `input.placeholder`
- `setting.compactToolOutput`

**关键语义**：

- `stream.text`：实时增量（delta）
- `assistant.snapshot`：step 阶段的完整快照（用于补齐遗漏 delta、避免丢失 content/reasoning）

---

## 5. 运行时序（端到端）

## 5.1 启动

入口示例：`examples/agent-ui/index.ts`

1. 构建 `TerminalUi`
2. 构建 plugin（将 agent 事件桥接到 UI）
3. 创建 `AgentTerminalController`
4. `controller.run()`

## 5.2 一次交互轮次

1. `askUserInput()`
2. `message.user` 记录用户消息
3. `run.start`
4. `agent.run(userInput)`
5. 过程中 plugin 持续分发：
   - `stream.text`
   - `stream.tool`
   - `step` + `assistant.snapshot`
6. 结束：
   - 正常：`run.finish`
   - 异常：`run.error`

---

## 6. 混合渲染协议（核心）

## 6.1 两层模型

1. Immutable Log（历史层）
- 通过 `stream.write(line + '\n')` 写入
- 永久进入 scrollback
- 不可变，不反复刷新

2. Live Overlay（实时层）
- 通过 `log-update` 局部覆盖
- 运行状态、spinner、底部提示
- 不写入历史

## 6.2 写屏协议

在 `TerminalUi.writeLogLines()` 中：

1. `liveRegion.withHidden(() => write logs)`
2. 写完历史日志
3. `renderLiveOverlay()` 恢复实时区

这样可避免实时区内容污染历史日志。

## 6.3 Block 间距规则

`LogWriteMode`：

- `block-start`：新块，若已有历史块则先加空行
- `block-start-tight`：紧凑新块（用户消息用此模式，不额外空行）
- `block-continue`：块内续行

---

## 7. 输入系统详解（raw mode）

核心：`AgentTerminalController.askUserInputRaw()`

## 7.1 进入 raw mode

1. `input.setRawMode(true)`
2. 开启 bracketed paste：`\u001B[?2004h`
3. 监听 `input.on('data', onData)`

退出时：

1. `input.setRawMode(false)`
2. 关闭 bracketed paste：`\u001B[?2004l`
3. `updateInput.clear()`

## 7.2 输入解析器

`parseRawInputChunk(state, text)` 输出：

- `buffer`：当前完整输入文本
- `submitted`：是否触发提交（Enter）
- `aborted`：是否中断（Ctrl+C）
- `inBracketedPaste`：是否处于 bracketed paste 区间
- `pending`：跨 chunk 的 marker 前缀缓存

## 7.3 Bracketed Paste 与普通输入

解析优先级：

1. 在 bracketed paste 内：文本原样入 buffer（只规范换行）
2. 普通模式：处理特殊字符（Ctrl+C/Backspace/Enter/ESC）
3. 长多行非 bracketed chunk：按启发式作为 unwrapped paste

## 7.4 超长粘贴折叠占位符

控制器维护 `CollapsedPasteSegment[]`：

- `id/start/end/lineCount`

显示时将对应区间替换为：

- `[Pasted text #N +X lines]`

原始 `state.buffer` 不变，发送时仍用原文。

触发折叠条件：

- 行数 >= 6，或字符数 >= 400，或 bracketed paste 且 >= 2 行

## 7.5 一次粘贴拆包合并

终端可能把一次粘贴拆成多个 chunk。  
`upsertCollapsedPasteSegment()` 会在段尾连续时合并为一个 segment，避免出现：

- `[Pasted text #1 ...][Pasted text #2 ...][Pasted text #3 ...]`

## 7.6 Backspace 原子删除占位符

当光标位于输入末尾且末尾对应折叠 segment：

- 一次 Backspace 删除整个 segment 对应的原始内容

体验上等价于“删除整个占位符”。

## 7.7 粘贴过程可视策略

当前策略：

1. 粘贴进行中：仅显示“粘贴前内容”（不显示粘贴正文）
2. 粘贴结束后：直接显示最终折叠占位符

这样可避免“先刷全文再折叠”。

## 7.8 防自动提交保护

某些终端会在 `\u001B[201~` 后附带换行。  
`shouldSuppressSubmitAfterBracketedPasteChunk()` 规则：

- 若本 chunk 刚退出 bracketed paste 且尾部只有 `\r`/`\n`
- 则 suppress 本次 `submitted`

用户必须显式按 Enter 才发送。

## 7.9 防抖动策略

1. bracketed paste 期间不立即逐 chunk 重绘
2. 普通重绘采用 16ms 合并节流
3. 使用 `log-update` 局部刷新输入区

---

## 8. 输入区布局算法

核心函数：

- `formatInputDraftForDisplay()`
- `buildInputFrame()`
- `wrapLineByWidth()`
- `runeWidth()/stringWidth()`

关键点：

1. 清理 ANSI CSI 和控制字符，避免脏序列污染终端
2. 保留换行，实现类似 textarea 的多行输入
3. 按终端宽度自动换行（考虑东亚宽字符）
4. 重绘后把光标回到最后一行末尾，避免“首次空行/错位”

---

## 9. TerminalUi 消息渲染详解

## 9.1 用户消息

- 样式：`❯ <text>`
- 模式：`block-start-tight`
- 目标：不在用户消息前额外插空行

## 9.2 assistant 增量与快照协同

### 增量流（`stream.text`）

- 非 reasoning delta 进入 `assistantBuffer`
- 按行增量 flush，减少闪烁

### 快照补齐（`assistant.snapshot`）

step 事件提供完整 `content/reasoning_content` 时：

1. 计算已渲染字符数
2. 仅补输出缺失后缀，避免重复
3. `reasoning_content` 先于 `content` 输出（同一条消息内）

## 9.3 assistant 样式

- 图标：灰色 `●`
- reasoning 行：灰色 `●` + dim 文本
- content：支持 markdown 渲染

## 9.4 markdown 渲染

通过 `MarkdownRenderer`：

- `marked + marked-terminal`
- `reflowText: false`
- 渲染失败时回退原文

---

## 10. Tool 消息渲染

## 10.1 启动

- `stream.tool(start)` 输出：绿色 `●` + 粗体标题
- 标题示例：
  - `Read(path)`
  - `Bash(command)`
  - `Grep(pattern)`

## 10.2 运行中缓冲

`runningTools` 维护：

- `stdout`
- `stderr`
- `title`
- `toolName`

## 10.3 结束总结

在 `end/error` 时：

1. 汇总输出预览
2. 以树形子行输出：`└ ...`
3. 过长输出按 compact 规则折叠
4. 错误场景补红色错误信息

特化：`file_read` 会显示 `Read N lines`。

---

## 11. 状态行（底部 live overlay）

来源：`TerminalUi.renderLiveOverlay()`

显示条件：

- `status=running|waiting_confirm`

内容：

- spinner frame（120ms 更新）
- `Thinking...`
- `(Esc to interrupt · <seconds>s · <phase> · tools:<n>)`

---

## 12. 工具确认交互

控制器：`confirmToolExecution(request)`

行为：

1. `autoConfirm` 存在则直接返回 approve/deny
2. 非 TTY 自动 deny
3. TTY 下通过 readline 询问确认
4. 询问阶段用 `ui.withSuspendedRender()` 暂停实时渲染，防止覆盖 prompt

---

## 13. Slash 命令

当前支持：

1. `/help`
2. `/status`
3. `/tools compact|full`
4. `/abort`
5. `/exit`

补充：

- 单输入 `?` 等价触发帮助

---

## 14. 关键 bug 与修复策略总结

## 14.1 输入解析类

1. unwrapped paste 启发式过宽导致 Ctrl+C/Backspace/Enter 被绕过  
修复：收紧启发式 + paste chunk 中保留特殊字符处理。

2. `hello\n`、`a\n`、`\r`、`\r\n` 提交行为错误  
修复：显式 interactive submit 识别。

3. bracketed paste marker 分段  
修复：`pending` 前缀 carry + marker 拼接解析。

## 14.2 UI 渲染类

1. 用户消息前多空行  
修复：`block-start-tight`。

2. 输入首帧“默认多一行”  
修复：局部更新后光标回位。

3. 大粘贴抖动  
修复：paste 期降频/合并重绘。

4. 一次粘贴多占位符  
修复：连续 segment 合并。

5. 粘贴后自动提交  
修复：paste end 尾随换行抑制提交。

---

## 15. 测试与回归策略

主要测试目录：`src/cli/__tests__`

### 15.1 建议回归命令

```bash
pnpm vitest run src/cli/__tests__
```

### 15.2 关键测试文件

1. `controller.test.ts`
- 输入格式化
- 粘贴折叠
- segment 合并
- 粘贴中可视策略
- 尾随换行抑制提交

2. `input-parser.test.ts`
- bracketed paste 基本流程
- marker 分包
- unwrapped multiline 行为

3. `terminal-ui.test.ts`
- 用户/assistant/tool 样式
- reasoning/content 顺序
- snapshot 去重与补齐

4. `bugs.test.ts` / `deep-bugs.test.ts`
- 历史 bug 回归（重点）

---

## 16. 扩展指南（企业级落地建议）

## 16.1 新增 slash 命令

在 `AgentTerminalController.handleSlashCommand()` 扩展，并遵循：

1. 命令解析与业务逻辑分离
2. 返回布尔值表示是否已处理
3. 所有反馈统一走 `ui.dispatch({type:'message.system'})`

## 16.2 新增 tool 样式

在 `terminal-ui.ts` 扩展：

1. `shortToolName()`
2. `formatToolTitle()`
3. `summarizeToolResult()`

保持：

- start 一行
- end 使用树形详情
- 错误统一红色摘要

## 16.3 输入策略可配置化（建议）

可抽配置项：

1. `PASTE_COLLAPSE_MIN_LINES`
2. `PASTE_COLLAPSE_MIN_CHARS`
3. `REDRAW_THROTTLE_MS`
4. `suppressSubmitAfterPaste` 开关

建议通过环境变量或 runtime config 注入，默认值保持当前行为。

## 16.4 非 TTY 退化策略

已实现：非 TTY 自动退化到 `readline.question('❯ ')`。  
建议后续加入：

1. 批处理模式（stdin 管道读取）
2. JSON 行协议输出（便于 CI/平台接入）

---

## 17. 观察性与诊断建议

## 17.1 推荐日志点

建议按 debug 级别输出：

1. `parseRawInputChunk` 状态转移
2. bracketed paste enter/exit
3. 占位符 segment upsert/merge
4. submit suppression 触发点

## 17.2 最小诊断信息模板

遇到输入异常时，优先记录：

1. 终端类型（iTerm2/Terminal/VSCode）
2. `process.stdin.isTTY`、`stdout.columns`
3. 原始 chunk（转义可见化）
4. 解析结果（submitted/aborted/inBracketedPaste）

---

## 18. 已知限制

1. `removeLastCodePoint()` 基于 code point，不是完整 grapheme cluster，复杂 emoji（ZWJ）删除可能需要多次 Backspace。
2. East Asian 宽度是手写近似，不覆盖全部 Unicode 边角。
3. 输入区当前是控制器直渲染；`TerminalUi.beginInput/updateInputDraft/endInput` 目前非主路径，可后续统一。

---

## 19. 未来演进路线（建议）

1. 将输入渲染抽成 `InputRegionManager`（与 `LiveRegionManager` 职责解耦）
2. Unicode 宽度改为成熟库（如 `string-width`）
3. 引入渲染快照测试（对 ANSI 控制序列做规范化后断言）
4. `controller.ts` 输入状态机拆分成独立模块，降低复杂度

---

## 20. 快速实现清单（从零到可用）

如果你要在新项目复刻当前方案，可按以下顺序实现：

1. 定义 UI 事件模型（`types.ts`）
2. 写 `LiveRegionManager`（基于 `log-update`）
3. 写 `TerminalUi`（先支持 user/system/run/tool 基础流）
4. 写 `input-parser`（raw chunk -> parse result）
5. 写 `controller`（run loop + raw mode 输入）
6. 加 bracketed paste 支持
7. 加粘贴折叠占位符与原子删除
8. 加防自动提交与防抖动
9. 写插件桥接 `plugin.ts`
10. 补齐测试矩阵并跑回归

---

## 21. 关联文件索引

1. `examples/agent-ui/index.ts`
2. `src/cli/controller.ts`
3. `src/cli/terminal-ui.ts`
4. `src/cli/input-parser.ts`
5. `src/cli/live-region.ts`
6. `src/cli/plugin.ts`
7. `src/cli/markdown-renderer.ts`
8. `src/cli/types.ts`
9. `src/cli/__tests__/controller.test.ts`
10. `src/cli/__tests__/terminal-ui.test.ts`
11. `src/cli/__tests__/input-parser.test.ts`
12. `src/cli/__tests__/bugs.test.ts`
13. `src/cli/__tests__/deep-bugs.test.ts`

