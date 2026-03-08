import { TextAttributes } from "@opentui/core";

import type { ReplySegment } from "../../types/chat";
import { uiTheme } from "../../ui/theme";

type AssistantSegmentProps = {
  segment: ReplySegment;
};

const ThinkingSegment = ({ content }: { content: string }) => {
  return (
    <box flexDirection="row" gap={1}>
      <box width={1} backgroundColor={uiTheme.divider} />
      <box flexGrow={1}>
        <text wrapMode="word">
          <i fg={uiTheme.thinking}>Thinking:</i>
          <span fg={uiTheme.subtle}> {content}</span>
        </text>
      </box>
    </box>
  );
};

const CodeSegment = ({ content }: { content: string }) => {
  return (
    <box backgroundColor={uiTheme.surface} paddingX={2} paddingY={1}>
      <text fg={uiTheme.text} wrapMode="word">
        {content}
      </text>
    </box>
  );
};

const NoteSegment = ({ content }: { content: string }) => {
  return (
    <text fg={uiTheme.muted} attributes={TextAttributes.DIM} wrapMode="word">
      {content}
    </text>
  );
};

const TextSegment = ({ content }: { content: string }) => {
  return (
    <text fg={uiTheme.text} attributes={TextAttributes.BOLD} wrapMode="word">
      {content}
    </text>
  );
};

export const AssistantSegment = ({ segment }: AssistantSegmentProps) => {
  if (segment.type === "thinking") {
    return <ThinkingSegment content={segment.content} />;
  }

  if (segment.type === "code") {
    return <CodeSegment content={segment.content} />;
  }

  if (segment.type === "note") {
    return <NoteSegment content={segment.content} />;
  }

  return <TextSegment content={segment.content} />;
};

