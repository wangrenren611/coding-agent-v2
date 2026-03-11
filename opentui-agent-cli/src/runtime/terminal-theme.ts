/* global NodeJS */

export type RgbColor = {
  r: number;
  g: number;
  b: number;
};

export type TerminalBackgroundMode = 'dark' | 'light';
export type TerminalBackgroundProbe = {
  mode: TerminalBackgroundMode;
  rawColor: string | null;
};
export type TerminalColorProbe = {
  rawBackgroundColor: string | null;
  rawForegroundColor: string | null;
  mode: TerminalBackgroundMode;
};

// eslint-disable-next-line no-control-regex
const OSC10_PATTERN = /\x1b]10;([^\x07\x1b]+)/;
// eslint-disable-next-line no-control-regex
const OSC11_PATTERN = /\x1b]11;([^\x07\x1b]+)/;

const wrapOscForTmux = (osc: string) => {
  if (!process.env['TMUX']) {
    return osc;
  }

  return `\x1bPtmux;\x1b${osc}\x1b\\`;
};

const writeOsc = (osc: string) => {
  if (!process.stdout.isTTY) {
    return;
  }

  try {
    process.stdout.write(wrapOscForTmux(osc));
  } catch {
    // Ignore errors when writing to stdout
  }
};

export const parseTerminalColor = (value: string): RgbColor | null => {
  if (value.startsWith('rgb:')) {
    const parts = value.slice(4).split('/');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return null;
    }

    const [rHex, gHex, bHex] = parts;
    const r16 = Number.parseInt(rHex, 16);
    const g16 = Number.parseInt(gHex, 16);
    const b16 = Number.parseInt(bHex, 16);
    if (Number.isNaN(r16) || Number.isNaN(g16) || Number.isNaN(b16)) {
      return null;
    }

    return {
      r: r16 >> 8,
      g: g16 >> 8,
      b: b16 >> 8,
    };
  }

  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return {
      r: Number.parseInt(value.slice(1, 3), 16),
      g: Number.parseInt(value.slice(3, 5), 16),
      b: Number.parseInt(value.slice(5, 7), 16),
    };
  }

  const rgbMatch = value.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
    const r = Number.parseInt(rgbMatch[1], 10);
    const g = Number.parseInt(rgbMatch[2], 10);
    const b = Number.parseInt(rgbMatch[3], 10);
    if (r > 255 || g > 255 || b > 255) {
      return null;
    }

    return { r, g, b };
  }

  return null;
};

export const modeFromColor = ({ r, g, b }: RgbColor): TerminalBackgroundMode => {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? 'light' : 'dark';
};

export const extractOsc10Color = (chunk: string): string | null => {
  const match = chunk.match(OSC10_PATTERN);
  return match?.[1] ?? null;
};

export const extractOsc11Color = (chunk: string): string | null => {
  const match = chunk.match(OSC11_PATTERN);
  return match?.[1] ?? null;
};

export const setTerminalWindowForeground = (color: string) => {
  writeOsc(`\x1b]10;${color}\x07`);
};

export const setTerminalWindowBackground = (color: string) => {
  writeOsc(`\x1b]11;${color}\x07`);
};

export const probeTerminalColors = async (timeoutMs = 1000): Promise<TerminalColorProbe> => {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    typeof process.stdin.setRawMode !== 'function'
  ) {
    return { mode: 'dark', rawBackgroundColor: null, rawForegroundColor: null };
  }

  return new Promise(resolve => {
    const stdin = process.stdin;
    const previousRawMode = Boolean(stdin.isRaw);
    let timer: NodeJS.Timeout | null = null;
    let finished = false;
    let rawBackgroundColor: string | null = null;
    let rawForegroundColor: string | null = null;

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;

      if (timer) {
        clearTimeout(timer);
      }

      stdin.removeListener('data', onData);
      try {
        stdin.setRawMode(previousRawMode);
      } catch {
        // Ignore errors when restoring raw mode
      }

      const color = rawBackgroundColor ? parseTerminalColor(rawBackgroundColor) : null;
      resolve({
        rawBackgroundColor,
        rawForegroundColor,
        mode: color ? modeFromColor(color) : 'dark',
      });
    };

    const onData = (data: Buffer) => {
      const chunk = data.toString();
      rawForegroundColor ??= extractOsc10Color(chunk);
      rawBackgroundColor ??= extractOsc11Color(chunk);

      if (rawForegroundColor && rawBackgroundColor) {
        finish();
      }
    };

    try {
      stdin.setRawMode(true);
      stdin.on('data', onData);
      writeOsc('\x1b]10;?\x07');
      writeOsc('\x1b]11;?\x07');
    } catch {
      finish();
      return;
    }

    timer = setTimeout(() => {
      finish();
    }, timeoutMs);
  });
};

export const probeTerminalBackground = async (
  timeoutMs = 1000
): Promise<TerminalBackgroundProbe> => {
  const result = await probeTerminalColors(timeoutMs);
  return {
    rawColor: result.rawBackgroundColor,
    mode: result.mode,
  };
};

export const detectTerminalBackgroundMode = async (
  timeoutMs = 1000
): Promise<TerminalBackgroundMode> => {
  const result = await probeTerminalColors(timeoutMs);
  return result.mode;
};
