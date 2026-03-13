import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
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

    delete process.env.AGENT_LOG_LEVEL;
    delete process.env.RENX_HOME;
  });

  it('should load default runtime logging config', () => {
    const config = loadRuntimeConfigFromEnv({});

    expect(config.log.consoleEnabled).toBe(false);
    expect(config.log.fileEnabled).toBe(true);
    expect(config.log.format).toBe('pretty');
    expect(config.log.filePath.endsWith('.log')).toBe(true);
  });

  it('should derive logging paths from RENX_HOME', async () => {
    const renxHome = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-home-'));
    tempDirs.push(renxHome);
    const config = loadRuntimeConfigFromEnv({
      RENX_HOME: renxHome,
      AGENT_LOG_LEVEL: 'debug',
      AGENT_LOG_CONSOLE: '0',
      AGENT_LOG_FILE_ENABLED: '1',
      AGENT_LOG_FORMAT: 'json',
    });

    expect(config.log.level).toBe(10);
    expect(config.log.consoleEnabled).toBe(false);
    expect(config.log.fileEnabled).toBe(true);
    expect(config.log.filePath.startsWith(path.join(renxHome, 'logs'))).toBe(true);
    expect(config.log.format).toBe('json');
  });

  it('should throw on invalid log level', () => {
    expect(() => loadRuntimeConfigFromEnv({ AGENT_LOG_LEVEL: 'verbose' })).toThrow(
      'Invalid AGENT_LOG_LEVEL'
    );
  });

  it('should throw on invalid log format', () => {
    expect(() => loadRuntimeConfigFromEnv({ AGENT_LOG_FORMAT: 'xml' })).toThrow(
      'Invalid AGENT_LOG_FORMAT'
    );
  });

  it('should load env files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
    tempDirs.push(tmpDir);

    await fs.writeFile(
      path.join(tmpDir, '.env'),
      'AGENT_LOG_LEVEL=debug\nRENX_HOME=./custom-home\n'
    );

    const loaded = await loadEnvFiles(tmpDir, { files: ['.env'], override: true });
    expect(loaded).toHaveLength(1);
    expect(process.env.AGENT_LOG_LEVEL).toBe('debug');
    expect(process.env.RENX_HOME).toBe('./custom-home');
  });

  it('should create logger from env', () => {
    const logger = createLoggerFromEnv({
      AGENT_LOG_LEVEL: 'info',
      AGENT_LOG_CONSOLE: 'true',
    });
    loggers.push(logger);
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});
