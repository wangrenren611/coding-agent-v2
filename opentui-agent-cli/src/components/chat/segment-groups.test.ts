import { describe, expect, it } from "vitest";

import type { ReplySegment } from "../../types/chat";
import { buildReplyRenderItems } from "./segment-groups";

describe("buildReplyRenderItems", () => {
  it("groups tool segments by call id and keeps non-tool segments in place", () => {
    const segments: ReplySegment[] = [
      { id: "1:thinking:1", type: "thinking", content: "thinking" },
      {
        id: "1:tool-use:call_a",
        type: "code",
        content: "# Tool: bash (call_a)\n$ echo a\n",
        data: { id: "call_a", function: { name: "bash", arguments: "{\"command\":\"echo a\"}" } },
      },
      { id: "1:tool:call_a:stdout", type: "code", content: "a\n" },
      {
        id: "1:tool-result:call_a",
        type: "code",
        content: "# Result: bash (call_a) success\na\n",
        data: { result: { success: true, data: { output: "a" } } },
      },
      { id: "1:text:2", type: "text", content: "done" },
    ];

    const items = buildReplyRenderItems(segments);
    expect(items.map((item) => item.type)).toEqual(["segment", "tool", "segment"]);
    expect(items[1]?.type === "tool" ? items[1].group.toolCallId : "").toBe("call_a");
    expect(items[1]?.type === "tool" ? items[1].group.streams.length : 0).toBe(1);
    expect(items[1]?.type === "tool" ? items[1].group.use?.data : undefined).toEqual({
      id: "call_a",
      function: { name: "bash", arguments: "{\"command\":\"echo a\"}" },
    });
    expect(items[1]?.type === "tool" ? items[1].group.result?.data : undefined).toEqual({
      result: { success: true, data: { output: "a" } },
    });
  });

  it("starts a new tool group when call id changes", () => {
    const segments: ReplySegment[] = [
      { id: "1:tool-use:call_a", type: "code", content: "# Tool: bash (call_a)\n$ echo a\n" },
      { id: "1:tool-result:call_a", type: "code", content: "# Result: bash (call_a) success\na\n" },
      { id: "1:tool-use:call_b", type: "code", content: "# Tool: bash (call_b)\n$ echo b\n" },
      { id: "1:tool-result:call_b", type: "code", content: "# Result: bash (call_b) success\nb\n" },
    ];

    const items = buildReplyRenderItems(segments);
    expect(items.length).toBe(2);
    expect(items[0]?.type === "tool" ? items[0].group.toolCallId : "").toBe("call_a");
    expect(items[1]?.type === "tool" ? items[1].group.toolCallId : "").toBe("call_b");
  });
});
