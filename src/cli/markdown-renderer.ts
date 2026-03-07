import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

export interface MarkdownRendererOptions {
  width?: number;
}

export class MarkdownRenderer {
  private readonly engine: Marked;

  constructor(options?: MarkdownRendererOptions) {
    this.engine = new Marked(
      markedTerminal({
        width: options?.width ?? 80,
        reflowText: false,
        showSectionPrefix: false,
      })
    );
  }

  render(markdown: string): string {
    const parsed = this.engine.parse(markdown, { async: false });
    return typeof parsed === 'string' ? parsed : markdown;
  }
}
