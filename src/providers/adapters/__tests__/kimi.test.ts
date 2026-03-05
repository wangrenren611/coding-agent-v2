/**
 * Kimi Headers 测试用例
 *
 * 验证 Kimi API 请求头的正确性
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KimiAdapter } from '../kimi';
import { getKimiHeaders, getCommonHeaders, getUserAgent } from '../../kimi-headers';

describe('KimiAdapter 请求头测试', () => {
  let adapter: KimiAdapter;

  beforeEach(() => {
    adapter = new KimiAdapter();
  });

  it('应该在请求头中添加完整的 Kimi 平台标识', () => {
    const headers = adapter.getHeaders('test-api-key');

    // 核心认证头
    expect(headers.get('Authorization')).toBe('Bearer test-api-key');
    expect(headers.get('Content-Type')).toBe('application/json');

    // Kimi 平台标识头
    expect(headers.get('X-Msh-Platform')).toBe('kimi_cli');
    expect(headers.get('X-Msh-Version')).toMatch(/^\d+\.\d+\.\d+$/);
    expect(headers.get('X-Msh-Device-Name')).toBeTruthy();
    expect(headers.get('X-Msh-Device-Model')).toBeTruthy();
    expect(headers.get('X-Msh-Os-Version')).toBeTruthy();
    expect(headers.get('X-Msh-Device-Id')).toMatch(/^[a-f0-9]{32}$/i);
    expect(headers.get('User-Agent')).toBe(`KimiCLI/1.0.0`);
  });
});

describe('kimi-headers 模块测试', () => {
  it('getCommonHeaders 应该返回正确的平台标识', () => {
    const headers = getCommonHeaders();

    expect(headers['X-Msh-Platform']).toBe('kimi_cli');
    expect(headers['X-Msh-Version']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(headers['X-Msh-Device-Name']).toBeTruthy();
    expect(headers['X-Msh-Device-Model']).toBeTruthy();
    expect(headers['X-Msh-Os-Version']).toBeTruthy();
    expect(headers['X-Msh-Device-Id']).toMatch(/^[a-f0-9]{32}$/i);
  });

  it('getUserAgent 应该返回正确的 User-Agent', () => {
    expect(getUserAgent()).toBe('KimiCLI/1.0.0');
  });

  it('getKimiHeaders 应该合并所有请求头', () => {
    const headers = getKimiHeaders();

    expect(headers['X-Msh-Platform']).toBe('kimi_cli');
    expect(headers['User-Agent']).toBe(`KimiCLI/1.0.0`);
  });
});
