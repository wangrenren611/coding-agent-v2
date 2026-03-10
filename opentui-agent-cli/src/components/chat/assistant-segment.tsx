import type { ReplySegment } from "../../types/chat";
import { opencodeMarkdownSyntax, opencodeSubtleMarkdownSyntax } from "../../ui/opencode-markdown";
import { uiTheme } from "../../ui/theme";

type AssistantSegmentProps = {
  segment: ReplySegment;
  streaming: boolean;
};

const markdownTableOptions = {
  widthMode: "full" as const,
  wrapMode: "word" as const,
  selectable: false,
};

const ThinkingSegment = ({ content, streaming }: { content: string; streaming: boolean }) => {
  const normalized = content.trim();
  if (!normalized) {
    return null;
  }

  return (
    <box flexDirection="row" marginTop={1}>
      <box width={1} backgroundColor={uiTheme.divider} />
      <box flexGrow={1} paddingLeft={2}>
        <markdown
          streaming={streaming}
          syntaxStyle={opencodeSubtleMarkdownSyntax}
          content={`_Thinking:_ ${normalized}`}
          conceal={true}
          tableOptions={markdownTableOptions}
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

const TextSegment = ({ content, streaming }: { content: string; streaming: boolean }) => {
  const normalized = content.trim();
  if (!normalized) {
    return null;
  }

  return (
    <box paddingLeft={3} marginTop={1}>
      <markdown
        streaming={streaming}
        syntaxStyle={opencodeMarkdownSyntax}
        content={normalized}
        conceal={true}
        tableOptions={markdownTableOptions}
      />
    </box>
  );
};

export const AssistantSegment = ({ segment, streaming }: AssistantSegmentProps) => {
  if (segment.type === "thinking") {
    return <ThinkingSegment content={segment.content} streaming={streaming} />;
  }

  if (segment.type === "code") {
    return <CodeSegment content={segment.content} />;
  }

  if (segment.type === "note") {
    return <NoteSegment content={segment.content} />;
  }

  return <TextSegment content={segment.content} streaming={streaming} />;
};
