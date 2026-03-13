import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfigToEnv } from '../loader';

describe('loadConfigToEnv', () => {
  let tmpDir: string;
  let globalDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renx-env-test-'));
    globalDir = path.join(tmpDir, '.renx-global');
    process.env = { ...originalEnv };

    delete process.env.AGENT_LOG_LEVEL;
    delete process.env.AGENT_LOG_FORMAT;
    delete process.env.AGENT_LOG_FILE_ENABLED;
    delete process.env.AGENT_LOG_CONSOLE;
    delete process.env.AGENT_FILE_HISTORY_ENABLED;
    delete process.env.AGENT_FILE_HISTORY_MAX_PER_FILE;
    delete process.env.AGENT_FILE_HISTORY_MAX_AGE_DAYS;
    delete process.env.AGENT_FILE_HISTORY_MAX_TOTAL_MB;
    delete process.env.AGENT_TOOL_CONFIRMATION_MODE;
    delete process.env.AGENT_MODEL;
    delete process.env.AGENT_MAX_STEPS;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should load global config.json into env', () => {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, 'config.json'),
      JSON.stringify({
        log: { level: 'DEBUG', format: 'json', file: true },
        agent: { defaultModel: 'gpt-5.4' },
      })
    );

    const files = loadConfigToEnv({ projectRoot: tmpDir, globalDir });

    expect(files).toHaveLength(1);
    expect(process.env.AGENT_LOG_LEVEL).toBe('DEBUG');
    expect(process.env.AGENT_LOG_FORMAT).toBe('json');
    expect(process.env.AGENT_LOG_FILE_ENABLED).toBe('true');
    expect(process.env.AGENT_MODEL).toBe('gpt-5.4');
  });

  it('should load project config.json over global', () => {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, 'config.json'),
      JSON.stringify({ log: { level: 'INFO' }, agent: { defaultModel: 'glm-5' } })
    );

    const projectConfigDir = path.join(tmpDir, '.renx');
    fs.mkdirSync(projectConfigDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectConfigDir, 'config.json'),
      JSON.stringify({ log: { level: 'ERROR' }, agent: { defaultModel: 'gpt-5.3' } })
    );

    const files = loadConfigToEnv({ projectRoot: tmpDir, globalDir });

    expect(files).toHaveLength(2);
    expect(process.env.AGENT_LOG_LEVEL).toBe('ERROR');
    expect(process.env.AGENT_MODEL).toBe('gpt-5.3');
  });

  it('should not override existing env vars', () => {
    process.env.AGENT_LOG_LEVEL = 'WARN';

    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, 'config.json'),
      JSON.stringify({ log: { level: 'DEBUG' } })
    );

    loadConfigToEnv({ projectRoot: tmpDir, globalDir });

    expect(process.env.AGENT_LOG_LEVEL).toBe('WARN');
  });

  it('should initialize global config.json when no config files exist', () => {
    const files = loadConfigToEnv({ projectRoot: tmpDir, globalDir });
    expect(files).toEqual([path.join(globalDir, 'config.json')]);
    expect(fs.existsSync(path.join(globalDir, 'config.json'))).toBe(true);
    expect(process.env.AGENT_MODEL).toBe('qwen3.5-plus');
    expect(process.env.AGENT_TOOL_CONFIRMATION_MODE).toBe('manual');
  });

  it('should load storage config', () => {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, 'config.json'),
      JSON.stringify({
        storage: {
          fileHistory: { enabled: false, maxPerFile: 50 },
        },
      })
    );

    loadConfigToEnv({ projectRoot: tmpDir, globalDir });

    expect(process.env.AGENT_FILE_HISTORY_ENABLED).toBe('false');
    expect(process.env.AGENT_FILE_HISTORY_MAX_PER_FILE).toBe('50');
  });

  it('should load agent config', () => {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, 'config.json'),
      JSON.stringify({
        agent: { confirmationMode: 'manual', defaultModel: 'qwen3.5-max', maxSteps: 100 },
      })
    );

    loadConfigToEnv({ projectRoot: tmpDir, globalDir });

    expect(process.env.AGENT_TOOL_CONFIRMATION_MODE).toBe('manual');
    expect(process.env.AGENT_MODEL).toBe('qwen3.5-max');
    expect(process.env.AGENT_MAX_STEPS).toBe('100');
  });
});
