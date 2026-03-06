# Task V2 Architecture

## Principles
1. Separate domain intent (Task) from execution attempts (Run).
2. Enforce `sessionId` on every repository query.
3. Use immutable event history for run progress (`RunEvent`).
4. Avoid process-local source of truth for task state.

## Domain
- `Task`: user-facing work unit.
- `TaskDependency`: directed edge (`taskId` depends on `dependsOnTaskId`).
- `Run`: one execution attempt (manual or delegated).
- `RunEvent`: append-only timeline.

## Service Layer
`TaskService` owns business rules:
- state transitions
- dependency validation and cycle detection
- run lifecycle orchestration

## Repository Layer
`TaskRepository` is the only persistence boundary.
Implementations can be SQLite/remote API/etc.

## Runner Layer
`TaskRunner` executes runs and emits events. It should be recoverable after process restart.

## Migration (high level)
1. Build V2 repository implementation.
2. Mirror new writes into V2 behind a flag.
3. Switch reads to V2.
4. Delete V1 task tools and adapters.
