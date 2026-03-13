import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ensureConfigDirs,
  getGlobalConfigDir,
  getGlobalConfigPath,
  getProjectConfigDir,
  getProjectConfigPath,
  loadConfig,
  writeGlobalConfig,
  writeProjectConfig,
} from '../loader';
import { LogLevel } from '../../logger';

describe('Renx Config Loader', () => {
  let tmpDir: string;
  let globalDir: string;
  let renxHome: string;
  const originalRenxHome = process.env.RENX_HOME;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renx-config-test-'));
    renxHome = path.join(tmpDir, 'renx-home');
    globalDir = path.join(tmpDir, '.renx-global');
    process.env.RENX_HOME = renxHome;
  });

  afterEach(() => {
    if (originalRenxHome === undefined) {
      delete process.env.RENX_HOME;
    } else {
      process.env.RENX_HOME = originalRenxHome;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('path helpers', () => {
    it('should return global config dir', () => {
      expect(getGlobalConfigDir()).toBe(renxHome);
    });

    it('should return project config dir', () => {
      expect(getProjectConfigDir(path.join(path.sep, 'my', 'project'))).toBe(
        path.join(path.sep, 'my', 'project', '.renx')
      );
    });

    it('should return global config path', () => {
      expect(getGlobalConfigPath()).toBe(path.join(renxHome, 'config.json'));
    });

    it('should return project config path', () => {
      expect(getProjectConfigPath(path.join(path.sep, 'my', 'project'))).toBe(
        path.join(path.sep, 'my', 'project', '.renx', 'config.json')
      );
    });
  });

  describe('loadConfig with defaults', () => {
    it('should initialize and load default global config when no files exist', () => {
      const config = loadConfig({
        projectRoot: tmpDir,
        globalDir,
        loadEnv: false,
        env: { RENX_HOME: renxHome },
      });

      expect(config.log.level).toBe(LogLevel.INFO);
      expect(config.log.format).toBe('pretty');
      expect(config.log.console).toBe(false);
      expect(config.log.file).toBe(true);
      expect(config.agent.maxSteps).toBe(10000);
      expect(config.agent.confirmationMode).toBe('manual');
      expect(config.agent.defaultModel).toBe('qwen3.5-plus');
      expect(config.storage.fileHistory.enabled).toBe(true);
      expect(config.sources.global).toBe(path.join(globalDir, 'config.json'));
      expect(config.sources.project).toBeNull();
      expect(fs.existsSync(path.join(globalDir, 'config.json'))).toBe(true);
    });
  });

  describe('loadConfig with global config', () => {
    it('should merge global config over defaults', () => {
      fs.mkdirSync(globalDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalDir, 'config.json'),
        JSON.stringify({
          log: { level: 'DEBUG', format: 'json' },
          agent: { defaultModel: 'gpt-5.3' },
        })
      );

      const config = loadConfig({
        projectRoot: tmpDir,
        globalDir,
        loadEnv: false,
        env: { RENX_HOME: renxHome },
      });

      expect(config.log.level).toBe(LogLevel.DEBUG);
      expect(config.log.format).toBe('json');
      expect(config.agent.defaultModel).toBe('gpt-5.3');
      expect(config.log.console).toBe(false);
      expect(config.agent.maxSteps).toBe(10000);
      expect(config.sources.global).toBe(path.join(globalDir, 'config.json'));
      expect(config.sources.project).toBeNull();
    });
  });

  describe('loadConfig with project config', () => {
    it('should merge project config over global config', () => {
      fs.mkdirSync(globalDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalDir, 'config.json'),
        JSON.stringify({
          log: { level: 'DEBUG', format: 'json' },
          agent: { defaultModel: 'gpt-5.3', maxSteps: 100 },
        })
      );

      const projectConfigDir = path.join(tmpDir, '.renx');
      fs.mkdirSync(projectConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          log: { level: 'ERROR' },
          agent: { defaultModel: 'openrouter/hunter-alpha' },
        })
      );

      const config = loadConfig({
        projectRoot: tmpDir,
        globalDir,
        loadEnv: false,
        env: { RENX_HOME: renxHome },
      });

      expect(config.log.level).toBe(LogLevel.ERROR);
      expect(config.agent.defaultModel).toBe('openrouter/hunter-alpha');
      expect(config.log.format).toBe('json');
      expect(config.agent.maxSteps).toBe(100);
      expect(config.sources.global).toBe(path.join(globalDir, 'config.json'));
      expect(config.sources.project).toBe(path.join(projectConfigDir, 'config.json'));
    });
  });

  describe('loadConfig with env overrides', () => {
    it('should apply env overrides over file configs', () => {
      const projectConfigDir = path.join(tmpDir, '.renx');
      fs.mkdirSync(projectConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectConfigDir, 'config.json'),
        JSON.stringify({
          log: { level: 'INFO' },
          agent: { defaultModel: 'glm-5' },
        })
      );

      const config = loadConfig({
        projectRoot: tmpDir,
        globalDir,
        env: {
          RENX_HOME: renxHome,
          AGENT_LOG_LEVEL: 'FATAL',
          AGENT_MODEL: 'qwen3.5-max',
          AGENT_TOOL_CONFIRMATION_MODE: 'manual',
        },
      });

      expect(config.log.level).toBe(LogLevel.FATAL);
      expect(config.agent.defaultModel).toBe('qwen3.5-max');
      expect(config.agent.confirmationMode).toBe('manual');
    });

    it('should use AGENT_* env vars directly', () => {
      const config = loadConfig({
        projectRoot: tmpDir,
        globalDir,
        env: {
          RENX_HOME: renxHome,
          AGENT_LOG_LEVEL: 'WARN',
          AGENT_LOG_FORMAT: 'json',
          AGENT_TOOL_CONFIRMATION_MODE: 'auto-deny',
        },
      });

      expect(config.log.level).toBe(LogLevel.WARN);
      expect(config.log.format).toBe('json');
      expect(config.agent.confirmationMode).toBe('auto-deny');
    });
  });

  describe('writeProjectConfig', () => {
    it('should write project config file', () => {
      const configPath = writeProjectConfig(
        { log: { level: 'DEBUG' }, agent: { defaultModel: 'gpt-5.3' } },
        tmpDir
      );

      expect(fs.existsSync(configPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(content.log.level).toBe('DEBUG');
      expect(content.agent.defaultModel).toBe('gpt-5.3');
    });
  });

  describe('writeGlobalConfig', () => {
    it('should write global config file', () => {
      const configPath = writeGlobalConfig({ log: { level: 'WARN' } });

      expect(fs.existsSync(configPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(content.log.level).toBe('WARN');
    });
  });

  describe('ensureConfigDirs', () => {
    it('should create config directories', () => {
      ensureConfigDirs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, '.renx'))).toBe(true);
      expect(fs.existsSync(renxHome)).toBe(true);
    });
  });

  describe('resolved paths', () => {
    it('should resolve runtime paths under RENX_HOME', () => {
      const config = loadConfig({
        projectRoot: tmpDir,
        globalDir,
        loadEnv: false,
        env: { RENX_HOME: renxHome },
      });

      expect(path.isAbsolute(config.log.dir)).toBe(true);
      expect(path.isAbsolute(config.log.filePath)).toBe(true);
      expect(path.isAbsolute(config.storage.root)).toBe(true);
      expect(path.isAbsolute(config.db.path)).toBe(true);
      expect(config.log.dir).toBe(path.join(renxHome, 'logs'));
      expect(config.storage.root).toBe(path.join(renxHome, 'storage'));
      expect(config.db.path).toBe(path.join(renxHome, 'data.db'));
      expect(config.log.filePath.startsWith(path.join(renxHome, 'logs'))).toBe(true);
    });
  });
});
