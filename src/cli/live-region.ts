import { createLogUpdate } from 'log-update';

export class LiveRegionManager {
  private readonly logUpdate: ReturnType<typeof createLogUpdate>;
  private renderedLineCount = 0;
  private suspendedDepth = 0;
  private bufferedLines: string[] = [];
  private lastRenderedLines: string[] = [];

  constructor(stream: NodeJS.WriteStream) {
    this.logUpdate = createLogUpdate(stream, { showCursor: true });
  }

  render(lines: string[]): void {
    const normalized = lines.map((line) => line.replace(/[\r\n]+/g, ''));
    if (this.suspendedDepth > 0) {
      this.bufferedLines = normalized;
      return;
    }

    if (this.isSameAsLast(normalized)) {
      return;
    }

    this.hide();
    if (normalized.length === 0) {
      this.lastRenderedLines = [];
      this.renderedLineCount = 0;
      return;
    }

    this.logUpdate(normalized.join('\n'));
    this.lastRenderedLines = normalized;
    this.renderedLineCount = normalized.length;
  }

  hide(): void {
    if (this.renderedLineCount === 0) {
      return;
    }
    this.logUpdate.clear();
    this.lastRenderedLines = [];
    this.renderedLineCount = 0;
  }

  withHidden<T>(run: () => T): T {
    this.suspendedDepth += 1;
    if (this.suspendedDepth === 1) {
      this.hide();
    }

    try {
      return run();
    } finally {
      this.suspendedDepth = Math.max(0, this.suspendedDepth - 1);
      if (this.suspendedDepth === 0 && this.bufferedLines.length > 0) {
        const pending = [...this.bufferedLines];
        this.bufferedLines = [];
        this.render(pending);
      }
    }
  }

  clear(): void {
    this.bufferedLines = [];
    this.hide();
  }

  private isSameAsLast(next: string[]): boolean {
    if (next.length !== this.lastRenderedLines.length) {
      return false;
    }
    for (let i = 0; i < next.length; i++) {
      if ((next[i] ?? '') !== (this.lastRenderedLines[i] ?? '')) {
        return false;
      }
    }
    return true;
  }
}
