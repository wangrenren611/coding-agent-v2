# 当前项目 Bug 排查报告

- 报告日期：2026-03-13
- 项目路径：`D:\work\coding-agent-v2`
- 排查方式：基于本地实际执行 `build` / `tsc` / `vitest` / `ci:check` 的结果

## 1. 结论摘要

当前存在 **4 类可复现问题**：

1. `providers` 测试文件导入路径错误，导致测试文件无法加载。
2. `StandardAdapter.transformRequest` 的类型定义与测试/设计预期不一致（默认模型场景触发 TS 错误）。
3. `system` 参数未做空值/空白过滤，导致 4 个单测失败。
4. 根目录 `package.json` 的 CI 脚本配置错误（调用了不存在脚本，且包含不存在路径）。

---

## 2. 复现命令与现象

### 2.1 构建与类型检查

执行：

```bash
pnpm -C "D:\work\coding-agent-v2" build
pnpm -C "D:\work\coding-agent-v2" exec tsc --noEmit
```

现象：均失败，核心错误为：

- `src/providers/__tests__/index.test.ts:3`
  - `TS2307: Cannot find module '../../index'...`
- `src/providers/adapters/__tests__/standard.test.ts:54`
  - `TS2345: Argument of type '{ messages: LLMRequestMessage[]; }' is not assignable to parameter of type 'LLMRequest'.`
  - 缺失必填属性 `model`

### 2.2 定向测试

执行：

```bash
pnpm -C "D:\work\coding-agent-v2" exec vitest run src/providers/__tests__/index.test.ts
pnpm -C "D:\work\coding-agent-v2" exec vitest run src/providers/adapters/__tests__/standard.test.ts
```

现象：

- `src/providers/__tests__/index.test.ts`：测试文件加载失败（0 tests）
  - 错误：`Failed to load url ../../index ... Does the file exist?`
- `src/providers/adapters/__tests__/standard.test.ts`：16 项中 4 项失败
  - 失败点：
    - `src/providers/adapters/__tests__/standard.test.ts:98`
    - `src/providers/adapters/__tests__/standard.test.ts:110`
    - `src/providers/adapters/__tests__/standard.test.ts:122`
    - `src/providers/adapters/__tests__/standard.test.ts:145`
  - 共同问题：`request.system` 未过滤空字符串与仅空白字符串

### 2.3 CI 脚本检查

执行：

```bash
pnpm -C "D:\work\coding-agent-v2" run ci:check
```

现象：失败，包含两类配置问题：

- `package.json:22` 的 `format:fix` 包含 `examples/**/*.ts`，仓库无该路径
  - 报错：`No files matching the pattern were found: "examples/**/*.ts"`
- `package.json:23` 的 `ci:check` 调用了不存在的脚本：`typecheck`、`lint`、`test:run`

---

## 3. Bug 明细

## Bug-01 导入路径错误（阻断测试）

- 严重级别：High
- 位置：`src/providers/__tests__/index.test.ts:3`
- 问题描述：
  - 该文件导入 `../../index`，会解析到 `src/index.ts`。
  - 但当前仓库没有 `src/index.ts`，实际导出位于 `src/providers/index.ts`。
- 影响：
  - 该测试套件无法加载，阻断相关测试执行。
- 建议修复：
  - 将导入路径改为 `../index`（从 `__tests__` 指向 `src/providers/index.ts`）。

## Bug-02 `transformRequest` 类型契约与默认模型逻辑冲突（阻断构建）

- 严重级别：High
- 位置：
  - 调用点：`src/providers/adapters/__tests__/standard.test.ts:54`
  - 签名：`src/providers/adapters/standard.ts:35`
  - 类型定义：`src/providers/types/api.ts:244`
- 问题描述：
  - `transformRequest(options?: LLMRequest)` 要求 `model` 必填。
  - 测试用例中存在“未传 model，使用 defaultModel”的预期。
  - 导致 TS 编译失败（类型层面不允许）。
- 影响：
  - 阻断 `tsc`、`build`。
  - 说明接口定义与实现意图不一致。
- 建议修复：
  - 放宽 `transformRequest` 的参数类型（允许 `model` 可选），并在函数内统一注入 `defaultModel`。

## Bug-03 `system` 参数清洗缺失（功能行为错误）

- 严重级别：Medium
- 位置：
  - 失败断言：`src/providers/adapters/__tests__/standard.test.ts:98`
  - 失败断言：`src/providers/adapters/__tests__/standard.test.ts:110`
  - 失败断言：`src/providers/adapters/__tests__/standard.test.ts:122`
  - 失败断言：`src/providers/adapters/__tests__/standard.test.ts:145`
  - 相关实现：`src/providers/adapters/standard.ts:35`
- 问题描述：
  - `system` 传入数组时未过滤 `''`、`'   '`、`'\t'`、`'\n'`。
  - `system` 为空字符串时未移除字段。
- 影响：
  - 请求体包含无效系统提示词，可能影响下游 provider 行为。
  - 导致现有 4 条回归测试失败。
- 建议修复：
  - 对 `system` 做 `trim` 后过滤空值；清洗后为空则不写入请求体。

## Bug-04 根目录 CI 脚本配置错误（阻断流水线）

- 严重级别：High
- 位置：
  - `package.json:22` (`format:fix`)
  - `package.json:23` (`ci:check`)
- 问题描述：
  - `format:fix` 里包含不存在的 `examples/**/*.ts`。
  - `ci:check` 引用了根包中未定义的脚本（`typecheck`、`lint`、`test:run`）。
- 影响：
  - CI 命令在进入真实质量检查前即失败。
- 建议修复：
  - 删除无效 glob 或改为存在路径。
  - 将 `ci:check` 改成已存在脚本名（如 `test`、`build`、`exec tsc --noEmit` 等）。

---

## 4. 影响评估与优先级建议

建议优先级：

1. 先修 `Bug-04`（确保 CI 可执行）
2. 再修 `Bug-01`、`Bug-02`（恢复构建与测试加载）
3. 最后修 `Bug-03`（功能语义与测试一致性）

---

## 5. 说明

- 本报告仅基于 2026-03-13 当天本机环境的实际执行结果。
- 未对 `opentui-agent-cli` 与 `agent-monitor` 子项目做完整回归，仅覆盖根项目与 `src/providers` 相关问题。
