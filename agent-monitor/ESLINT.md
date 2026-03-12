# ESLint 配置说明

## 安装

ESLint 及相关依赖已包含在 `devDependencies` 中：

```json
{
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^8.57.0",
    "@typescript-eslint/parser": "^8.57.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "14.2.3",
    "eslint-plugin-react": "^7.37.5",
    "eslint-plugin-react-hooks": "^7.0.1",
    "eslint-plugin-vitest": "^0.5.4"
  }
}
```

## 配置文件

### `.eslintrc.json`

主要配置项：

- **extends**: 
  - `next/core-web-vitals` - Next.js 推荐配置
  - `plugin:@typescript-eslint/recommended` - TypeScript 推荐规则

- **plugins**:
  - `@typescript-eslint` - TypeScript 规则
  - `vitest` - 测试文件规则（仅在测试文件中启用）

- **重要规则**:
  - `@typescript-eslint/no-explicit-any` - 警告使用 `any` 类型
  - `@typescript-eslint/no-unused-vars` - 错误：未使用的变量
  - `@typescript-eslint/consistent-type-imports` - 错误：要求使用 `import type`
  - `no-console` - 警告：禁止使用 `console.log`（允许 `warn` 和 `error`）
  - `prefer-const` - 错误：优先使用 `const`
  - `eqeqeq` - 错误：要求使用 `===` 和 `!==`
  - `curly` - 错误：要求所有控制语句使用大括号

### 覆盖配置

**测试文件** (`__tests__/**/*.ts`):
- 放宽 `no-explicit-any` 限制（Mock 需要）
- 放宽 unsafe 相关规则

**API 路由** (`app/api/**/*.ts`):
- 放宽 unsafe 相关规则（NextResponse 需要）

## NPM 脚本

```bash
# 运行 ESLint（自动修复）
pnpm lint

# 运行 ESLint（仅检查）
pnpm lint:check

# 运行 ESLint 并自动修复
pnpm lint:fix

# 运行 Prettier（格式化）
pnpm format

# 运行 Prettier（仅检查）
pnpm format:check

# 完整检查（lint + format + test + build）
pnpm check
```

## 忽略文件

`.eslintignore` 中配置：

```
node_modules
.next
dist
coverage
__tests__/fixtures
__mocks__
```

## VS Code 集成

推荐安装以下扩展：

- ESLint (dbaeumer.vscode-eslint)
- Prettier - Code formatter (esbenp.prettier-vscode)

`.vscode/settings.json` 推荐配置：

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact"
  ]
}
```

## 规则说明

### TypeScript 规则

| 规则 | 级别 | 说明 |
|------|------|------|
| `@typescript-eslint/no-explicit-any` | warn | 避免使用 `any` 类型 |
| `@typescript-eslint/no-unused-vars` | error | 未使用的变量 |
| `@typescript-eslint/consistent-type-imports` | error | 类型导入使用 `import type` |

### React 规则

| 规则 | 级别 | 说明 |
|------|------|------|
| `react-hooks/rules-of-hooks` | error | Hooks 使用规则 |
| `react-hooks/exhaustive-deps` | warn | useEffect 依赖检查 |

### 通用规则

| 规则 | 级别 | 说明 |
|------|------|------|
| `no-console` | warn | 禁止 console.log |
| `prefer-const` | error | 优先使用 const |
| `no-var` | error | 禁止使用 var |
| `eqeqeq` | error | 使用严格相等 |
| `curly` | error | 控制语句使用大括号 |

## 禁用规则

### 单行禁用

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const value: any = getData();
```

### 多行禁用

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
function legacyFunction(data: any) {
  // ...
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

### 文件级禁用

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
// 整个文件禁用该规则
```

## 常见问题

### 1. `any` 类型警告

**问题**: 使用 `any` 类型会触发警告

**解决**: 
- 使用具体类型
- 使用 `unknown` 代替
- 使用类型断言 `as Type`
- 在必要时使用 `eslint-disable` 注释

### 2. 未使用的变量

**问题**: 声明但未使用的变量

**解决**:
- 删除未使用的变量
- 使用前缀 `_` 命名 intentionally unused 变量

```typescript
const _unused = 'intentionally unused';
```

### 3. 类型导入

**问题**: 类型应该使用 `import type`

**解决**:

```typescript
// ❌ 错误
import { MyType } from './types';

// ✅ 正确
import type { MyType } from './types';
```

### 4. console.log 警告

**问题**: 使用 `console.log` 会触发警告

**解决**:
- 生产代码移除 `console.log`
- 使用 `console.warn` 或 `console.error`
- 使用日志库（如 `winston`、`pino`）

## CI/CD 集成

在 CI 环境中运行完整检查：

```bash
pnpm check
```

这会依次运行：
1. `pnpm lint:check` - ESLint 检查
2. `pnpm format:check` - Prettier 格式检查
3. `pnpm test:run` - 运行测试
4. `pnpm build` - 构建项目

## 更新规则

要更新或添加规则，编辑 `.eslintrc.json`：

```json
{
  "rules": {
    "new-rule": "error"
  }
}
```

参考：
- [ESLint Rules](https://eslint.org/docs/rules/)
- [TypeScript ESLint Rules](https://typescript-eslint.io/rules/)
- [Next.js ESLint](https://nextjs.org/docs/basic-features/eslint)
