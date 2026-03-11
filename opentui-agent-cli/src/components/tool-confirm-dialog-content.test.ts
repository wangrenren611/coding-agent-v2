import { describe, expect, it } from 'vitest';

import { buildToolConfirmDialogContent } from './tool-confirm-dialog-content';

describe('buildToolConfirmDialogContent', () => {
  it('formats outside-workspace glob confirmations with path details', () => {
    const content = buildToolConfirmDialogContent({
      toolCallId: 'call_1',
      toolName: 'glob',
      args: {
        pattern: '**/*sandbox*',
        path: '/Users/wrr/work/ironclaw',
      },
      rawArgs: {
        pattern: '**/*sandbox*',
        path: '/Users/wrr/work/ironclaw',
      },
      reason:
        'SEARCH_PATH_NOT_ALLOWED: /Users/wrr/work/ironclaw is outside allowed directories: /Users/wrr/work/coding-agent-v2',
      metadata: {
        requestedPath: '/Users/wrr/work/ironclaw',
        allowedDirectories: ['/Users/wrr/work/coding-agent-v2'],
      },
    });

    expect(content.summary).toBe('Glob **/*sandbox*');
    expect(content.detail).toBe('Path: /Users/wrr/work/ironclaw');
    expect(content.requestedPath).toBe('/Users/wrr/work/ironclaw');
    expect(content.allowedDirectories).toEqual(['/Users/wrr/work/coding-agent-v2']);
    expect(content.argumentItems).toEqual([]);
  });

  it('formats bash confirmations with command preview', () => {
    const content = buildToolConfirmDialogContent({
      toolCallId: 'call_2',
      toolName: 'bash',
      args: {
        description: 'List repo files',
        command: 'rg --files src',
      },
      rawArgs: {
        description: 'List repo files',
        command: 'rg --files src',
      },
    });

    expect(content.summary).toBe('Run bash: List repo files');
    expect(content.detail).toBe('$ rg --files src');
    expect(content.reason).toBeUndefined();
    expect(content.argumentItems).toEqual([]);
  });

  it('hides redundant file path arguments that are already surfaced elsewhere', () => {
    const content = buildToolConfirmDialogContent({
      toolCallId: 'call_3',
      toolName: 'file_read',
      args: {
        path: '/Users/wrr/work/ironclaw/src/sandbox/config.rs',
      },
      rawArgs: {
        path: '/Users/wrr/work/ironclaw/src/sandbox/config.rs',
      },
      reason:
        'PATH_NOT_ALLOWED: /Users/wrr/work/ironclaw/src/sandbox/config.rs is outside allowed directories: /Users/wrr/work/coding-agent-v2',
      metadata: {
        requestedPath: '/Users/wrr/work/ironclaw/src/sandbox/config.rs',
        allowedDirectories: ['/Users/wrr/work/coding-agent-v2'],
      },
    });

    expect(content.summary).toBe('Read /Users/wrr/work/ironclaw/src/sandbox/config.rs');
    expect(content.argumentItems).toEqual([]);
  });

  it('parses json-like string arguments into readable structured values', () => {
    const content = buildToolConfirmDialogContent({
      toolCallId: 'call_4',
      toolName: 'custom_tool',
      args: {
        payload: '{"path":"/tmp/project","recursive":true}',
        retries: 3,
      },
      rawArgs: {
        payload: '{"path":"/tmp/project","recursive":true}',
        retries: 3,
      },
    });

    expect(content.summary).toBe('Call custom_tool');
    expect(content.argumentItems).toEqual([
      {
        label: 'Payload',
        value: '{\n  "path": "/tmp/project",\n  "recursive": true\n}',
        multiline: true,
      },
      {
        label: 'Retries',
        value: '3',
        multiline: undefined,
      },
    ]);
  });
});
