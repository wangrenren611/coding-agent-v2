import { TextAttributes, rgbToHex } from '@opentui/core';

import { resolveOpenCodeTheme, type OpenCodeThemeMode } from './open-code-theme';

export type UiThemeMode = OpenCodeThemeMode;
type TextAttributeValue = (typeof TextAttributes)[keyof typeof TextAttributes];

export type UiTheme = {
  bg: string;
  surface: string;
  panel: string;
  text: string;
  muted: string;
  subtle: string;
  accent: string;
  thinking: string;
  divider: string;
  userPromptBg: string;
  userPromptText: string;
  inputBg: string;
  inputCursor: string;
  inputSelectionBg: string;
  inputSelectionText: string;
  codeBlock: {
    bg: string;
    border: string;
    header: string;
    language: string;
    text: string;
    selectionBg: string;
    selectionText: string;
  };
  diff: {
    lineNumberFg: string;
    lineNumberBg: string;
    addedBg: string;
    removedBg: string;
    contextBg: string;
    addedContentBg: string;
    removedContentBg: string;
    contextContentBg: string;
    addedSign: string;
    removedSign: string;
    addedLineNumberBg: string;
    removedLineNumberBg: string;
  };
  layout: {
    appPaddingTop: number;
    appPaddingBottom: number;
    appPaddingX: number;
    conversationPaddingX: number;
    conversationPaddingY: number;
    conversationContentPaddingX: number;
    conversationContentPaddingY: number;
    promptPaddingX: number;
    promptPaddingBottom: number;
    footerMarginTop: number;
    footerPaddingRight: number;
  };
  typography: {
    body: TextAttributeValue;
    code: TextAttributeValue;
    muted: TextAttributeValue;
    note: TextAttributeValue;
    heading: TextAttributeValue;
  };
};

const baseLayout: UiTheme['layout'] = {
  appPaddingTop: 0,
  appPaddingBottom: 1,
  appPaddingX: 0,
  conversationPaddingX: 0,
  conversationPaddingY: 0,
  conversationContentPaddingX: 2,
  conversationContentPaddingY: 1,
  promptPaddingX: 0,
  promptPaddingBottom: 1,
  footerMarginTop: 1,
  footerPaddingRight: 0,
};

const baseTypography: UiTheme['typography'] = {
  body: TextAttributes.BOLD,
  code: TextAttributes.BOLD,
  muted: TextAttributes.BOLD,
  note: TextAttributes.NONE,
  heading: TextAttributes.BOLD,
};

const toHex = (value: Parameters<typeof rgbToHex>[0]) => rgbToHex(value).toLowerCase();

const createTheme = (mode: UiThemeMode, platform: NodeJS.Platform): UiTheme => {
  const theme = resolveOpenCodeTheme(mode, platform);

  return {
    bg: toHex(theme.background),
    surface: toHex(theme.backgroundPanel),
    panel: toHex(theme.backgroundPanel),
    text: toHex(theme.text),
    muted: toHex(theme.textMuted),
    subtle: toHex(theme.textMuted),
    accent: toHex(theme.primary),
    thinking: toHex(theme.textMuted),
    divider: toHex(theme.borderSubtle),
    userPromptBg: toHex(theme.backgroundElement),
    userPromptText: toHex(theme.text),
    inputBg: mode === 'light' ? '#e4e4e7' : '#27272a',
    inputCursor: toHex(theme.primary),
    inputSelectionBg: toHex(theme.borderActive),
    inputSelectionText: toHex(theme.text),
    codeBlock: {
      bg: toHex(theme.backgroundElement),
      border: toHex(theme.border),
      header: toHex(theme.textMuted),
      language: toHex(theme.accent),
      text: toHex(theme.text),
      selectionBg: toHex(theme.borderActive),
      selectionText: toHex(theme.text),
    },
    diff: {
      lineNumberFg: toHex(theme.diffLineNumber),
      lineNumberBg: toHex(theme.backgroundElement),
      addedBg: toHex(theme.diffAddedBg),
      removedBg: toHex(theme.diffRemovedBg),
      contextBg: toHex(theme.diffContextBg),
      addedContentBg: toHex(theme.diffAddedBg),
      removedContentBg: toHex(theme.diffRemovedBg),
      contextContentBg: toHex(theme.diffContextBg),
      addedSign: toHex(theme.diffAdded),
      removedSign: toHex(theme.diffRemoved),
      addedLineNumberBg: toHex(theme.diffAddedLineNumberBg),
      removedLineNumberBg: toHex(theme.diffRemovedLineNumberBg),
    },
    layout: baseLayout,
    typography: baseTypography,
  };
};

const cloneTheme = (theme: UiTheme): UiTheme => ({
  ...theme,
  codeBlock: { ...theme.codeBlock },
  diff: { ...theme.diff },
  layout: { ...theme.layout },
  typography: { ...theme.typography },
});

export let uiTheme: UiTheme = cloneTheme(createTheme('dark', process.platform));

export const applyUiThemeMode = (mode: UiThemeMode) => {
  uiTheme = cloneTheme(createTheme(mode, process.platform));
};
