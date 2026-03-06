export const TASK_V3_TOOLS = [
  'task',
  'tasks',
  'task_get',
  'task_list',
  'task_update',
  'task_run_get',
  'task_run_wait',
  'task_run_cancel',
  'task_run_events',
  'task_clear_session',
  'task_gc_runs',
] as const;

export type TaskV3ToolName = (typeof TASK_V3_TOOLS)[number];
