import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  createLoggerFromEnv,
  createMemoryManagerFromEnv,
  loadEnvFiles,
  loadRuntimeConfigFromEnv,
} from '../runtime';

describe('runtime config from env', () => {
  const loggers: Array<ReturnType<typeof createLoggerFromEnv>> = [];
  const managers: Array<ReturnType<typeof createMemoryManagerFromEnv>> = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const manager of managers.splice(0, managers.length)) {
      await manager.close();
    }

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
    expect(config.log.filePath).toBe(path.resolve(cwd, './logs/agent.log'));
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
        AGENT_LOG_FILE: 'agent-runtime.log',
        AGENT_LOG_FORMAT: 'json',
      },
      cwd
    );

    expect(config.storage.backend).toBe('sqlite');
    expect(config.storage.dir).toBe(path.resolve(cwd, './runtime-data'));
    expect(config.storage.sqlitePath).toBe(path.resolve(cwd, './runtime-data/custom.db'));
    expect(config.log.consoleEnabled).toBe(false);
    expect(config.log.fileEnabled).toBe(true);
    expect(config.log.filePath).toBe(path.resolve(cwd, './runtime-logs/agent-runtime.log'));
    expect(config.log.format).toBe('json');
  });

  it('should throw on invalid env values', () => {
    expect(() => loadRuntimeConfigFromEnv({ AGENT_STORAGE_BACKEND: 'memory' }, '/repo')).toThrow(
      'AGENT_STORAGE_BACKEND'
    );

    expect(() => loadRuntimeConfigFromEnv({ AGENT_LOG_LEVEL: 'verbose' }, '/repo')).toThrow(
      'AGENT_LOG_LEVEL'
    );

    expect(() => loadRuntimeConfigFromEnv({ AGENT_LOG_FILE_ENABLED: 'maybe' }, '/repo')).toThrow(
      'Invalid boolean env value'
    );
  });

  it('should create file storage memory manager from env', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-file-env-'));
    tempDirs.push(tempDir);
    const cwd = tempDir;

    const manager = createMemoryManagerFromEnv(
      {
        AGENT_STORAGE_BACKEND: 'file',
        AGENT_STORAGE_DIR: './agent-memory',
      },
      cwd
    );
    managers.push(manager);

    await manager.initialize();
    const sessionId = await manager.createSession('runtime-file', 'System prompt');
    await manager.addMessages(sessionId, [{ messageId: 'm1', role: 'user', content: 'hello' }]);

    const contextPath = path.join(cwd, 'agent-memory', 'contexts', 'runtime-file.json');
    await expect(fs.access(contextPath)).resolves.toBeUndefined();
  });

  it('should create sqlite storage memory manager from env', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-sqlite-env-'));
    tempDirs.push(tempDir);
    const cwd = tempDir;

    const manager = createMemoryManagerFromEnv(
      {
        AGENT_STORAGE_BACKEND: 'sqlite',
        AGENT_SQLITE_PATH: './sqlite-data/agent.db',
      },
      cwd
    );
    managers.push(manager);

    await manager.initialize();
    const sessionId = await manager.createSession('runtime-sqlite', 'System prompt');
    await manager.addMessages(sessionId, [{ messageId: 'm1', role: 'user', content: 'hello' }]);

    const dbPath = path.join(cwd, 'sqlite-data', 'agent.db');
    await expect(fs.access(dbPath)).resolves.toBeUndefined();
  });

  it('should create logger from env with file path', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-logger-env-'));
    tempDirs.push(tempDir);
    const cwd = tempDir;

    const logger = createLoggerFromEnv(
      {
        AGENT_LOG_LEVEL: 'INFO',
        AGENT_LOG_CONSOLE: 'false',
        AGENT_LOG_FILE_ENABLED: 'true',
        AGENT_LOG_DIR: './runtime-logs',
        AGENT_LOG_FILE: 'runtime.log',
        AGENT_LOG_FORMAT: 'pretty',
      },
      cwd
    );
    loggers.push(logger);

    logger.info('runtime logger smoke test');
    const loggerConfig = logger.getConfig();
    expect(loggerConfig.level).toBeDefined();
    expect(loggerConfig.console.enabled).toBe(false);
    expect(loggerConfig.file.enabled).toBe(true);
    expect(loggerConfig.file.filepath).toBe(path.join(cwd, 'runtime-logs', 'runtime.log'));
  });

  it('should load env files from src/config and keep existing process env by default', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-load-env-'));
    tempDirs.push(tempDir);

    const keyA = 'RUNTIME_CONFIG_TEST_KEY_A';
    const keyB = 'RUNTIME_CONFIG_TEST_KEY_B';
    const prevA = process.env[keyA];
    const prevB = process.env[keyB];

    try {
      await fs.writeFile(path.join(tempDir, '.env'), `${keyA}=from-env\n`, 'utf8');
      await fs.writeFile(path.join(tempDir, '.env.development'), `${keyB}=from-env-dev\n`, 'utf8');

      process.env[keyA] = 'existing';
      delete process.env[keyB];

      const loaded = await loadEnvFiles(tempDir);
      expect(loaded.length).toBe(2);

      expect(process.env[keyA]).toBe('existing');
      expect(process.env[keyB]).toBe('from-env-dev');
    } finally {
      if (prevA === undefined) {
        delete process.env[keyA];
      } else {
        process.env[keyA] = prevA;
      }

      if (prevB === undefined) {
        delete process.env[keyB];
      } else {
        process.env[keyB] = prevB;
      }
    }
  });
});
