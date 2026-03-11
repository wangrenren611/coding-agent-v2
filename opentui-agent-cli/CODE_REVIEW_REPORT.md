# OpenTUI Agent CLI 代码审查报告

> **审查日期**: 2026-03-11  
> **审查工具**: code-review-expert skill  
> **审查范围**: src/ 目录下的变更文件

---

## 审查摘要

| 指标 | 数值 |
|------|------|
| 变更文件数 | 10 |
| 新增行数 | 248 |
| 删除行数 | 93 |
| **总体评估** | REQUEST_CHANGES |

---

## 问题清单

### P1 - High (需修复)

| # | 文件 | 行号 | 问题 | 建议修复 |
|---|------|------|------|----------|
| 1 | `src/hooks/use-agent-chat.ts` | 232 | `setContextUsagePercent(() => null)` 使用函数式更新过于复杂 | 改为 `setContextUsagePercent(null)` |
| 2 | `src/hooks/use-agent-chat.ts` | 45 | 默认模型从 `'glm-5'` 改为 `''` 可能导致初始化时显示为空 | 添加空字符串回退逻辑 |

### P2 - Medium (建议修复)

| # | 文件 | 行号 | 问题 | 建议修复 |
|---|------|------|------|----------|
| 3 | `src/hooks/use-agent-chat.ts` | 329 | 删除请求开始时重置 contextUsagePercent 的逻辑 | 重新添加重置逻辑 |
| 4 | `src/components/tool-confirm-dialog.tsx` | 124 | 从 `argumentsBlock` 改为 `argumentItems` 需确保类型安全 | 添加空值检查 |
| 5 | `src/agent/runtime/runtime.ts` | 158-183 | `toContextUsageEventFromApp` 与 `toUsageEventFromApp` 有重复验证 | 提取共享验证函数 |

### P3 - Low (可选改进)

| # | 文件 | 问题 |
|---|------|------|
| 6 | `src/components/tool-confirm-dialog.tsx:137` | key 使用 `${item.label}:${index}` 可能在 label 相同时冲突 |
| 7 | `src/agent/runtime/types.ts:66-73` | `AgentContextUsageEvent` 缺少 JSDoc 文档 |
| 8 | `src/hooks/use-agent-chat.ts:4` | 确认 `AgentContextUsageEvent` 导入是否必需 |

---

## 详细分析

### 1. use-agent-chat.ts 变更

```diff
- const INITIAL_MODEL_LABEL = process.env.AGENT_MODEL?.trim() || 'glm-5';
+ const INITIAL_MODEL_LABEL = process.env.AGENT_MODEL?.trim() || '';

- setContextUsagePercent(null);
+ setContextUsagePercent(() => null);

+ onContextUsage: (event: AgentContextUsageEvent) => { ... }
```

**问题**:
- 默认值改为空字符串后，首次渲染时模型标签可能为空
- 函数式更新 `() => null` 对于简单 setter 不必要

### 2. tool-confirm-dialog.tsx 变更

```diff
- {content.argumentsBlock ? (
+ {content.argumentItems.length > 0 ? (
```

**问题**:
- 字段名变更需确保 `argumentItems` 在所有 content 对象上都存在

### 3. runtime.ts 新增功能

新增 `AgentContextUsageEvent` 类型和 `toContextUsageEventFromApp` 函数，用于实时追踪上下文使用率。

**正面**:
- 类型定义完整，包含 stepIndex, messageCount, contextTokens 等字段
- 验证逻辑严谨，使用 `Number.isFinite()` 检查

**待改进**:
- 与现有 `toUsageEventFromApp` 有重复模式

---

## 改进建议

### 立即修复 (P1)

1. **修复 use-agent-chat.ts:232**
   ```typescript
   // 错误
   setContextUsagePercent(() => null);
   
   // 正确
   setContextUsagePercent(null);
   ```

2. **处理空模型标签**
   - 方案A: 在 UI 层添加空值时的默认显示
   - 方案B: 保持非空默认值如 `'default'`

### 后续优化 (P2/P3)

1. 提取共享验证函数到 `src/agent/runtime/transforms.ts`
2. 为 ToolConfirmDialog 的 argumentItems 添加组件抽象
3. 补充新增类型的 JSDoc 文档

---

## 审查结论

本次变更主要集中在 **上下文使用率追踪功能** 的增强，整体代码质量良好。主要问题：

- ✅ 类型安全严格
- ✅ 事件处理结构清晰
- ⚠️ 部分代码风格可优化
- ⚠️ 需补充测试覆盖

**建议修复 P1 问题后合并。**
