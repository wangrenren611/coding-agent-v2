export const BASH_TOOL_DESCRIPTION = `Executes a given shell command with optional timeout.

IMPORTANT: This tool is for terminal operations like git, npm, docker, and test commands.
DO NOT use it for file operations (reading, writing, editing, searching, finding files) when
dedicated tools are available. Use file_read, file_edit, write_file, glob, and grep instead.

Usage notes:
- command is required.
- timeout is optional, max 600000ms. If omitted, default timeout is 60000ms.
- run_in_background can be used for long-running commands when immediate output is not required.
- Do not append "&" manually when run_in_background=true.
- Quote file paths that contain spaces.
- Prefer absolute paths and avoid unnecessary "cd" usage.

When issuing multiple commands:
- If independent, run multiple bash calls in parallel.
- If dependent, chain with "&&" (or ";" when later commands should still run on failure).
- Do not separate commands with raw newlines.`;

export const GLOB_TOOL_DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths for downstream tools
- Use this tool when you need to find files by name patterns
- For open-ended multi-round exploration, prefer the Task tool with an exploration subagent
- It is often better to run multiple glob searches in parallel when useful`;

export const GREP_TOOL_DESCRIPTION = `A powerful search tool built on ripgrep.

Usage:
- ALWAYS use this tool for content search tasks. Do not run "grep" or "rg" via bash for normal searches.
- Supports full regex syntax (for example "log.*Error" or "function\\s+\\w+").
- Use the glob parameter to constrain files (for example "**/*.ts" or "src/**/*.tsx").
- Use Task for broad open-ended search workflows that need many iterative rounds.
- Ripgrep regex semantics apply. Escape literals when needed.`;

export const FILE_READ_TOOL_DESCRIPTION = `Read a UTF-8 text file from the local filesystem.

Usage:
- path can be absolute or relative.
- startLine and endLine are optional 1-based inclusive bounds.
- By default, reads the full file content.
- This tool only reads files (not directories).
- For directory listing or shell-level inspection, use bash.
- Large output may be truncated for safety.`;

export const FILE_EDIT_TOOL_DESCRIPTION = `Apply one or more old/new text replacements to a single file and return a unified diff.

Recommended workflow:
1. Read latest content with file_read.
2. Build all intended replacements in one file_edit call.
3. Use dry_run=true to preview before writing when risk is high.

Notes:
- Edits are applied in order.
- If oldText is not found, the tool returns EDIT_CONFLICT so you can re-read and retry.
- This is preferred over write_file for precise incremental edits to existing files.`;

export const WRITE_FILE_TOOL_DESCRIPTION = `Writes file content to the local filesystem.

Behavior:
- direct mode writes content immediately.
- direct mode buffers the full payload when it exceeds the chunk limit and returns a bufferId.
- finalize mode commits buffered content to the target file and can resolve the target path from bufferId.

Usage notes:
- Prefer editing existing files with file_edit when possible.
- Use write_file when replacing full content or when buffered large writes are required.
- Provide plain text content directly, not Markdown code fences.
- Avoid creating new documentation files unless the user explicitly asks.`;

export const TASK_TOOL_DESCRIPTION = `Launch a new agent to handle complex, multi-step tasks autonomously.

The Agent tool launches specialized subagents that autonomously handle complex work. Each subagent type has a specific role and an explicit tool allowlist.

Available subagent types and their default tools:
- Bash: terminal and command execution specialist. Use for focused shell work. (Tools: bash)
- general-purpose: broad multi-step research and implementation agent. Use when the task may require several rounds of searching, reading, editing, and verification. (Tools: bash, glob, grep, file_read, file_edit, write_file, skill)
- Explore: fast codebase exploration and discovery agent. Use for open-ended codebase exploration, pattern-based file discovery, and multi-round keyword searches. (Tools: glob, grep, file_read, skill)
- Plan: implementation planning and architecture strategy agent. Use when you need a concrete implementation plan, critical file list, risks, and trade-offs before editing code. (Tools: glob, grep, file_read, skill)
- research-agent: long-form research and synthesis agent. Use when you need evidence collection and structured findings from local project context. (Tools: glob, grep, file_read, skill)
- claude-code-guide: coding guidance and navigation focused agent. Use when you need concise, codebase-grounded implementation direction or file/navigation help. (Tools: glob, grep, file_read, skill)
- find-skills: local skill lookup + installation guidance agent. Use to discover the right skill, prefer local skills first, and fall back to verified installation steps when needed. (Tools: skill, bash)

