import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { App } from "./App";
import {
  bindExitGuards,
  hardResetTerminal,
  initExitRuntime,
  registerTerminalBackgroundRestore,
} from "./runtime/exit";
import { probeTerminalBackground, setTerminalWindowBackground } from "./runtime/terminal-theme";
import { applyUiThemeMode, uiTheme } from "./ui/theme";

bindExitGuards();
const terminalBackground = await probeTerminalBackground();
applyUiThemeMode(terminalBackground.mode);

if (terminalBackground.rawColor && terminalBackground.rawColor.toLowerCase() !== uiTheme.bg.toLowerCase()) {
  const originalBackground = terminalBackground.rawColor;
  setTerminalWindowBackground(uiTheme.bg);
  registerTerminalBackgroundRestore(() => {
    setTerminalWindowBackground(originalBackground);
  });
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  onDestroy: hardResetTerminal,
  backgroundColor: uiTheme.bg,
});
initExitRuntime(renderer);
createRoot(renderer).render(<App />);
