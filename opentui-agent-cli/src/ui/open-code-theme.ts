import { RGBA } from '@opentui/core';

export type OpenCodeThemeMode = 'dark' | 'light';
export type MarkdownThemePlatform = NodeJS.Platform;

export type OpenCodeTheme = {
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

const OPEN_CODE_DARK_THEME: OpenCodeTheme = {
  primary: color('#8e51ff'),
  secondary: color('#27272a'),
  accent: color('#8e51ff'),
  error: color('#ff6467'),
  warning: color('#c4b4ff'),
  success: color('#c4b4ff'),
  info: color('#a684ff'),
  text: color('#fafafa'),
  textMuted: color('#9f9fa9'),
  background: color('#09090b'),
  backgroundPanel: color('#18181b'),
  backgroundElement: color('#27272a'),
  border: color('#ffffff1a'),
  borderActive: color('#4d179a'),
  borderSubtle: color('#ffffff1a'),
  diffAdded: color('#8e51ff'),
  diffRemoved: color('#ff6467'),
  diffContext: color('#9f9fa9'),
  diffHunkHeader: color('#a684ff'),
  diffHighlightAdded: color('#c4b4ff'),
  diffHighlightRemoved: color('#ff8d8f'),
  diffAddedBg: color('#8e51ff1f'),
  diffRemovedBg: color('#ff646724'),
  diffContextBg: color('#27272a'),
  diffLineNumber: color('#9f9fa9'),
  diffAddedLineNumberBg: color('#4d179a66'),
  diffRemovedLineNumberBg: color('#ff646740'),
  markdownText: color('#fafafa'),
  markdownHeading: color('#c4b4ff'),
  markdownLink: color('#8e51ff'),
  markdownLinkText: color('#a684ff'),
  markdownCode: color('#c4b4ff'),
  markdownBlockQuote: color('#a684ff'),
  markdownEmph: color('#c4b4ff'),
  markdownStrong: color('#f5f3ff'),
  markdownHorizontalRule: color('#9f9fa9'),
  markdownListItem: color('#c4b4ff'),
  markdownListEnumeration: color('#a684ff'),
  markdownImage: color('#8e51ff'),
  markdownImageText: color('#a684ff'),
  markdownCodeBlock: color('#fafafa'),
  syntaxComment: color('#9f9fa9'),
  syntaxKeyword: color('#8e51ff'),
  syntaxFunction: color('#c4b4ff'),
  syntaxVariable: color('#f5f3ff'),
  syntaxString: color('#c4b4ff'),
  syntaxNumber: color('#a684ff'),
  syntaxType: color('#8e51ff'),
  syntaxOperator: color('#7008e7'),
  syntaxPunctuation: color('#fafafa'),
  thinkingOpacity: 0.74,
};

const OPEN_CODE_LIGHT_THEME: OpenCodeTheme = {
  primary: color('#7f22fe'),
  secondary: color('#f4f4f5'),
  accent: color('#7f22fe'),
  error: color('#e7000b'),
  warning: color('#8e51ff'),
  success: color('#8e51ff'),
  info: color('#a684ff'),
  text: color('#09090b'),
  textMuted: color('#71717b'),
  background: color('#ffffff'),
  backgroundPanel: color('#ffffff'),
  backgroundElement: color('#f4f4f5'),
  border: color('#e4e4e7'),
  borderActive: color('#a684ff'),
  borderSubtle: color('#e4e4e7'),
  diffAdded: color('#7f22fe'),
  diffRemoved: color('#e7000b'),
  diffContext: color('#71717b'),
  diffHunkHeader: color('#a684ff'),
  diffHighlightAdded: color('#5d0ec0'),
  diffHighlightRemoved: color('#e7000b'),
  diffAddedBg: color('#f5f3ff'),
  diffRemovedBg: color('#e7000b14'),
  diffContextBg: color('#f4f4f5'),
  diffLineNumber: color('#71717b'),
  diffAddedLineNumberBg: color('#c4b4ff80'),
  diffRemovedLineNumberBg: color('#e7000b26'),
  markdownText: color('#09090b'),
  markdownHeading: color('#7f22fe'),
  markdownLink: color('#7f22fe'),
  markdownLinkText: color('#8e51ff'),
  markdownCode: color('#5d0ec0'),
  markdownBlockQuote: color('#8e51ff'),
  markdownEmph: color('#7008e7'),
  markdownStrong: color('#18181b'),
  markdownHorizontalRule: color('#71717b'),
  markdownListItem: color('#7f22fe'),
  markdownListEnumeration: color('#8e51ff'),
  markdownImage: color('#7f22fe'),
  markdownImageText: color('#8e51ff'),
  markdownCodeBlock: color('#09090b'),
  syntaxComment: color('#71717b'),
  syntaxKeyword: color('#7f22fe'),
  syntaxFunction: color('#5d0ec0'),
  syntaxVariable: color('#18181b'),
  syntaxString: color('#8e51ff'),
  syntaxNumber: color('#7008e7'),
  syntaxType: color('#7f22fe'),
  syntaxOperator: color('#7008e7'),
  syntaxPunctuation: color('#09090b'),
  thinkingOpacity: 0.9,
};

export const resolveOpenCodeTheme = (
  mode: OpenCodeThemeMode,
  platform: MarkdownThemePlatform
): OpenCodeTheme => {
  void platform;
  return mode === 'light' ? OPEN_CODE_LIGHT_THEME : OPEN_CODE_DARK_THEME;
};
