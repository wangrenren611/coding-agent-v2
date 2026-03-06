# Task V3

Task V3 is an independent task orchestration stack (separate from Task V2) with SQLite/WAL persistence and strict `session_id` isolation.

## Main goals
- Reduce LLM-facing complexity.
- Keep robust Task/Run persistence and recovery.
- Support concurrent sub-agent execution with dependency-aware scheduling.

## LLM-facing tools
- `task`: single delegated task (`prompt + profile + title + description`).
- `tasks`: batch delegated tasks with `depends_on` and `max_parallel` orchestration.
- `task_get` / `task_list` / `task_update`
- `task_run_get` / `task_run_wait` / `task_run_cancel` / `task_run_events`
- `task_clear_session` / `task_gc_runs`

## Storage tables
- `task_v3_tasks`
- `task_v3_dependencies`
- `task_v3_runs`
- `task_v3_run_events`

Default DB path: `$workspace/.agent-cli/tasks.db`.
