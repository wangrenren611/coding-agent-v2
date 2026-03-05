export const TASK_TOOL_DESCRIPTION = `Launch a specialized sub-agent to execute a complex task.

Use this tool when work is open-ended, multi-step, or benefits from isolation.

Subagent types:
- bash: shell-centric execution
- general-purpose: balanced coding and analysis
- explore: codebase exploration and information gathering
- plan: implementation planning and tradeoff analysis
- ui-sketcher: UX structure and interaction design
- bug-analyzer: root-cause debugging and failure analysis
- code-reviewer: correctness/security/performance-focused review

Use run_in_background=true for long-running work.`;

export const TASK_CREATE_DESCRIPTION = `Create a managed task in the current session task list.`;
export const TASK_GET_DESCRIPTION = `Get a managed task by taskId.`;
export const TASK_LIST_DESCRIPTION = `List managed tasks for the current session.`;
export const TASK_UPDATE_DESCRIPTION = `Update or delete a managed task.`;
export const TASK_STOP_DESCRIPTION = `Stop a running background task by task_id.`;
export const TASK_OUTPUT_DESCRIPTION = `Get status/output for a background task by task_id.`;
