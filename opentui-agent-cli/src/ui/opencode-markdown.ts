import { RGBA, SyntaxStyle } from '@opentui/core';
import type { UiThemeMode } from './theme';

type OpenCodeTheme = {
  primary: RGBA;
  secondary: RGBA;
  accent: RGBA;
  error: RGBA;
  warning: RGBA;
  success: RGBA;
  info: RGBA;
  text: RGBA;
  textMuted: RGBA;
  background: RGBA;
  backgroundPanel: RGBA;
  backgroundElement: RGBA;
  border: RGBA;
  borderActive: RGBA;
  borderSubtle: RGBA;
  diffAdded: RGBA;
  diffRemoved: RGBA;
  diffContext: RGBA;
  diffHunkHeader: RGBA;
  diffHighlightAdded: RGBA;
  diffHighlightRemoved: RGBA;
  diffAddedBg: RGBA;
  diffRemovedBg: RGBA;
  diffContextBg: RGBA;
  diffLineNumber: RGBA;
  diffAddedLineNumberBg: RGBA;
  diffRemovedLineNumberBg: RGBA;
  markdownText: RGBA;
  markdownHeading: RGBA;
  markdownLink: RGBA;
  markdownLinkText: RGBA;
  markdownCode: RGBA;
  markdownBlockQuote: RGBA;
  markdownEmph: RGBA;
  markdownStrong: RGBA;
  markdownHorizontalRule: RGBA;
  markdownListItem: RGBA;
  markdownListEnumeration: RGBA;
  markdownImage: RGBA;
  markdownImageText: RGBA;
  markdownCodeBlock: RGBA;
  syntaxComment: RGBA;
  syntaxKeyword: RGBA;
  syntaxFunction: RGBA;
  syntaxVariable: RGBA;
  syntaxString: RGBA;
  syntaxNumber: RGBA;
  syntaxType: RGBA;
  syntaxOperator: RGBA;
  syntaxPunctuation: RGBA;
  thinkingOpacity: number;
};

const color = (hex: string) => RGBA.fromHex(hex);

const opencodeDarkTheme: OpenCodeTheme = {
  primary: color('#fab283'),
  secondary: color('#5c9cf5'),
  accent: color('#9d7cd8'),
  error: color('#e06c75'),
  warning: color('#f5a742'),
  success: color('#7fd88f'),
  info: color('#56b6c2'),
  text: color('#eeeeee'),
  textMuted: color('#808080'),
  background: color('#0a0a0a'),
  backgroundPanel: color('#141414'),
  backgroundElement: color('#1e1e1e'),
  border: color('#484848'),
  borderActive: color('#606060'),
  borderSubtle: color('#3c3c3c'),
  diffAdded: color('#4fd6be'),
  diffRemoved: color('#c53b53'),
  diffContext: color('#828bb8'),
  diffHunkHeader: color('#828bb8'),
  diffHighlightAdded: color('#b8db87'),
  diffHighlightRemoved: color('#e26a75'),
  diffAddedBg: color('#20303b'),
  diffRemovedBg: color('#37222c'),
  diffContextBg: color('#141414'),
  diffLineNumber: color('#1e1e1e'),
  diffAddedLineNumberBg: color('#1b2b34'),
  diffRemovedLineNumberBg: color('#2d1f26'),
  markdownText: color('#eeeeee'),
  markdownHeading: color('#9d7cd8'),
  markdownLink: color('#fab283'),
  markdownLinkText: color('#56b6c2'),
  markdownCode: color('#7fd88f'),
  markdownBlockQuote: color('#e5c07b'),
  markdownEmph: color('#e5c07b'),
  markdownStrong: color('#f5a742'),
  markdownHorizontalRule: color('#808080'),
  markdownListItem: color('#fab283'),
  markdownListEnumeration: color('#56b6c2'),
  markdownImage: color('#fab283'),
  markdownImageText: color('#56b6c2'),
  markdownCodeBlock: color('#eeeeee'),
  syntaxComment: color('#808080'),
  syntaxKeyword: color('#9d7cd8'),
  syntaxFunction: color('#fab283'),
  syntaxVariable: color('#e06c75'),
  syntaxString: color('#7fd88f'),
  syntaxNumber: color('#f5a742'),
  syntaxType: color('#e5c07b'),
  syntaxOperator: color('#56b6c2'),
  syntaxPunctuation: color('#eeeeee'),
  thinkingOpacity: 0.6,
};

