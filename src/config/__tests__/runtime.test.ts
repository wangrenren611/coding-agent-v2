import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createLoggerFromEnv, loadEnvFiles, loadRuntimeConfigFromEnv } from '../runtime';

describe('runtime config from env', () => {
  const loggers: Array<ReturnType<typeof createLoggerFromEnv>> = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const logger of loggers.splice(0, loggers.length)) {
      logger.close();
    }

    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('should load default config', () => {
    const cwd = '/repo';
    const config = loadRuntimeConfigFromEnv({}, cwd);

    expect(config.storage.backend).toBe('file');
    expect(config.storage.dir).toBe(path.resolve(cwd, './data/agent-memory'));
    expect(config.storage.sqlitePath).toBe(
      path.resolve(cwd, './data/agent-memory/agent-memory.db')
    );
    expect(config.log.filePath).toMatch(/^\/repo\/logs\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.log$/);
    expect(config.log.consoleEnabled).toBe(true);
    expect(config.log.fileEnabled).toBe(false);
    expect(config.log.format).toBe('pretty');
  });

  it('should parse custom sqlite and logging config from env', () => {
    const cwd = '/repo';
    const config = loadRuntimeConfigFromEnv(
      {
        AGENT_STORAGE_BACKEND: 'sqlite',
        AGENT_STORAGE_DIR: './runtime-data',
        AGENT_SQLITE_PATH: './runtime-data/custom.db',
        AGENT_LOG_LEVEL: 'debug',
        AGENT_LOG_CONSOLE: '0',
        AGENT_LOG_FILE_ENABLED: '1',
        AGENT_LOG_DIR: './runtime-logs',
        AGENT_LOG_FORMAT: 'json',
      },
      cwd
    );

    expect(config.storage.backend).toBe('sqlite');
    expect(config.storage.dir).toBe(path.resolve(cwd, './runtime-data'));
    expect(config.storage.sqlitePath).toBe(path.resolve(cwd, './runtime-data/custom.db'));
    expect(config.log.level).toBe(10); // DEBUG
    expect(config.log.consoleEnabled).toBe(false);
    expect(config.log.fileEnabled).toBe(true);
    expect(config.log.filePath).toMatch(
      /^\/repo\/runtime-logs\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.log$/
    );
    expect(config.log.format).toBe('json');
  });

  it('should throw on invalid storage backend', () => {
    expect(() => loadRuntimeConfigFromEnv({ AGENT_STORAGE_BACKEND: 'redis' }, '/repo')).toThrow(
      'Invalid AGENT_STORAGE_BACKEND'
    );
  });

  it('should throw on invalid log level', () => {
    expect(() => loadRuntimeConfigFromEnv({ AGENT_LOG_LEVEL: 'verbose' }, '/repo')).toThrow(
      'Invalid AGENT_LOG_LEVEL'
    );
  });

  it('should throw on invalid log format', () => {
    expect(() => loadRuntimeConfigFromEnv({ AGENT_LOG_FORMAT: 'xml' }, '/repo')).toThrow(
      'Invalid AGENT_LOG_FORMAT'
    );
  });

  it('should load env files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
    tempDirs.push(tmpDir);

    await fs.writeFile(
      path.join(tmpDir, '.env'),
      'AGENT_LOG_LEVEL=debug\nAGENT_STORAGE_DIR=./custom-data\n'
    );

    const loaded = await loadEnvFiles(tmpDir, { files: ['.env'], override: true });
    expect(loaded).toHaveLength(1);
    expect(process.env.AGENT_LOG_LEVEL).toBe('debug');
    expect(process.env.AGENT_STORAGE_DIR).toBe('./custom-data');

    delete process.env.AGENT_LOG_LEVEL;
    delete process.env.AGENT_STORAGE_DIR;
  });

  it('should create logger from env', () => {
    const logger = createLoggerFromEnv(
      { AGENT_LOG_LEVEL: 'info', AGENT_LOG_CONSOLE: 'true' },
      '/repo'
    );
    loggers.push(logger);
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});
