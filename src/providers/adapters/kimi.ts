import { StandardAdapter } from './standard';
import type { LLMRequest } from '../types';
import { getKimiHeaders } from '../kimi-headers';

/**
 * Kimi API 适配器
 *
 * 支持 Kimi 特有的功能：
 * - thinking 模式（思维链）
 * - X-Msh-* 请求头标识（平台、设备信息等）
 */
export class KimiAdapter extends StandardAdapter {
  constructor(options: { endpointPath?: string; defaultModel?: string } = {}) {
    super(options);
  }

  transformRequest(options?: LLMRequest): Record<string, unknown> {
    return {
      ...super.transformRequest(options),
      thinking: {
        type: options?.thinking ? 'enabled' : 'disabled',
      },
    };
  }

  /**
   * 获取请求头，添加 Kimi 平台标识
   *
   * 包含：
   * - X-Msh-Platform: kimi_cli
   * - X-Msh-Version: 客户端版本
   * - X-Msh-Device-Name: 设备名称
   * - X-Msh-Device-Model: 设备型号
   * - X-Msh-Os-Version: 系统版本
   * - X-Msh-Device-Id: 设备唯一 ID
   * - User-Agent: kimi-cli/版本号
   */
  getHeaders(apiKey: string): Headers {
    const headers = super.getHeaders(apiKey);
    const kimiHeaders = getKimiHeaders();

    for (const [key, value] of Object.entries(kimiHeaders)) {
      headers.set(key, value);
    }

    return headers;
  }
}