const opencodeLightTheme: OpenCodeTheme = {
  primary: color('#0b67d7'),
  secondary: color('#2563eb'),
  accent: color('#0b67d7'),
  error: color('#c2410c'),
  warning: color('#b45309'),
  success: color('#15803d'),
  info: color('#0f766e'),
  text: color('#1f2530'),
  textMuted: color('#596273'),
  background: color('#eceff3'),
  backgroundPanel: color('#ffffff'),
  backgroundElement: color('#dde3ea'),
  border: color('#cfd5de'),
  borderActive: color('#aeb7c4'),
  borderSubtle: color('#d7dde5'),
  diffAdded: color('#15803d'),
  diffRemoved: color('#b91c1c'),
  diffContext: color('#475569'),
  diffHunkHeader: color('#334155'),
  diffHighlightAdded: color('#166534'),
  diffHighlightRemoved: color('#991b1b'),
  diffAddedBg: color('#dcfce7'),
  diffRemovedBg: color('#fee2e2'),
  diffContextBg: color('#e2e8f0'),
  diffLineNumber: color('#64748b'),
  diffAddedLineNumberBg: color('#bbf7d0'),
  diffRemovedLineNumberBg: color('#fecaca'),
  markdownText: color('#1f2530'),
  markdownHeading: color('#0b67d7'),
  markdownLink: color('#0b67d7'),
  markdownLinkText: color('#0f766e'),
  markdownCode: color('#166534'),
  markdownBlockQuote: color('#7c3aed'),
  markdownEmph: color('#8b5e00'),
  markdownStrong: color('#b45309'),
  markdownHorizontalRule: color('#738094'),
  markdownListItem: color('#0b67d7'),
  markdownListEnumeration: color('#0f766e'),
  markdownImage: color('#b45309'),
  markdownImageText: color('#0f766e'),
  markdownCodeBlock: color('#1f2530'),
  syntaxComment: color('#596273'),
  syntaxKeyword: color('#7c3aed'),
  syntaxFunction: color('#b45309'),
  syntaxVariable: color('#be123c'),
  syntaxString: color('#15803d'),
  syntaxNumber: color('#c2410c'),
  syntaxType: color('#0f766e'),
  syntaxOperator: color('#0b67d7'),
  syntaxPunctuation: color('#1f2530'),
  thinkingOpacity: 0.92,
};

type SyntaxRule = {
  scope: string[];
  style: {
    foreground?: RGBA;
    background?: RGBA;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  };
};

