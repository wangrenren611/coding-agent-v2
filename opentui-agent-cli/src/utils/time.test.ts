import { describe, expect, it } from 'vitest';

import { createTimeLabel } from './time';

class MockDate extends Date {
  constructor(private readonly value: Date) {
    super(value.getTime());
  }

  override toLocaleTimeString(
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions
  ): string {
    return this.value.toLocaleTimeString(locales, options);
  }
}

describe('createTimeLabel', () => {
  it('should return time in HH:MM:SS format', () => {
    // 模拟一个固定的日期来测试格式
    const mockDate = new Date('2024-01-15T14:30:45Z');
    const originalDate = global.Date;

    // 临时替换Date构造函数
    global.Date = class extends originalDate {
      constructor() {
        super();
        return new MockDate(mockDate);
      }

      static override now() {
        return mockDate.getTime();
      }
    } as unknown as DateConstructor;

    try {
      const timeLabel = createTimeLabel();
      // 24小时格式，前导零
      expect(timeLabel).toBe('14:30:45');
    } finally {
      // 恢复原始的Date
      global.Date = originalDate;
    }
  });

  it('should use 24-hour format', () => {
    // 测试下午时间
    const mockDate = new Date('2024-01-15T22:15:30Z');
    const originalDate = global.Date;

    global.Date = class extends originalDate {
      constructor() {
        super();
        return new MockDate(mockDate);
      }

      static override now() {
        return mockDate.getTime();
      }
    } as unknown as DateConstructor;

    try {
      const timeLabel = createTimeLabel();
      // 应该是22:15:30，不是10:15:30 PM
      expect(timeLabel).toBe('22:15:30');
    } finally {
      global.Date = originalDate;
    }
  });

  it('should pad single-digit hours, minutes, and seconds', () => {
    // 测试单数字时间
    const mockDate = new Date('2024-01-15T09:05:07Z');
    const originalDate = global.Date;

    global.Date = class extends originalDate {
      constructor() {
        super();
        return new MockDate(mockDate);
      }

      static override now() {
        return mockDate.getTime();
      }
    } as unknown as DateConstructor;

    try {
      const timeLabel = createTimeLabel();
      // 应该是09:05:07，不是9:5:7
      expect(timeLabel).toBe('09:05:07');
    } finally {
      global.Date = originalDate;
    }
  });

  it('should use en-US locale', () => {
    // 保存原始locale
    const originalToLocaleTimeString = Date.prototype.toLocaleTimeString;

    let calledWithLocale = '';
    Date.prototype.toLocaleTimeString = function (
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions
    ): string {
      calledWithLocale = Array.isArray(locales) ? (locales[0] ?? '') : (locales ?? '');
      return originalToLocaleTimeString.call(this, locales, options);
    };

    try {
      createTimeLabel();
      expect(calledWithLocale).toBe('en-US');
    } finally {
      // 恢复原始方法
      Date.prototype.toLocaleTimeString = originalToLocaleTimeString;
    }
  });

  it('should use correct options', () => {
    // 保存原始方法
    const originalToLocaleTimeString = Date.prototype.toLocaleTimeString;

    let calledWithOptions: Intl.DateTimeFormatOptions = {};
    Date.prototype.toLocaleTimeString = function (
      _locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions
    ): string {
      calledWithOptions = options ?? {};
      return '00:00:00'; // 返回模拟值
    };

    try {
      createTimeLabel();
      expect(calledWithOptions).toEqual({
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } finally {
      // 恢复原始方法
      Date.prototype.toLocaleTimeString = originalToLocaleTimeString;
    }
  });
});
