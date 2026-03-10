import { describe, expect, it } from "vitest";

import type { AgentToolUseEvent } from "./types";
import { ToolCallBuffer } from "./tool-call-buffer";

const createFileReadToolUseEvent = (callId: string, path: string): AgentToolUseEvent => ({
  id: callId,
  function: {
    name: "file_read",
    arguments: JSON.stringify({ path }),
  },
});

describe("ToolCallBuffer", () => {
  it("keeps llm-planned tool calls hidden until tool execution starts", () => {
    const buffer = new ToolCallBuffer();
    const emitted: AgentToolUseEvent[] = [];

    buffer.register(
      createFileReadToolUseEvent("call_1", "/tmp/a.ts"),
      (event) => emitted.push(event),
    );
    buffer.register(
      createFileReadToolUseEvent("call_1", "/tmp/a.ts"),
      (event) => emitted.push(event),
    );
    buffer.register(
      createFileReadToolUseEvent("call_2", "/tmp/b.ts"),
      (event) => emitted.push(event),
    );
    buffer.register(
      createFileReadToolUseEvent("call_3", "/tmp/c.ts"),
      (event) => emitted.push(event),
    );

    expect(emitted).toEqual([]);

    buffer.flush((event) => emitted.push(event));

    expect(emitted).toEqual([
      createFileReadToolUseEvent("call_1", "/tmp/a.ts"),
      createFileReadToolUseEvent("call_2", "/tmp/b.ts"),
      createFileReadToolUseEvent("call_3", "/tmp/c.ts"),
    ]);
  });

  it("emits a planned tool call as soon as its stream starts", () => {
    const buffer = new ToolCallBuffer();
    const emitted: AgentToolUseEvent[] = [];

    buffer.register(
      createFileReadToolUseEvent("call_1", "/tmp/a.ts"),
      (event) => emitted.push(event),
    );
    buffer.register(
      createFileReadToolUseEvent("call_2", "/tmp/b.ts"),
      (event) => emitted.push(event),
    );

    buffer.ensureEmitted("call_2", (event) => emitted.push(event));

    expect(emitted).toEqual([createFileReadToolUseEvent("call_2", "/tmp/b.ts")]);

    buffer.flush((event) => emitted.push(event));

    expect(emitted).toEqual([
      createFileReadToolUseEvent("call_2", "/tmp/b.ts"),
      createFileReadToolUseEvent("call_1", "/tmp/a.ts"),
    ]);
  });
});
