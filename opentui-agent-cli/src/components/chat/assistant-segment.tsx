import type { ReplySegment } from '../../types/chat';
import { opencodeMarkdownSyntax, opencodeSubtleMarkdownSyntax } from '../../ui/opencode-markdown';
import { uiTheme } from '../../ui/theme';
import { CodeBlock } from './code-block';

type AssistantSegmentProps = {
  segment: ReplySegment;
  streaming: boolean;
};

const markdownTableOptions = {
  widthMode: 'full' as const,
  wrapMode: 'word' as const,
  selectable: true,
};

type MarkdownTokenLike = {
  type?: string;
};

type MarkdownRenderContextLike = {
  defaultRender: () => unknown;
};

type TextBufferRenderableLike = {
  fg?: string;
  bg?: string;
  selectionBg?: string;
  selectionFg?: string;
};

const patchMarkdownCodeBlockRenderable = (
  token: MarkdownTokenLike,
  context: MarkdownRenderContextLike
) => {
  const renderable = context.defaultRender();
  if (!renderable || token.type !== 'code') {
    return renderable;
  }

  const textBufferRenderable = renderable as TextBufferRenderableLike;
  textBufferRenderable.fg = uiTheme.text;
  textBufferRenderable.bg = uiTheme.codeBlock.bg;
  textBufferRenderable.selectionBg = uiTheme.codeBlock.selectionBg;
  textBufferRenderable.selectionFg = uiTheme.codeBlock.selectionText;

  return renderable;
};

const ThinkingSegment = ({ content, streaming }: { content: string; streaming: boolean }) => {
  const normalized = content.trim();
  if (!normalized) {
    return null;
  }

  return (
    <box flexDirection="row">
      <box width={1} backgroundColor={uiTheme.divider} />
      <box flexGrow={1} paddingLeft={2}>
        <markdown
          streaming={streaming}
          syntaxStyle={opencodeSubtleMarkdownSyntax}
          content={`_Thinking:_ ${normalized}`}
          conceal={true}
          concealCode={false}
          renderNode={patchMarkdownCodeBlockRenderable}
          tableOptions={markdownTableOptions}
        />
      </box>
    </box>
  );
};

const CodeSegment = ({ content }: { content: string }) => {
  return (
    <box>
      <CodeBlock content={content} />
    </box>
  );
};

const NoteSegment = ({ content }: { content: string }) => {
  return (
    <box paddingLeft={3}>
      <text
        fg={uiTheme.muted}
        attributes={uiTheme.typography.note}
        wrapMode="word"
        selectable={true}
      >
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
    <box paddingLeft={3}>
      <markdown
        streaming={streaming}
        syntaxStyle={opencodeMarkdownSyntax}
        content={normalized}
        conceal={true}
        concealCode={false}
        renderNode={patchMarkdownCodeBlockRenderable}
        tableOptions={markdownTableOptions}
      />
    </box>
  );
};

export const AssistantSegment = ({ segment, streaming }: AssistantSegmentProps) => {
  if (segment.type === 'thinking') {
    return <ThinkingSegment content={segment.content} streaming={streaming} />;
  }

  if (segment.type === 'code') {
    return <CodeSegment content={segment.content} />;
  }

  if (segment.type === 'note') {
    return <NoteSegment content={segment.content} />;
  }

  return <TextSegment content={segment.content} streaming={streaming} />;
};
