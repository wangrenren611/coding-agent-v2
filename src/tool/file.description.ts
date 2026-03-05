export default `Performs safe file-system operations inside configured allowed directories.

Supported actions:
- read: read full text content
- write: write full text content (supports atomic write and etag check)
- edit: apply old/new text edits and return unified diff
- patch: apply unified diff patch
- list: list directory entries
- stat: stat file or directory
- search: recursive glob search from a root path
- head: read first N lines
- tail: read last N lines

Notes:
- All paths are validated against allowed directories.
- Actions are routed through pluggable file backends (local/remote/sandbox).
- Prefer edit or patch for code updates to keep changes auditable.`;
