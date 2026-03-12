import { describe, expect, it } from 'bun:test';

import { applyUiThemeMode, uiTheme } from './theme';

describe('theme module', () => {
  it('should have required properties', () => {
    expect(uiTheme).toBeDefined();
    expect(typeof uiTheme).toBe('object');

    // 检查关键属性
    expect(uiTheme.bg).toBeString();
    expect(uiTheme.surface).toBeString();
    expect(uiTheme.text).toBeString();
    expect(uiTheme.accent).toBeString();
    expect(uiTheme.layout).toBeObject();
    expect(uiTheme.typography).toBeObject();
  });

  it('should switch to dark theme', () => {
    applyUiThemeMode('dark');

    expect(uiTheme.bg).toBe('#09090b');
    expect(uiTheme.surface).toBe('#18181b');
    expect(uiTheme.text).toBe('#fafafa');
    expect(uiTheme.accent).toBe('#8e51ff');
  });

  it('should switch to light theme', () => {
    applyUiThemeMode('light');

    expect(uiTheme.bg).toBe('#ffffff');
    expect(uiTheme.surface).toBe('#ffffff');
    expect(uiTheme.text).toBe('#09090b');
    expect(uiTheme.accent).toBe('#7f22fe');
  });

  it('should create independent theme objects', () => {
    // 应用暗色主题
    applyUiThemeMode('dark');
    const darkThemeBg = uiTheme.bg;
    const darkThemeText = uiTheme.text;

    // 应用亮色主题
    applyUiThemeMode('light');
    const lightThemeBg = uiTheme.bg;
    const lightThemeText = uiTheme.text;

    // 颜色值应该不同
    expect(darkThemeBg).not.toBe(lightThemeBg);
    expect(darkThemeText).not.toBe(lightThemeText);
  });
});
