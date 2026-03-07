# Terminal Agent UI 架构（重构版）

## 1. 目标

采用混合渲染：

- Immutable Log：已完成消息只追加一次到 stdout，进入终端原生 scrollback。
- Live Overlay：底部实时状态行可反复更新，不写入历史。

这能同时满足：

- 使用终端自带滚动条查看历史。
- 底部持续展示动态运行状态。
- 已完成消息稳定不变，处理中状态可刷新。

## 2. 关键模块

- `src/cli/terminal-ui.ts`
  - 事件驱动 UI 主控。
  - 维护运行状态、工具执行缓冲、assistant 增量缓冲。
  - 负责事件归一化与最终日志样式输出。
- `src/cli/live-region.ts`
  - 底部实时区管理器。
  - 提供 `render/hide/withHidden/clear`，确保写历史日志前先清理实时区并在写后恢复。
- `src/cli/controller.ts`
  - 读取用户输入、处理 slash 命令、对接 `agent.run`。
  - 处理工具确认交互，并在确认期间临时隐藏实时区。
- `src/cli/plugin.ts`
  - Agent hook 事件桥接：`textDelta/toolStream/toolConfirm/step/stop` -> UI 事件。

## 3. 终端写入协议

1. 任何历史日志写入前，先隐藏 Live Overlay。
2. 写入不可变日志（带换行）。
3. 写入完成后恢复 Live Overlay。
4. 仅状态刷新时，不写历史，只重绘 Live Overlay。

## 4. 样式规则

- 工具标题：`● Read(...)` / `● Bash(...)`（绿点 + 粗体）
- 工具子行：`└ ...` 树形结构
- 长输出：`… +N lines (ctrl+o to expand)`
- 底部状态：`* Shimmying… (Esc to interrupt · Xs · ⠙ thinking)`
- 输入区：分隔线 + `› ` + `? for shortcuts`

## 5. 已删除的旧兼容实现

本次重构已移除：

- `layout.ts` / `renderer.ts` / `state.ts`
- 内部滚动命令与相关事件（`transcript.scroll` / `transcript.tail`）
- frame/fullscreen 重绘路径

当前 CLI 保留单一路径：混合渲染（append + live overlay）。
