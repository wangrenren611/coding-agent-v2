import { uiTheme } from "../../ui/theme";
import type { ToolSegmentGroup } from "./segment-groups";

type AssistantToolGroupProps = {
  group: ToolSegmentGroup;
};

type ParsedToolUse = {
  name: string;
  callId: string;
  command?: string;
  details?: string;
};

type ParsedToolResult = {
  name: string;
  callId: string;
  status: "success" | "error" | "unknown";
  details?: string;
};

const parseToolUse = (content?: string): ParsedToolUse | null => {
  if (!content) {
    return null;
  }
  const lines = content.split("\n");
  const header = lines[0]?.trim();
  if (!header) {
    return null;
  }
  const match = header.match(/^# Tool:\s+(.+?)\s+\(([^)]+)\)$/);
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  const [_, name, callId] = match;
  const bodyLines = lines.slice(1);
  const commandLine = bodyLines.find((line) => line.trim().startsWith("$ "));
  const command = commandLine ? commandLine.trim().slice(2).trim() : undefined;
  const details = bodyLines
    .filter((line) => !line.trim().startsWith("$ "))
    .join("\n")
    .trim();

  return {
    name,
    callId,
    command: command || undefined,
    details: details || undefined,
  };
};

const parseToolResult = (content?: string): ParsedToolResult | null => {
  if (!content) {
    return null;
  }
  const lines = content.split("\n");
  const header = lines[0]?.trim();
  if (!header) {
    return null;
  }
  const match = header.match(/^# Result:\s+(.+?)\s+\(([^)]+)\)\s+(success|error)$/);
  if (!match || !match[1] || !match[2] || !match[3]) {
    return null;
  }

  const [_, name, callId, status] = match;
  const details = lines.slice(1).join("\n").trim();

  return {
    name,
    callId,
    status: status === "success" || status === "error" ? status : "unknown",
    details: details || undefined,
  };
};

const resolveToolIcon = (toolName: string): string => {
  if (toolName === "bash") {
    return "$";
  }
  if (toolName === "write" || toolName === "edit") {
    return "←";
  }
  if (toolName === "read" || toolName === "list") {
    return "→";
  }
  if (toolName === "grep" || toolName === "glob") {
    return "✱";
  }
  if (toolName === "webfetch") {
    return "%";
  }
  if (toolName === "task") {
    return "◉";
  }
  return "⚙";
};

const mergeOutputLines = (group: ToolSegmentGroup, parsedResult: ParsedToolResult | null): string => {
  const streamText = group.streams
    .map((segment) => segment.content)
    .join("")
    .trim();
  const resultText = parsedResult?.details?.trim();
  if (streamText && resultText && streamText === resultText) {
    return streamText;
  }
  if (streamText && resultText) {
    return `${streamText}\n${resultText}`;
  }
  return streamText || resultText || "";
};

export const AssistantToolGroup = ({ group }: AssistantToolGroupProps) => {
  const parsedUse = parseToolUse(group.use?.content);
  const parsedResult = parseToolResult(group.result?.content);
  const toolName = parsedUse?.name ?? parsedResult?.name ?? "tool";
  const commandText = parsedUse?.command ?? parsedUse?.details;
  const icon = resolveToolIcon(toolName);
  const outputText = mergeOutputLines(group, parsedResult);
  const hasOutput = outputText.length > 0;
  const statusText =
    parsedResult?.status === "success"
      ? "completed"
      : parsedResult?.status === "error"
        ? "error"
        : group.result
          ? "finished"
          : "running";

  return (
    <box flexDirection="column" marginTop={1}>
      <box paddingLeft={3}>
        <text fg={uiTheme.muted} attributes={uiTheme.typography.note} wrapMode="word">
          <span fg={uiTheme.text}>{icon}</span> {toolName}
          {commandText ? ` ${commandText}` : ""}
          <span fg={uiTheme.subtle}> ({statusText})</span>
        </text>
      </box>
      {hasOutput ? (
        <box flexDirection="row" marginTop={1}>
          <box width={1} backgroundColor={uiTheme.divider} />
          <box flexGrow={1} backgroundColor={uiTheme.panel} paddingLeft={2} paddingRight={1} paddingTop={1} paddingBottom={1}>
            {commandText ? (
              <box paddingBottom={1}>
                <text fg={uiTheme.muted} attributes={uiTheme.typography.note} wrapMode="word">
                  $ {commandText}
                </text>
              </box>
            ) : null}
            <text fg={uiTheme.text} attributes={uiTheme.typography.code} wrapMode="word">
              {outputText}
            </text>
          </box>
        </box>
      ) : null}
    </box>
  );
};
