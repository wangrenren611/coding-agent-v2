import { describe, expect, it } from 'bun:test';

import { getClipboardCommandCandidates } from './clipboard';

describe('clipboard runtime', () => {
  it('returns pbcopy on macOS', () => {
    expect(getClipboardCommandCandidates('darwin', {} as NodeJS.ProcessEnv)).toEqual([
      { command: 'pbcopy', args: [] },
    ]);
  });

  it('returns clip on Windows', () => {
    expect(getClipboardCommandCandidates('win32', {} as NodeJS.ProcessEnv)).toEqual([
      { command: 'cmd', args: ['/c', 'clip'] },
    ]);
  });

  it('prefers Wayland tools when WAYLAND_DISPLAY is present', () => {
    expect(
      getClipboardCommandCandidates('linux', {
        WAYLAND_DISPLAY: 'wayland-0',
      } as NodeJS.ProcessEnv)
    ).toEqual([{ command: 'wl-copy', args: [] }]);
  });

  it('returns X11 candidates when DISPLAY is present', () => {
    expect(
      getClipboardCommandCandidates('linux', {
        DISPLAY: ':0',
      } as NodeJS.ProcessEnv)
    ).toEqual([
      { command: 'xclip', args: ['-selection', 'clipboard'] },
      { command: 'xsel', args: ['--clipboard', '--input'] },
      { command: 'wl-copy', args: [] },
    ]);
  });

  it('falls back to wl-copy on Linux without display hints', () => {
    expect(getClipboardCommandCandidates('linux', {} as NodeJS.ProcessEnv)).toEqual([
      { command: 'wl-copy', args: [] },
    ]);
  });
});
