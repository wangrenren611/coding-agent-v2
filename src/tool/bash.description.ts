/**
 * Bash 工具描述
 */

export default `Executes a given bash command with optional timeout. Working directory persists between
commands; shell state (everything else) does not. The shell environment is initialized
from the user's profile (bash or zsh).

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc.
DO NOT use it for file operations (reading, writing, editing, searching, finding files) -
use the specialized tools instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`ls\` to verify
     the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use \`ls foo\` to check that
     "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes
   - Examples of proper quoting:
     - cd "/Users/name/My Documents" (correct)
     - cd /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
- The command argument is required.
- You can specify an optional timeout in milliseconds (up to 600000ms / 10 minutes).
  If not specified, commands timeout after 60000ms (1 minute).
- It's very helpful if you write a clear, concise description of what the command does.
  For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):
    - ls → List files in current directory
    - git status → Show working tree status
    - npm install → Install package dependencies
  For commands harder to parse at a glance (piped commands, obscure flags, or anything
  hard to understand at a glance), add enough context to clarify what it does:
    - find . -name "*.tmp" -exec rm {} \\; → Find and delete all .tmp files recursively
    - git reset --hard origin/main → Discard all local changes and match remote main
    - curl -s url | jq '.data[]' → Fetch JSON from URL and extract data array elements
- You can use the \`run_in_background\` parameter to run the command in the background.
  Only use this if you don't need the result immediately and are OK being notified when
  it completes later. You do not need to check the output right away - you'll be notified
  when it finishes.
  - Don't use '&' at the end of the command when using this parameter.
- You should proactively use the Task tool in parallel if the command will take a while
  to run and you have other work you can move on to.

When issuing multiple commands:
- If the commands are independent and can run in parallel, use the Bash tool in parallel
  with multiple tool calls. For example, if you need to run "git status" and "git diff",
  send a single message with two Bash tool calls in parallel.
- If the commands depend on each other and must run sequentially, use a single Bash
  call with '&&' to chain them together (e.g., \`mkdir foo && cd foo && ls\`), or ';'
  if they can run sequentially but the later commands should run even if earlier ones fail
  (e.g., \`command1; command2; command3\`).
- DO NOT use newlines to separate commands (newlines are ok in quoted strings)
- Try to maintain your current working directory throughout the session by using absolute
  paths and avoiding usage of \`cd\`. You may use \`cd\` if the User explicitly requests it.

# Committing changes with git

Only create commits when requested by the user. If unclear, ask first.

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive git commands (push --force, reset --hard, checkout ., restore .,
  clean -f, branch -D) unless the user explicitly requests these actions.
  Taking unauthorized destructive actions is unhelpful and can result in lost work,
  so it's best to ONLY run these commands when given direct instructions
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc.) unless the user explicitly
  requests them
- NEVER force push to main/master, warn the user if they request it
- CRITICAL: Always create NEW commits rather than amending, unless the user explicitly
  requests a git amend. When a pre-commit hook fails, the commit did NOT happen —
  so --amend would modify the PREVIOUS commit, which may result in destroying work
  or losing previous changes. Instead, after hook failure, fix the issue, re-stage,
  and create a NEW commit
- When staging files, prefer adding specific files by name rather than using "git add -A"
  or "git add .", which can accidentally include sensitive files (.env, credentials.json,
  etc) or large binaries
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT
  to only commit when explicitly asked, otherwise users may feel you're being too proactive

1. Analyze all staged changes (both previously staged and newly added) and draft a commit
   message:
   - Summarize the nature of the changes (eg. new feature, enhancement to an existing
     feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately
     reflects the changes and their purpose (i.e. "add" means a wholly new feature,
     "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.)
   - Do not commit files that likely contain secrets (.env, credentials.json, etc).
     Warn the user if they specifically request to commit those files
   - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather
     than the "what"
   - Ensure it accurately reflects the changes and their purpose

2. Create the commit with a message ending with:
   Co-Authored-By: Claude <noreply@anthropic.com>

3. Use a HEREDOC to pass the commit message to ensure correct formatting, e.g.:
   git commit -m "$(cat <<'EOF'
   Commit message here.

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"

# Creating pull requests

Use the gh command via the Bash tool for ALL GitHub-related tasks including working with
issues, pull requests, checks, and releases. If given a Github URL use the gh command
to get the information needed.

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. Run in parallel: git status, git diff, git log, and \`git diff [base-branch]...HEAD\`
   to understand the full commit history for the current branch from the time it diverged
   from the base branch

2. Analyze all changes that will be included in the pull request (looking at ALL commits,
   not just the latest commit, and understanding that the PR will include all commits
   from the divergence point)

3. Draft a pull request title and summary:
   - Keep the PR title short (under 70 characters)
   - Use the description/body for details, not the title

4. Run in parallel: create new branch if needed, push to remote with -u flag if needed,
   and create PR using gh pr create with the format below. Use a HEREDOC to pass the
   body to ensure correct formatting.

gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

Important:
- DO NOT use the TodoWrite or Task tools
- Return the PR URL when you're done, so the user can see it`;
