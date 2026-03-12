# Agent Monitor 测试文档

## 测试概览

本项目使用 [Vitest](https://vitest.dev/) 作为测试框架，配合 [Testing Library](https://testing-library.com/) 进行组件测试。

## 运行测试

```bash
# 运行所有测试
pnpm test

# 运行测试并生成覆盖率报告
pnpm test:coverage

# 运行测试 UI 界面
pnpm test:ui

# 单次运行测试（不监听）
pnpm test:run
```

## 测试文件结构

```
__tests__/
├── setup.ts                    # 测试配置文件 (Mock ResizeObserver 等)
├── db-real.test.ts             # 数据库层集成测试 (使用真实 SQLite)
├── api-runs.test.ts            # Runs API 路由测试
├── api-errors.test.ts          # Errors API 路由测试
├── api-stats.test.ts           # Stats API 路由测试
├── api-logs.test.ts            # Logs API 路由测试
├── integration.test.ts         # 集成测试
├── StatCards.test.tsx          # StatCards 组件测试
├── RunTable.test.tsx           # RunTable 组件测试
├── TokenUsageChart.test.tsx    # TokenUsageChart 组件测试
├── ErrorList.test.tsx          # ErrorList 组件测试
└── RunDetail.test.tsx          # RunDetail 组件测试
```

## 测试覆盖率

当前测试覆盖以下模块：

### 1. 数据库层 (`lib/db.ts`)

- ✅ `getRuns` - 获取运行列表
- ✅ `getRunById` - 按 ID 获取运行
- ✅ `getErrorLogs` - 获取错误日志
- ✅ `getLogsByExecution` - 获取指定运行的日志
- ✅ `getRunStats` - 获取运行统计 (Token 使用等)
- ✅ `getAggregateStats` - 获取聚合统计
- ✅ `getStatusDistribution` - 获取状态分布
- ✅ `getTokenUsageByDay` - 获取每日 Token 使用

### 2. API 路由测试

- ✅ `GET /api/runs` - 获取运行列表/详情
- ✅ `GET /api/errors` - 获取错误日志
- ✅ `GET /api/stats` - 获取统计数据
- ✅ `GET /api/logs` - 获取运行日志
- ✅ 错误处理测试
- ✅ 参数验证测试

### 3. 组件测试

- ✅ `StatCards` - 统计卡片组件
  - 渲染所有统计项
  - 显示正确数值
  - 格式化大数字
  - 处理零值

- ✅ `RunTable` - 运行列表组件
  - 渲染所有运行
  - 状态徽章显示
  - 搜索过滤
  - 状态筛选
  - 行点击事件
  - 空状态显示

- ✅ `TokenUsageChart` - Token 使用图表
  - 渲染图表容器
  - 处理空数据
  - 处理单数据点
  - 处理大数据

- ✅ `ErrorList` - 错误列表组件
  - 空状态显示
  - 错误列表渲染
  - 执行 ID 显示
  - 堆栈跟踪展开

- ✅ `RunDetail` - 运行详情组件
  - 加载状态
  - 运行详情显示
  - Token 统计
  - 日志显示
  - 日志筛选
  - 关闭事件
  - 错误信息显示
  - 时间戳显示

### 4. 集成测试

- ✅ 仪表盘数据流
- ✅ 运行详情数据流
- ✅ 错误处理
- ✅ 数据一致性

## 测试统计

- **测试文件**: 10
- **测试用例**: 71
- **通过率**: 100%

## Mock 策略

### 外部依赖 Mock

- `better-sqlite3` - 数据库模块 (API 测试中)
- `next/server` - Next.js 服务器模块
- `ResizeObserver` - 浏览器 API (用于 Recharts)
- `IntersectionObserver` - 浏览器 API
- `window.matchMedia` - 浏览器 API

### 真实数据库测试

`db-real.test.ts` 使用真实的 SQLite 数据库进行测试：

- 在 `/tmp/agent-test.db` 创建临时数据库
- 每个测试前创建表结构和测试数据
- 每个测试后清理数据库文件

## 最佳实践

1. **测试命名**: 使用 `should + 行为` 格式
2. **Arrange-Act-Assert**: 每个测试遵循 AAA 模式
3. **独立测试**: 每个测试独立运行，不依赖其他测试
4. **Mock 外部依赖**: API 和组件测试中 Mock 数据库
5. **真实集成**: 数据库层使用真实 SQLite 测试

## 持续集成

在 CI 环境中运行测试：

```bash
# 安装依赖
pnpm install

# 运行测试
pnpm test:run

# 生成覆盖率报告
pnpm test:coverage
```

## 故障排除

### ResizeObserver 错误

如果遇到 `ResizeObserver is not defined` 错误，确保 `__tests__/setup.ts` 已正确加载。

### 数据库锁定错误

如果数据库测试失败，确保没有其他进程访问测试数据库文件。

### 组件测试失败

检查组件是否正确导出了默认 export，确保测试中的导入路径正确。
