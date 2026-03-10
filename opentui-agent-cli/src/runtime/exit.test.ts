import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import type { CliRenderer } from '@opentui/core';

// 导入被测试模块
import {
  registerTerminalBackgroundRestore,
  hardResetTerminal,
  initExitRuntime,
  requestExit,
  bindExitGuards,
} from './exit';

// 模拟process对象
const originalProcess = global.process;
const mockProcess = {
  ...originalProcess,
  stdout: {
    ...originalProcess.stdout,
    isTTY: true,
    write: mock(() => {}),
  },
  stdin: {
    ...originalProcess.stdin,
    isTTY: true,
    setRawMode: mock(() => {}),
  },
  on: mock(() => {}),
  once: mock(() => {}),
  exit: mock(() => {}),
};

// 模拟console.error
const originalConsoleError = console.error;
const mockConsoleError = mock(() => {});

describe('exit module', () => {
  beforeEach(() => {
    // 重置模拟
    mockProcess.stdout.write.mockClear();
    mockProcess.stdin.setRawMode.mockClear();
    mockProcess.on.mockClear();
    mockProcess.once.mockClear();
    mockProcess.exit.mockClear();
    mockConsoleError.mockClear();

    // 替换全局对象
    global.process = mockProcess as any;
    console.error = mockConsoleError as any;
  });

  afterEach(() => {
    // 恢复全局对象
    global.process = originalProcess;
    console.error = originalConsoleError;
  });

  describe('registerTerminalBackgroundRestore', () => {
    it('should register restore function', () => {
      const restoreFn = () => {};
      registerTerminalBackgroundRestore(restoreFn);
      // 函数内部没有返回值，只能测试它不抛出错误
      expect(() => registerTerminalBackgroundRestore(restoreFn)).not.toThrow();
    });

    it('should allow null restore function', () => {
      expect(() => registerTerminalBackgroundRestore(null)).not.toThrow();
    });
  });

  describe('hardResetTerminal', () => {
    it('should reset terminal when stdout is TTY', () => {
      hardResetTerminal();

      expect(mockProcess.stdout.write).toHaveBeenCalled();
      expect(mockProcess.stdin.setRawMode).toHaveBeenCalledWith(false);
    });

    it('should not reset terminal when stdout is not TTY', () => {
      mockProcess.stdout.isTTY = false;
      mockProcess.stdin.isTTY = false;

      hardResetTerminal();

      expect(mockProcess.stdout.write).not.toHaveBeenCalled();
      expect(mockProcess.stdin.setRawMode).not.toHaveBeenCalled();
    });

    it('should call registered restore function', () => {
      const restoreFn = mock(() => {});
      registerTerminalBackgroundRestore(restoreFn);

      hardResetTerminal();

      expect(restoreFn).toHaveBeenCalled();
    });

    it('should handle errors gracefully', () => {
      mockProcess.stdout.write.mockImplementation(() => {
        throw new Error('Write error');
      });

      // 不应该抛出错误
      expect(() => hardResetTerminal()).not.toThrow();
    });
  });

  describe('initExitRuntime', () => {
    it('should store renderer reference', () => {
      const mockRenderer = {} as CliRenderer;
      initExitRuntime(mockRenderer);

      // 函数内部只是存储引用，没有返回值
      expect(() => initExitRuntime(mockRenderer)).not.toThrow();
    });
  });

  describe('requestExit', () => {
    it('should exit with default code 0', () => {
      const mockRenderer = {
        useMouse: false,
        setTerminalTitle: mock(() => {}),
        disableKittyKeyboard: mock(() => {}),
        destroy: mock(() => {}),
      } as any;

      initExitRuntime(mockRenderer);
      requestExit();

      expect(mockRenderer.destroy).toHaveBeenCalled();
      expect(mockProcess.exit).toHaveBeenCalledWith(0);
    });

    it('should exit with specified code', () => {
      requestExit(1);
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
    });

    it('should not exit twice if already cleaned up', () => {
      // 第一次调用
      requestExit(0);
      expect(mockProcess.exit).toHaveBeenCalledTimes(1);

      // 重置模拟
      mockProcess.exit.mockClear();

      // 第二次调用，应该已经清理过了
      requestExit(0);
      expect(mockProcess.exit).not.toHaveBeenCalled();
    });

    it('should handle missing renderer gracefully', () => {
      initExitRuntime(null as any);
      expect(() => requestExit(0)).not.toThrow();
    });

    it('should handle renderer errors gracefully', () => {
      const mockRenderer = {
        useMouse: false,
        setTerminalTitle: mock(() => {
          throw new Error('Title error');
        }),
        disableKittyKeyboard: mock(() => {
          throw new Error('Keyboard error');
        }),
        destroy: mock(() => {
          throw new Error('Destroy error');
        }),
      } as any;

      initExitRuntime(mockRenderer);

      // 不应该抛出错误
      expect(() => requestExit(0)).not.toThrow();
      expect(mockProcess.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('bindExitGuards', () => {
    it('should bind exit handlers', () => {
      bindExitGuards();

      expect(mockProcess.once).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(mockProcess.once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(mockProcess.once).toHaveBeenCalledWith('exit', expect.any(Function));
    });
  });
});
