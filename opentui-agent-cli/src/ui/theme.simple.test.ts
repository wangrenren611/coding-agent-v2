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
    
    expect(uiTheme.bg).toBe('#0a0a0a');
    expect(uiTheme.surface).toBe('#141414');
    expect(uiTheme.text).toBe('#eeeeee');
    expect(uiTheme.accent).toBe('#fab283');
  });

  it('should switch to light theme', () => {
    applyUiThemeMode('light');
    
    expect(uiTheme.bg).toBe('#eceff3');
    expect(uiTheme.surface).toBe('#ffffff');
    expect(uiTheme.text).toBe('#1f2530');
    expect(uiTheme.accent).toBe('#0b67d7');
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