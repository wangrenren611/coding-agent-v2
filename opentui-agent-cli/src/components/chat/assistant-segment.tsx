import type { ReplySegment } from "../../types/chat";
import { opencodeMarkdownSyntax, opencodeSubtleMarkdownSyntax } from "../../ui/opencode-markdown";
import { uiTheme } from "../../ui/theme";

type AssistantSegmentProps = {
  segment: ReplySegment;
};

const ThinkingSegment = ({ content }: { content: string }) => {
  const normalized = content.trim();
  if (!normalized) {
    return null;
  }

  return (
    <box flexDirection="row" marginTop={1}>
      <box width={1} backgroundColor={uiTheme.divider} />
      <box flexGrow={1} paddingLeft={2}>
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={opencodeSubtleMarkdownSyntax}
          content={`_Thinking:_ ${normalized}`}
          conceal={false}
          fg={uiTheme.muted}
        />
      </box>
    </box>
  );
};

const CodeSegment = ({ content }: { content: string }) => {
  return (
    <box backgroundColor={uiTheme.surface} paddingX={2} paddingY={1} marginTop={1}>
      <text fg={uiTheme.text} attributes={uiTheme.typography.code} wrapMode="word">
        {content}
      </text>
    </box>
  );
};

const NoteSegment = ({ content }: { content: string }) => {
  return (
    <box paddingLeft={3} marginTop={1}>
      <text fg={uiTheme.muted} attributes={uiTheme.typography.note} wrapMode="word">
        {content}
      </text>
    </box>
  );
};

const TextSegment = ({ content }: { content: string }) => {
  const normalized = content.trim();
  if (!normalized) {
    return null;
  }

  return (
    <box paddingLeft={3} marginTop={1}>
      <code
        filetype="markdown"
        drawUnstyledText={false}
        streaming={true}
        syntaxStyle={opencodeMarkdownSyntax}
        content={normalized}
        conceal={false}
        fg={uiTheme.text}
      />
    </box>
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
