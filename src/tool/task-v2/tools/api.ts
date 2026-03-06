export const TASK_V2_TOOLS = [
  'task_create',
  'task_get',
  'task_list',
  'task_update',
  'task_delete',
  'task_dependency_add',
  'task_dependency_remove',
  'task_dependency_list',
  'task_submit',
  'task_dispatch_ready',
  'task_run_start',
  'task_run_get',
  'task_run_wait',
  'task_run_cancel',
  'task_run_events',
  'task_clear_session',
  'task_gc_runs',
] as const;

export type TaskV2ToolName = (typeof TASK_V2_TOOLS)[number];