const getSyntaxRules = (theme: OpenCodeTheme): SyntaxRule[] => {
  return [
    { scope: ['default'], style: { foreground: theme.text } },
    { scope: ['prompt'], style: { foreground: theme.accent } },
    { scope: ['extmark.file'], style: { foreground: theme.warning, bold: true } },
    { scope: ['extmark.agent'], style: { foreground: theme.secondary, bold: true } },
    {
      scope: ['extmark.paste'],
      style: { foreground: theme.background, background: theme.warning, bold: true },
    },
    { scope: ['comment'], style: { foreground: theme.syntaxComment, italic: true } },
    { scope: ['comment.documentation'], style: { foreground: theme.syntaxComment, italic: true } },
    { scope: ['string', 'symbol'], style: { foreground: theme.syntaxString } },
    { scope: ['number', 'boolean'], style: { foreground: theme.syntaxNumber } },
    { scope: ['character.special'], style: { foreground: theme.syntaxString } },
    {
      scope: ['keyword.return', 'keyword.conditional', 'keyword.repeat', 'keyword.coroutine'],
      style: { foreground: theme.syntaxKeyword, italic: true },
    },
    { scope: ['keyword.type'], style: { foreground: theme.syntaxType, bold: true, italic: true } },
    { scope: ['keyword.function', 'function.method'], style: { foreground: theme.syntaxFunction } },
    { scope: ['keyword'], style: { foreground: theme.syntaxKeyword, italic: true } },
    { scope: ['keyword.import'], style: { foreground: theme.syntaxKeyword } },
    {
      scope: ['operator', 'keyword.operator', 'punctuation.delimiter'],
      style: { foreground: theme.syntaxOperator },
    },
    { scope: ['keyword.conditional.ternary'], style: { foreground: theme.syntaxOperator } },
    {
      scope: ['variable', 'variable.parameter', 'function.method.call', 'function.call'],
      style: { foreground: theme.syntaxVariable },
    },
    {
      scope: ['variable.member', 'function', 'constructor'],
      style: { foreground: theme.syntaxFunction },
    },
    { scope: ['type', 'module'], style: { foreground: theme.syntaxType } },
    { scope: ['constant'], style: { foreground: theme.syntaxNumber } },
    { scope: ['property'], style: { foreground: theme.syntaxVariable } },
    { scope: ['class'], style: { foreground: theme.syntaxType } },
    { scope: ['parameter'], style: { foreground: theme.syntaxVariable } },
    {
      scope: ['punctuation', 'punctuation.bracket'],
      style: { foreground: theme.syntaxPunctuation },
    },
    {
      scope: [
        'variable.builtin',
        'type.builtin',
        'function.builtin',
        'module.builtin',
        'constant.builtin',
      ],
      style: { foreground: theme.error },
    },
    { scope: ['variable.super'], style: { foreground: theme.error } },
    { scope: ['string.escape', 'string.regexp'], style: { foreground: theme.syntaxKeyword } },
    { scope: ['keyword.directive'], style: { foreground: theme.syntaxKeyword, italic: true } },
    { scope: ['punctuation.special'], style: { foreground: theme.syntaxOperator } },
    { scope: ['keyword.modifier'], style: { foreground: theme.syntaxKeyword, italic: true } },
    { scope: ['keyword.exception'], style: { foreground: theme.syntaxKeyword, italic: true } },
    { scope: ['markup.heading'], style: { foreground: theme.markdownHeading, bold: true } },
    { scope: ['markup.heading.1'], style: { foreground: theme.markdownHeading, bold: true } },
    { scope: ['markup.heading.2'], style: { foreground: theme.markdownHeading, bold: true } },
    { scope: ['markup.heading.3'], style: { foreground: theme.markdownHeading, bold: true } },
    { scope: ['markup.heading.4'], style: { foreground: theme.markdownHeading, bold: true } },
    { scope: ['markup.heading.5'], style: { foreground: theme.markdownHeading, bold: true } },
    { scope: ['markup.heading.6'], style: { foreground: theme.markdownHeading, bold: true } },
    {
      scope: ['markup.bold', 'markup.strong'],
      style: { foreground: theme.markdownStrong, bold: true },
    },
    { scope: ['markup.italic'], style: { foreground: theme.markdownEmph, italic: true } },
    { scope: ['markup.list'], style: { foreground: theme.markdownListItem } },
    { scope: ['markup.quote'], style: { foreground: theme.markdownBlockQuote, italic: true } },
    { scope: ['markup.raw', 'markup.raw.block'], style: { foreground: theme.markdownCode } },
    {
      scope: ['markup.raw.inline'],
      style: { foreground: theme.markdownCode, background: theme.background },
    },
    { scope: ['markup.link'], style: { foreground: theme.markdownLink, underline: true } },
    {
      scope: ['markup.link.label'],
      style: { foreground: theme.markdownLinkText, underline: true },
    },
    { scope: ['markup.link.url'], style: { foreground: theme.markdownLink, underline: true } },
    { scope: ['label'], style: { foreground: theme.markdownLinkText } },
    { scope: ['spell', 'nospell'], style: { foreground: theme.text } },
    { scope: ['conceal'], style: { foreground: theme.textMuted } },
    {
      scope: ['string.special', 'string.special.url'],
      style: { foreground: theme.markdownLink, underline: true },
    },
    { scope: ['character'], style: { foreground: theme.syntaxString } },
    { scope: ['float'], style: { foreground: theme.syntaxNumber } },
    { scope: ['comment.error'], style: { foreground: theme.error, italic: true, bold: true } },
    { scope: ['comment.warning'], style: { foreground: theme.warning, italic: true, bold: true } },
    {
      scope: ['comment.todo', 'comment.note'],
      style: { foreground: theme.info, italic: true, bold: true },
    },
    { scope: ['namespace'], style: { foreground: theme.syntaxType } },
    { scope: ['field'], style: { foreground: theme.syntaxVariable } },
    { scope: ['type.definition'], style: { foreground: theme.syntaxType, bold: true } },
    { scope: ['keyword.export'], style: { foreground: theme.syntaxKeyword } },
    { scope: ['attribute', 'annotation'], style: { foreground: theme.warning } },
    { scope: ['tag'], style: { foreground: theme.error } },
    { scope: ['tag.attribute'], style: { foreground: theme.syntaxKeyword } },
    { scope: ['tag.delimiter'], style: { foreground: theme.syntaxOperator } },
    { scope: ['markup.strikethrough'], style: { foreground: theme.textMuted } },
    { scope: ['markup.underline'], style: { foreground: theme.text, underline: true } },
    { scope: ['markup.list.checked'], style: { foreground: theme.success } },
    { scope: ['markup.list.unchecked'], style: { foreground: theme.textMuted } },
    { scope: ['diff.plus'], style: { foreground: theme.diffAdded, background: theme.diffAddedBg } },
    {
      scope: ['diff.minus'],
      style: { foreground: theme.diffRemoved, background: theme.diffRemovedBg },
    },
    {
      scope: ['diff.delta'],
      style: { foreground: theme.diffContext, background: theme.diffContextBg },
    },
    { scope: ['error'], style: { foreground: theme.error, bold: true } },
    { scope: ['warning'], style: { foreground: theme.warning, bold: true } },
    { scope: ['info'], style: { foreground: theme.info } },
    { scope: ['debug'], style: { foreground: theme.textMuted } },
  ];
};

