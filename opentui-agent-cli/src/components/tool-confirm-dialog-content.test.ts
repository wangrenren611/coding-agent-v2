import { describe, expect, it } from "vitest";

import { buildToolConfirmDialogContent } from "./tool-confirm-dialog-content";

describe("buildToolConfirmDialogContent", () => {
  it("formats outside-workspace glob confirmations with path details", () => {
    const content = buildToolConfirmDialogContent({
      toolCallId: "call_1",
      toolName: "glob",
      args: {
        pattern: "**/*sandbox*",
        path: "/Users/wrr/work/ironclaw",
      },
      rawArgs: {
        pattern: "**/*sandbox*",
        path: "/Users/wrr/work/ironclaw",
      },
      reason:
        "SEARCH_PATH_NOT_ALLOWED: /Users/wrr/work/ironclaw is outside allowed directories: /Users/wrr/work/coding-agent-v2",
      metadata: {
        requestedPath: "/Users/wrr/work/ironclaw",
        allowedDirectories: ["/Users/wrr/work/coding-agent-v2"],
      },
    });

    expect(content.summary).toBe("Glob **/*sandbox*");
    expect(content.detail).toBe("Path: /Users/wrr/work/ironclaw");
    expect(content.requestedPath).toBe("/Users/wrr/work/ironclaw");
    expect(content.allowedDirectories).toEqual(["/Users/wrr/work/coding-agent-v2"]);
    expect(content.argumentsBlock).toContain('"pattern": "**/*sandbox*"');
  });

  it("formats bash confirmations with command preview", () => {
    const content = buildToolConfirmDialogContent({
      toolCallId: "call_2",
      toolName: "bash",
      args: {
        description: "List repo files",
        command: "rg --files src",
      },
      rawArgs: {
        description: "List repo files",
        command: "rg --files src",
      },
    });

    expect(content.summary).toBe("Run bash: List repo files");
    expect(content.detail).toBe("$ rg --files src");
    expect(content.reason).toBeUndefined();
  });
});
