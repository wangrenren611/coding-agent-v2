import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { App } from "./App";
import { bindExitGuards, hardResetTerminal, initExitRuntime } from "./runtime/exit";

bindExitGuards();

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  onDestroy: hardResetTerminal,
});
initExitRuntime(renderer);
createRoot(renderer).render(<App />);