When to use the Agent tool:
- Complex, multi-step work that benefits from delegation.
- Open-ended exploration or research that will likely take multiple searches.
- Parallel, independent branches of investigation.
- Broad codebase search when you are not confident a direct glob/grep query will find the right match in the first few tries.

When NOT to use the Agent tool:
- If you already know the file path, use file_read.
- If you need a direct filename/pattern match, use glob.
- If you need exact content search, use grep.
- If you only need to inspect one file or a small known set of files, use direct tools instead.

Usage notes:
- Always include a short description (3-5 words) summarizing the subagent run.
- Always set subagent_type explicitly to the agent you want.
- Use foreground execution when you need the result before continuing.
- Use run_in_background=true only when the work is genuinely independent.
- For background runs, use task_output to retrieve status/output later and task_stop to cancel when needed.
- Launch multiple task calls in parallel when the work is independent.
- The subagent result is returned to you through the tool response; summarize relevant findings to the user.
- Provide a clear prompt that states whether the subagent should research only or also make code changes.
- For direct needle queries, prefer direct tools first (glob/grep/file_read/file_edit).`;

export const TASK_CREATE_DESCRIPTION = `Use this tool to create a structured task list entry for the current coding session.

When to use:
- Multi-step implementation work.
- Non-trivial tasks that benefit from explicit tracking.
- User requests a todo/task list.
- You need clearer progress visibility for the user.

Task fields:
- subject: imperative short title.
- description: detailed task context and acceptance criteria.
- active_form: present-continuous text shown while in progress.`;

export const TASK_GET_DESCRIPTION = `Retrieve a task by ID from the task list.

Use this to:
- Read full task requirements before execution.
- Inspect dependency and blocker information.
- Decide whether a task can start now.`;

export const TASK_LIST_DESCRIPTION = `List tasks in the namespace with summary state.

Use this to:
- Find available work items.
- Review overall progress and blocked tasks.
- Pick the next task after finishing current work.

Tip:
- Prefer lower-ID tasks first when multiple tasks are available.`;

export const TASK_UPDATE_DESCRIPTION = `Update a task in the task list.

Use this to:
- Move task status through workflow.
- Update subject/description/owner/progress/metadata.
- Add or remove dependency edges.
- Mark tasks completed, failed, cancelled, or back to pending when appropriate.

Best practice:
- Read the latest task state before updating to avoid stale writes.`;

export const TASK_STOP_DESCRIPTION = `Stops a running subagent execution by agent_id or linked task_id.

Usage:
- Provide agent_id directly when available.
- Or provide task_id to resolve the linked agent run.
- Optionally cancel linked planning tasks in the same call.`;

export const TASK_OUTPUT_DESCRIPTION = `Retrieves output from a running or completed task (background shell, agent, or remote session) - Takes a task_id parameter identifying the task - Returns the task output along with status information - Use block=true (default) to wait for task completion - Use block=false for non-blocking check of current status - Task IDs can be found using the /tasks command - Works with all task types: background shells, async agents, and remote sessions`;

export const SKILL_TOOL_BASE_DESCRIPTION = `Load a skill to get detailed task-specific instructions.
Skills contain specialized workflows and reusable operational context.`;

export const SKILL_FIND_TOOL_DESCRIPTION = `Automatically find the most relevant skill for a user request.

Usage:
- Provide query with the task intent or requirement.
- top_k controls how many ranked candidates are returned (default 5).
- min_score filters weak matches (default 0.1).
- auto_load=true returns full matched skill content in the same call.

When to use:
- User asks "which skill should I use?".
- Skill name is unknown but task intent is clear.
- You need ranked skill suggestions before loading one manually.`;
