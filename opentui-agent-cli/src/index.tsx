import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';

import { App } from './App';
import { applyCliArgsToEnv } from './runtime/cli-args';
import {
  bindExitGuards,
  hardResetTerminal,
  initExitRuntime,
  registerTerminalBackgroundRestore,
} from './runtime/exit';
import {
  probeTerminalColors,
  setTerminalWindowBackground,
  setTerminalWindowForeground,
} from './runtime/terminal-theme';
import { applyMarkdownThemeMode } from './ui/opencode-markdown';
import { applyUiThemeMode, uiTheme } from './ui/theme';

const cliArgsResult = applyCliArgsToEnv();
if (!cliArgsResult.ok) {
  console.error(cliArgsResult.error);
  process.exit(1);
}

bindExitGuards();
// OpenTUI exposes OPENTUI_FORCE_WCWIDTH for terminals where CJK width handling
// is more accurate with wcwidth than the default Unicode capability probe.
process.env.OPENTUI_FORCE_WCWIDTH ??= '1';
const terminalColors = await probeTerminalColors();
applyUiThemeMode(terminalColors.mode);
applyMarkdownThemeMode(terminalColors.mode, process.platform);

if (
  terminalColors.rawBackgroundColor &&
  terminalColors.rawBackgroundColor.toLowerCase() !== uiTheme.bg.toLowerCase()
) {
  const originalBackground = terminalColors.rawBackgroundColor;
  setTerminalWindowBackground(uiTheme.bg);
  registerTerminalBackgroundRestore(() => {
    setTerminalWindowBackground(originalBackground);
  });
}

if (
  terminalColors.rawForegroundColor &&
  terminalColors.rawForegroundColor.toLowerCase() !== uiTheme.userPromptText.toLowerCase()
) {
  const originalForeground = terminalColors.rawForegroundColor;
  setTerminalWindowForeground(uiTheme.userPromptText);
  registerTerminalBackgroundRestore(() => {
    setTerminalWindowForeground(originalForeground);
  });
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  onDestroy: hardResetTerminal,
  backgroundColor: uiTheme.bg,
});
initExitRuntime(renderer);
createRoot(renderer).render(<App />);
