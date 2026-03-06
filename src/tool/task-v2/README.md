# Task V2

Task V2 is the current task implementation wired into CLI/tool manager.

## 这个工具拿来做什么
- 把“任务管理”和“任务执行”统一成一套模型，避免旧版 `task_*` / `task_output` 的语义混乱。
- 支持在同一会话中完整闭环：
  - 建任务（`task_create`）
  - 建依赖（`task_dependency_add` / `task_dependency_list` / `task_dependency_remove`）
  - 改状态（`task_update`）
  - 一次性提交（`task_submit`，可选自动等待完成）
  - DAG 调度（`task_dispatch_ready`，并发调度依赖就绪任务）
  - 启动子智能体执行（`task_run_start`）
  - 追踪进度（`task_run_events` / `task_run_wait`）
  - 取消和清理（`task_run_cancel` / `task_clear_session`）
- 关键作用：
  - 强制 `session_id` 隔离，避免跨会话读写越权。
  - SQLite/WAL 持久化，避免 JSON 文件并发丢数据。
  - Run 事件流可回放，便于观察子智能体执行过程。

## 一个最小例子
1. `task_submit` 直接提交：
   - `prompt="先定位根因，再给最小修复补丁"`
   - `profile="bug-analyzer"`
   - `title="修复登录接口 500 错误"`
   - `description="登录接口在高并发下偶发 500，先给根因再给最小修复"`
   - `wait=true`
2. 返回中直接拿到：
   - 创建后的 task
   - run 当前状态（默认已等待）
   - 可选事件列表（`include_events=true`）

## Goals
- One domain model for planning and execution.
- Strict `session_id` isolation for all reads/writes.
- Concurrency-safe storage with SQLite/WAL and transactions.
- Recoverable runner with append-only run events.

## Docs
- `docs/architecture.md`: architecture overview.
- `docs/tool-execution-flow.md`: detailed tool execution flow (API -> service -> runner -> repository).

## Key Source Files
- `types.ts`: domain model and state enums.
- `errors.ts`: typed domain errors.
- `service.ts`: domain rules and orchestration.
- `storage/repository.ts`: persistence interface.
- `storage/sqlite-repository.ts`: SQLite repository implementation.
- `runtime/runner.ts`: runner contract.
- `runtime/sqlite-runner.ts`: runner implementation.
- `runtime/runtime.ts`: runtime assembly and session resolution.
