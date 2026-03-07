import { describe, expect, it } from 'vitest';
import { TerminalUi } from '../terminal-ui';

function createMockStream() {
  let output = '';
  return {
    write(chunk: string) {
      output += chunk;
      return true;
    },
    getOutput() {
      return output;
    },
  };
}

function stripAnsi(text: string): string {
  const esc = String.fromCharCode(27);
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === esc && text[i + 1] === '[') {
      i += 2;
      while (i < text.length && text[i] !== 'm') {
        i += 1;
      }
      continue;
    }
    out += text[i] ?? '';
  }
  return out;
}

describe('TerminalUi mixed render', () => {
  it('writes immutable logs and avoids done status persistence', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      modelId: 'm1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({ type: 'init', sessionId: 's1', modelId: 'm1' });
    ui.dispatch({ type: 'message.user', text: '你好' });
    ui.dispatch({ type: 'run.start', runId: 'r1', prompt: '你好' });
    ui.dispatch({ type: 'stream.text', text: '你好\n世界' });
    ui.dispatch({ type: 'run.finish', completionReason: 'stop' });
    ui.close();

    const output = mock.getOutput();
    expect(output).toContain('●');
    expect(output).toContain('你好');
    expect(output).toContain('世界');
    expect(output).not.toContain('(done');
  });

  it('formats tool block with tree details', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({ type: 'run.start', runId: 'r1', prompt: 'x' });
    ui.dispatch({
      type: 'stream.tool',
      event: {
        toolCallId: 't1',
        toolName: 'bash',
        type: 'start',
        sequence: 1,
        timestamp: Date.now(),
        data: {
          arguments: JSON.stringify({ command: 'ls -la' }),
        },
      },
    });
    ui.dispatch({
      type: 'stream.tool',
      event: {
        toolCallId: 't1',
        toolName: 'bash',
        type: 'stdout',
        sequence: 2,
        timestamp: Date.now(),
        content: 'line1\nline2\nline3\nline4\n',
      },
    });
    ui.dispatch({
      type: 'stream.tool',
      event: {
        toolCallId: 't1',
        toolName: 'bash',
        type: 'end',
        sequence: 3,
        timestamp: Date.now(),
        data: { success: true },
      },
    });

    ui.dispatch({ type: 'run.finish', completionReason: 'stop' });
    ui.close();

    const output = mock.getOutput();
    expect(output).toContain('Bash(ls -la)');
    expect(output).toContain('└');
  });

  it('adds spacing between message blocks but keeps block internals compact', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({ type: 'stream.text', text: 'hello\nworld' });
    ui.dispatch({ type: 'message.system', text: 'next block' });
    ui.close();

    const output = stripAnsi(mock.getOutput());
    expect(output).toContain('● hello\n  world\n\n• next block\n');
  });

  it('renders user message as prompt-style immutable line', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({ type: 'message.user', text: '你好' });
    ui.close();

    const output = stripAnsi(mock.getOutput());
    expect(output).toContain('❯ 你好\n');
  });

  it('does not prepend blank line before user message after prior blocks', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({ type: 'message.system', text: 'ready' });
    ui.dispatch({ type: 'message.user', text: '你好' });
    ui.close();

    const output = stripAnsi(mock.getOutput());
    expect(output).toContain('• ready\n❯ 你好\n');
    expect(output).not.toContain('• ready\n\n❯ 你好\n');
  });

  it('renders assistant snapshot content and reasoning when stream deltas are missing', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({
      type: 'assistant.snapshot',
      messageId: 'm1',
      content: '当前工作目录是：\n/Users/wrr/work/coding-agent-v2',
      reasoningContent: '用户询问当前目录，我先确认 cwd。',
      finishReason: 'tool_calls',
    });
    ui.close();

    const output = stripAnsi(mock.getOutput());
    expect(output).toContain('● 当前工作目录是：');
    expect(output).toContain('/Users/wrr/work/coding-agent-v2');
    expect(output).toContain('用户询问当前目录，我先确认 cwd。');
    const reasoningIdx = output.indexOf('用户询问当前目录，我先确认 cwd。');
    const contentIdx = output.indexOf('当前工作目录是：');
    expect(reasoningIdx).toBeGreaterThanOrEqual(0);
    expect(contentIdx).toBeGreaterThanOrEqual(0);
    expect(reasoningIdx).toBeLessThan(contentIdx);
  });

  it('does not duplicate snapshot content if same message already streamed', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({ type: 'stream.text', text: '已流式输出内容', messageId: 'm2' });
    ui.dispatch({
      type: 'assistant.snapshot',
      messageId: 'm2',
      content: '已流式输出内容',
      reasoningContent: '这段 reasoning 仍需展示。',
      finishReason: 'tool_calls',
    });
    ui.close();

    const output = stripAnsi(mock.getOutput());
    const contentMatches = output.match(/已流式输出内容/g) ?? [];
    expect(contentMatches).toHaveLength(1);
    expect(output).toContain('这段 reasoning 仍需展示。');
  });

  it('repro: partial stream + snapshot(tool_calls) should render full content and reasoning_content', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({
      type: 'stream.text',
      messageId: 'm-tool-1',
      text: '当前工作',
    });
    ui.dispatch({
      type: 'stream.text',
      messageId: 'm-tool-1',
      isReasoning: true,
      text: '用户在询问',
    });
    ui.dispatch({
      type: 'assistant.snapshot',
      messageId: 'm-tool-1',
      finishReason: 'tool_calls',
      content: '当前工作目录是：\n\n```\n/Users/wrr/work/coding-agent-v2\n```',
      reasoningContent:
        '用户在询问当前目录是什么。根据环境信息，工作目录是 /Users/wrr/work/coding-agent-v2。我可以直接回答，也可以用 bash 命令确认一下。',
    });
    ui.close();

    const output = stripAnsi(mock.getOutput());
    expect(output).toContain('/Users/wrr/work/coding-agent-v2');
    expect(output).toContain('根据环境信息，工作目录是 /Users/wrr/work/coding-agent-v2');
  });

  it('renders assistant markdown with third-party renderer', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({
      type: 'assistant.snapshot',
      messageId: 'm-md-1',
      content: '# Title\n\n**bold** text\n\n- item1\n- item2',
      finishReason: 'stop',
    });
    ui.close();

    const output = stripAnsi(mock.getOutput());
    expect(output).toContain('Title');
    expect(output).toContain('bold text');
    expect(output).toContain('item1');
    expect(output).not.toContain('**bold**');
  });
});
