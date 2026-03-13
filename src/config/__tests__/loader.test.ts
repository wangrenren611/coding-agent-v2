import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  loadConfig,
  getGlobalConfigDir,
  getProjectConfigDir,
  getGlobalConfigPath,
  getProjectConfigPath,
  ensureConfigDirs,
  writeProjectConfig,
  writeGlobalConfig,
} from '../loader';
import { LogLevel } from '../../logger';

describe('Renx Config Loader', () => {
  let tmpDir: string;
  let globalDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renx-config-test-'));
    globalDir = path.join(tmpDir, '.renx-global');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('path helpers', () => {
    it('should return global config dir', () => {
      const dir = getGlobalConfigDir();
      expect(dir).toContain('.renx');
      expect(dir).toBe(path.join(os.homedir(), '.renx'));
    });

    it('should return project config dir', () => {
      const dir = getProjectConfigDir('/my/project');
      expect(dir).toBe('/my/project/.renx');
    });

    it('should return global config path', () => {
      const p = getGlobalConfigPath();
      expect(p).toBe(path.join(os.homedir(), '.renx', 'config.json'));
    });

    it('should return project config path', () => {
      const p = getProjectConfigPath('/my/project');
      expect(p).toBe('/my/project/.renx/config.json');
    });
  });

  describe('loadConfig with defaults', () => {
    it('should load default config when no files exist', () => {
      const config = loadConfig({
        projectRoot: tmpDir,
        globalDir,
        loadEnv: false,
      });

      expect(config.log.level).toBe(LogLevel.INFO);
      expect(config.log.format).toBe('pretty');
      expect(config.log.console).toBe(true);
      expect(config.log.file).toBe(false);
      expect(config.agent.maxSteps).toBe(50);
      expect(config.agent.confirmationMode).toBe('auto-approve');
      expect(config.agent.defaultModel).toBe('glm-5');
      expect(config.storage.fileHistory.enabled).toBe(true);
      expect(config.sources.global).toBeNull();
      expect(config.sources.project).toBeNull();
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
      });

      expect(config.log.level).toBe(LogLevel.DEBUG);
      expect(config.log.format).toBe('json');
      expect(config.agent.defaultModel).toBe('gpt-5.3');
      expect(config.log.console).toBe(true);
      expect(config.agent.maxSteps).toBe(50);
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
          RENX_LOG_LEVEL: 'FATAL',
          RENX_DEFAULT_MODEL: 'qwen3.5-max',
          RENX_CONFIRMATION_MODE: 'confirm',
        },
      });

      expect(config.log.level).toBe(LogLevel.FATAL);
      expect(config.agent.defaultModel).toBe('qwen3.5-max');
      expect(config.agent.confirmationMode).toBe('confirm');
    });

    it('should support legacy AGENT_* env vars', () => {
      const config = loadConfig({
        projectRoot: tmpDir,
        globalDir,
        env: {
          AGENT_LOG_LEVEL: 'WARN',
          AGENT_LOG_FORMAT: 'json',
          AGENT_TOOL_CONFIRMATION_MODE: 'confirm',
        },
      });

      expect(config.log.level).toBe(LogLevel.WARN);
      expect(config.log.format).toBe('json');
      expect(config.agent.confirmationMode).toBe('confirm');
    });

    it('should prefer RENX_* over AGENT_* env vars', () => {
      const config = loadConfig({
        projectRoot: tmpDir,
        globalDir,
        env: {
          RENX_LOG_LEVEL: 'DEBUG',
          AGENT_LOG_LEVEL: 'ERROR',
        },
      });

      expect(config.log.level).toBe(LogLevel.DEBUG);
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

      fs.rmSync(path.dirname(configPath), { recursive: true, force: true });
    });
  });

  describe('ensureConfigDirs', () => {
    it('should create config directories', () => {
      ensureConfigDirs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, '.renx'))).toBe(true);
      expect(fs.existsSync(path.join(os.homedir(), '.renx'))).toBe(true);
    });
  });

  describe('resolved paths', () => {
    it('should resolve relative paths from project root', () => {
      const config = loadConfig({
        projectRoot: tmpDir,
        globalDir,
        loadEnv: false,
      });

      expect(path.isAbsolute(config.log.dir)).toBe(true);
      expect(path.isAbsolute(config.log.filePath)).toBe(true);
      expect(path.isAbsolute(config.storage.root)).toBe(true);
      expect(path.isAbsolute(config.db.path)).toBe(true);
      expect(config.log.dir).toBe(path.join(tmpDir, 'logs'));
      // 日志文件名自动生成，格式: YYYY-MM-DDTHH-MM-SS.log
      expect(config.log.filePath).toMatch(
        new RegExp(`^${tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/logs/\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.log$`)
      );
    });
  });
});
