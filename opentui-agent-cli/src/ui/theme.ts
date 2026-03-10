import { TextAttributes } from "@opentui/core";

export type UiThemeMode = "dark" | "light";
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
  inputCursor: string;
  inputSelectionBg: string;
  inputSelectionText: string;
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

const baseLayout: UiTheme["layout"] = {
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

const baseTypography: UiTheme["typography"] = {
  body: TextAttributes.BOLD,
  code: TextAttributes.BOLD,
  muted: TextAttributes.BOLD,
  note: TextAttributes.NONE,
  heading: TextAttributes.BOLD,
};

const DARK_THEME: UiTheme = {
  bg: "#0a0a0a",
  surface: "#141414",
  panel: "#141414",
  text: "#eeeeee",
  muted: "#808080",
  subtle: "#808080",
  accent: "#fab283",
  thinking: "#808080",
  divider: "#1e1e1e",
  inputCursor: "#fab283",
  inputSelectionBg: "#3c3c3c",
  inputSelectionText: "#eeeeee",
  layout: baseLayout,
  typography: baseTypography,
};

const LIGHT_THEME: UiTheme = {
  bg: "#eceff3",
  surface: "#ffffff",
  panel: "#eceff3",
  text: "#1f2530",
  muted: "#596273",
  subtle: "#738094",
  accent: "#0b67d7",
  thinking: "#8f6a1f",
  divider: "#cfd5de",
  inputCursor: "#0b67d7",
  inputSelectionBg: "#b9d2f6",
  inputSelectionText: "#1f2530",
  layout: baseLayout,
  typography: baseTypography,
};

const cloneTheme = (theme: UiTheme): UiTheme => ({
  ...theme,
  layout: { ...theme.layout },
  typography: { ...theme.typography },
});

export let uiTheme: UiTheme = cloneTheme(DARK_THEME);

export const applyUiThemeMode = (mode: UiThemeMode) => {
  uiTheme = cloneTheme(mode === "light" ? LIGHT_THEME : DARK_THEME);
};
