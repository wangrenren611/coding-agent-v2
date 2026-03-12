# Agent Monitor

Next.js 可视化监控界面，用于展示 `~/.agent-v4/agent.db` 数据库数据。

## 功能特性

- **运行状态概览** - 实时显示总运行数、运行中、已完成、失败等统计
- **Token 使用统计** - 7 天 Token 使用趋势图表
- **运行历史列表** - 可搜索、可筛选的运行记录表格
- **错误日志查看** - 最近的错误日志及堆栈跟踪
- **运行详情** - 点击运行记录查看详细日志、Token 使用、时间戳等信息

## 快速开始

### 安装依赖

```bash
cd agent-monitor
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

访问 http://localhost:3888

### 构建生产版本

```bash
pnpm build
pnpm start
```

## 技术栈

- **框架**: Next.js 14 (App Router)
- **样式**: TailwindCSS
- **图表**: Recharts
- **数据库**: better-sqlite3 (只读模式)
- **日期处理**: date-fns
- **图标**: Lucide React

## API 端点

| 端点                               | 描述                |
| ---------------------------------- | ------------------- |
| `GET /api/runs`                    | 获取运行列表        |
| `GET /api/runs?execution_id=xxx`   | 获取单个运行详情    |
| `GET /api/errors`                  | 获取错误日志        |
| `GET /api/stats`                   | 获取聚合统计        |
| `GET /api/stats?type=daily`        | 获取每日 Token 使用 |
| `GET /api/stats?type=distribution` | 获取状态分布        |
| `GET /api/logs?execution_id=xxx`   | 获取运行日志        |

## 截图预览

- 仪表盘显示所有关键指标
- 交互式图表展示 Token 使用趋势
- 可搜索和筛选的运行列表
- 详细的运行详情模态框

## 注意事项

- 数据库以只读模式打开，不会影响 agent 运行
- 默认端口为 3888
- 自动每 30 秒刷新数据