const applyAlpha = (fg: RGBA, alpha: number) => {
  return RGBA.fromInts(
    Math.round(fg.r * 255),
    Math.round(fg.g * 255),
    Math.round(fg.b * 255),
    Math.round(alpha * 255)
  );
};

const createMarkdownSyntax = (theme: OpenCodeTheme) => SyntaxStyle.fromTheme(getSyntaxRules(theme));

const createSubtleMarkdownSyntax = (theme: OpenCodeTheme) =>
  SyntaxStyle.fromTheme(
    getSyntaxRules(theme).map(rule => {
      if (!rule.style.foreground) {
        return rule;
      }
      return {
        ...rule,
        style: {
          ...rule.style,
          foreground: applyAlpha(rule.style.foreground, theme.thinkingOpacity),
        },
      };
    })
  );

const themeForMode = (mode: UiThemeMode): OpenCodeTheme => {
  return mode === 'light' ? opencodeLightTheme : opencodeDarkTheme;
};

export let opencodeMarkdownSyntax = createMarkdownSyntax(opencodeDarkTheme);
export let opencodeSubtleMarkdownSyntax = createSubtleMarkdownSyntax(opencodeDarkTheme);

export const applyMarkdownThemeMode = (mode: UiThemeMode) => {
  const theme = themeForMode(mode);
  opencodeMarkdownSyntax = createMarkdownSyntax(theme);
  opencodeSubtleMarkdownSyntax = createSubtleMarkdownSyntax(theme);
};
