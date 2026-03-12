import { opencodeMarkdownSyntax } from '../../ui/opencode-markdown';
import { uiTheme } from '../../ui/theme';

type CodeBlockProps = {
  content: string;
  label?: string;
  languageHint?: string;
};

const FILETYPE_BY_EXTENSION: Record<string, string> = {
  bash: 'bash',
  cjs: 'javascript',
  css: 'css',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'tsx',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  sh: 'bash',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'text',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

const DIFF_HEADER_PATTERNS = [/^diff --git /m, /^Index:\s+/m, /^@@ /m];

const normalizeHint = (value?: string): string | undefined => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'auto') {
    return undefined;
  }
  if (normalized === 'sh' || normalized === 'shell' || normalized === 'zsh') {
    return 'bash';
  }
  if (normalized === 'js') {
    return 'javascript';
  }
  if (normalized === 'ts') {
    return 'typescript';
  }
  return normalized;
};

export const looksLikeDiff = (value: string): boolean => {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  const firstLine = normalized.split('\n', 1)[0]?.trim();
  if (
    !firstLine ||
    !(
      firstLine.startsWith('diff --git ') ||
      firstLine.startsWith('Index: ') ||
      firstLine.startsWith('--- ') ||
      firstLine.startsWith('@@ ')
    )
  ) {
    return false;
  }

  if (DIFF_HEADER_PATTERNS.some(pattern => pattern.test(normalized))) {
    return (
      /^@@ /m.test(normalized) ||
      (/^--- /m.test(normalized) && /^\+\+\+ /m.test(normalized)) ||
      /^diff --git /m.test(normalized)
    );
  }

  return false;
};

export const inferFiletypeFromPath = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  const fileName = value.split('/').pop();
  if (!fileName || !fileName.includes('.')) {
    return undefined;
  }

  const extension = fileName.split('.').pop()?.toLowerCase();
  if (!extension) {
    return undefined;
  }

  return FILETYPE_BY_EXTENSION[extension];
};

export const extractDiffPath = (value: string): string | undefined => {
  const lines = value.split('\n');
  for (const line of lines) {
    if (line.startsWith('Index: ')) {
      return line.slice('Index: '.length).trim();
    }
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match?.[2]) {
        return match[2];
      }
    }
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim();
      if (path && path !== '/dev/null') {
        return path.replace(/^b\//, '');
      }
    }
  }

  return undefined;
};

const looksLikeJson = (value: string): boolean => {
  const normalized = value.trim();
  if (!normalized || !['{', '['].includes(normalized[0] ?? '')) {
    return false;
  }

  try {
    JSON.parse(normalized);
    return true;
  } catch {
    return false;
  }
};

export const inferCodeFiletype = (value: string, languageHint?: string): string | undefined => {
  const hint = normalizeHint(languageHint);
  if (hint) {
    return hint;
  }

  if (looksLikeDiff(value)) {
    return 'diff';
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (looksLikeJson(normalized)) {
    return 'json';
  }

  if (
    normalized.startsWith('#!/bin/bash') ||
    normalized.startsWith('#!/usr/bin/env bash') ||
    normalized.startsWith('#!/bin/sh') ||
    normalized.startsWith('#!/usr/bin/env zsh')
  ) {
    return 'bash';
  }

  const meaningfulLines = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (meaningfulLines.length > 0 && meaningfulLines.every(line => line.startsWith('$ '))) {
    return 'bash';
  }

  return undefined;
};

const buildHeaderMeta = (content: string, filetype?: string): string | undefined => {
  if (filetype === 'diff') {
    return extractDiffPath(content) ?? 'unified';
  }

  if (!filetype || filetype === 'text') {
    return undefined;
  }

  return filetype;
};

export const CodeBlock = ({ content, label, languageHint }: CodeBlockProps) => {
  const normalized = content.replace(/\n+$/, '\n');
  const filetype = inferCodeFiletype(normalized, languageHint);
  const diffFiletype =
    filetype === 'diff' ? inferFiletypeFromPath(extractDiffPath(normalized)) : undefined;
  const headerLabel = label ?? 'code';
  const headerMeta = buildHeaderMeta(normalized, filetype);

  return (
    <box
      flexDirection="column"
      // backgroundColor={uiTheme.codeBlock.bg}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <text fg={uiTheme.codeBlock.header} attributes={uiTheme.typography.note}>
        {headerLabel}
        {headerMeta ? <span fg={uiTheme.codeBlock.language}> · {headerMeta}</span> : null}
      </text>
      <box marginTop={1}>
        {filetype === 'diff' ? (
          <diff
            diff={normalized}
            view="unified"
            filetype={diffFiletype}
            fg={uiTheme.codeBlock.text}
            syntaxStyle={opencodeMarkdownSyntax}
            wrapMode="char"
            conceal={true}
            showLineNumbers={true}
            selectionBg={uiTheme.codeBlock.selectionBg}
            selectionFg={uiTheme.codeBlock.selectionText}
            lineNumberFg={uiTheme.diff.lineNumberFg}
            lineNumberBg={uiTheme.diff.lineNumberBg}
            addedBg={uiTheme.diff.addedBg}
            removedBg={uiTheme.diff.removedBg}
            contextBg={uiTheme.diff.contextBg}
            addedContentBg={uiTheme.diff.addedContentBg}
            removedContentBg={uiTheme.diff.removedContentBg}
            contextContentBg={uiTheme.diff.contextContentBg}
            addedSignColor={uiTheme.diff.addedSign}
            removedSignColor={uiTheme.diff.removedSign}
            addedLineNumberBg={uiTheme.diff.addedLineNumberBg}
            removedLineNumberBg={uiTheme.diff.removedLineNumberBg}
          />
        ) : (
          <code
            content={normalized}
            filetype={filetype}
            fg={uiTheme.codeBlock.text}
            syntaxStyle={opencodeMarkdownSyntax}
            wrapMode="char"
            conceal={true}
            drawUnstyledText={true}
            selectable={true}
            selectionBg={uiTheme.codeBlock.selectionBg}
            selectionFg={uiTheme.codeBlock.selectionText}
          />
        )}
      </box>
    </box>
  );
};
