import type { CliRenderer } from '@opentui/core';

const TERMINAL_RESET_SEQUENCE = [
  '\u001b[0m',
  '\u001b[?25h',
  '\u001b[?1000l',
  '\u001b[?1002l',
  '\u001b[?1003l',
  '\u001b[?1006l',
  '\u001b[?2004l',
  '\u001b[?2026l',
  '\u001b[?2027l',
  '\u001b[?2031l',
  '\u001b[?1049l',
].join('');

let rendererRef: CliRenderer | null = null;
let hasCleanedUp = false;
let terminalBackgroundRestore: (() => void) | null = null;

export const registerTerminalBackgroundRestore = (restore: (() => void) | null) => {
  terminalBackgroundRestore = restore;
};

export const hardResetTerminal = () => {
  if (!globalThis.process.stdout.isTTY) {
    return;
  }

  try {
    const restore = terminalBackgroundRestore;
    terminalBackgroundRestore = null;
    restore?.();

    globalThis.process.stdout.write(TERMINAL_RESET_SEQUENCE);
    if (
      globalThis.process.stdin.isTTY &&
      typeof globalThis.process.stdin.setRawMode === 'function'
    ) {
      globalThis.process.stdin.setRawMode(false);
    }
  } catch {
    // Ignore errors during terminal reset
  }
};

export const initExitRuntime = (renderer: CliRenderer) => {
  hasCleanedUp = false;
  rendererRef = renderer;
};

export const requestExit = (exitCode = 0) => {
  if (hasCleanedUp) {
    return;
  }
  hasCleanedUp = true;

  try {
    if (rendererRef) {
      rendererRef.useMouse = false;
      rendererRef.setTerminalTitle('');
      rendererRef.disableKittyKeyboard();
      rendererRef.destroy();
    }
  } catch {
    // Ignore errors during renderer cleanup
  }

  hardResetTerminal();
  globalThis.process.exit(exitCode);
};

export const bindExitGuards = () => {
  globalThis.process.once('SIGINT', () => requestExit(0));
  globalThis.process.once('SIGTERM', () => requestExit(0));
  globalThis.process.once('exit', hardResetTerminal);
};
