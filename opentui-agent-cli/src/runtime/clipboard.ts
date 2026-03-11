import type { CliRenderer } from '@opentui/core';
import { spawn } from 'node:child_process';

type ClipboardCommand = {
  command: string;
  args: string[];
};

type ClipboardRenderer = Pick<CliRenderer, 'copyToClipboardOSC52'>;

const runClipboardCommand = (text: string, candidate: ClipboardCommand): Promise<boolean> => {
  return new Promise(resolve => {
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(success);
    };

    try {
      const child = spawn(candidate.command, candidate.args, {
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
      });

      child.once('error', () => {
        finish(false);
      });
      child.once('close', code => {
        finish(code === 0);
      });
      child.stdin.on('error', () => {
        finish(false);
      });
      child.stdin.end(text);
    } catch {
      finish(false);
    }
  });
};

export const getClipboardCommandCandidates = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): ClipboardCommand[] => {
  if (platform === 'darwin') {
    return [{ command: 'pbcopy', args: [] }];
  }

  if (platform === 'win32') {
    return [{ command: 'cmd', args: ['/c', 'clip'] }];
  }

  const candidates: ClipboardCommand[] = [];

  if (env['WAYLAND_DISPLAY']) {
    candidates.push({ command: 'wl-copy', args: [] });
  }

  if (env['DISPLAY']) {
    candidates.push({ command: 'xclip', args: ['-selection', 'clipboard'] });
    candidates.push({ command: 'xsel', args: ['--clipboard', '--input'] });
  }

  if (!env['WAYLAND_DISPLAY']) {
    candidates.push({ command: 'wl-copy', args: [] });
  }

  return candidates;
};

export const copyTextToClipboard = async (
  text: string,
  renderer: ClipboardRenderer | null = null
): Promise<boolean> => {
  if (!text) {
    return false;
  }

  for (const candidate of getClipboardCommandCandidates()) {
    if (await runClipboardCommand(text, candidate)) {
      return true;
    }
  }

  return renderer?.copyToClipboardOSC52(text) ?? false;
};
