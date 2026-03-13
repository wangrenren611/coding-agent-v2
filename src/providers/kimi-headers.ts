/**
 * 平台信息工具
 *
 * 用于获取客户端平台信息，生成请求头标识
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

// 从 package.json 读取版本号
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const PACKAGE_VERSION = (() => {
  try {
    // ESM 环境获取 package.json 路径
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = path.resolve(currentDir, '../../package.json');
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
})();

/**
 * 获取设备唯一 ID
 *
 * 优先从缓存文件读取，不存在则生成新的并保存
 */
function getDeviceId(): string {
  const cacheDir = path.join(os.homedir(), '.renx');
  const deviceIdPath = path.join(cacheDir, 'device_id');

  try {
    // 尝试读取已存在的设备 ID
    if (fs.existsSync(deviceIdPath)) {
      const id = fs.readFileSync(deviceIdPath, 'utf-8').trim();
      if (id && /^[a-f0-9]{32}$/i.test(id)) {
        return id;
      }
    }

    // 生成新的设备 ID
    const id = createHash('md5')
      .update(`${os.hostname()}-${os.userInfo().username}-${Date.now()}-${Math.random()}`)
      .digest('hex');

    // 确保目录存在
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // 保存设备 ID（权限 600）
    fs.writeFileSync(deviceIdPath, id, { mode: 0o600 });
    return id;
  } catch {
    // 生成临时 ID（不持久化）
    return createHash('md5').update(`${os.hostname()}-${os.userInfo().username}`).digest('hex');
  }
}

/**
 * 获取设备型号
 */
function getDeviceModel(): string {
  const platform = os.platform();
  const arch = os.arch();
  const release = os.release();

  switch (platform) {
    case 'darwin': {
      const version = release.split('.')[0];
      const macVersion = getMacOSVersion(version);
      return `macOS ${macVersion} ${arch}`;
    }
    case 'win32': {
      const releaseNum = os.release();
      let windowsVersion = releaseNum;
      // Windows 10 build >= 22000 是 Windows 11
      try {
        const build = parseInt(releaseNum.split('.')[2] || '0', 10);
        if (build >= 22000) {
          windowsVersion = '11';
        } else {
          windowsVersion = '10';
        }
      } catch {
        // 忽略解析错误
      }
      return `Windows ${windowsVersion} ${arch}`;
    }
    case 'linux': {
      return `Linux ${release} ${arch}`;
    }
    default:
      return `${platform} ${release} ${arch}`;
  }
}

/**
 * 获取 macOS 版本号
 */
function getMacOSVersion(darwinVersion: string): string {
  const major = parseInt(darwinVersion, 10);
  // Darwin 版本到 macOS 版本的映射
  const versionMap: Record<number, string> = {
    23: '14.0', // Sonoma
    22: '13.0', // Ventura
    21: '12.0', // Monterey
    20: '11.0', // Big Sur
  };
  return versionMap[major] || `${major}.0`;
}

/**
 * ASCII 化头部值（移除非 ASCII 字符）
 */
function asciiHeaderValue(value: string, fallback = 'unknown'): string {
  try {
    // 检查是否为纯 ASCII
    if (/^[\x20-\x7E]*$/.test(value)) {
      return value;
    }
    // 移除非 ASCII 字符
    const sanitized = value.replace(/[^\x20-\x7E]/g, '').trim();
    return sanitized || fallback;
  } catch {
    return fallback;
  }
}

// 缓存设备 ID（避免重复 I/O）
let cachedDeviceId: string | null = null;

/**
 * 获取公共请求头
 *
 * 用于 Kimi API 请求的客户端标识
 */
export function getCommonHeaders(): Record<string, string> {
  const deviceId = cachedDeviceId || (cachedDeviceId = getDeviceId());
  const deviceName = os.hostname() || 'unknown';
  const deviceModel = getDeviceModel();
  const osVersion = os.release();
  const version = PACKAGE_VERSION;

  return {
    'X-Msh-Platform': 'kimi_cli',
    'X-Msh-Version': asciiHeaderValue(version),
    'X-Msh-Device-Name': asciiHeaderValue(deviceName),
    'X-Msh-Device-Model': asciiHeaderValue(deviceModel),
    'X-Msh-Os-Version': asciiHeaderValue(osVersion),
    'X-Msh-Device-Id': deviceId,
  };
}

/**
 * 获取 User-Agent
 */
export function getUserAgent(): string {
  // return 'claude-cli/2.1.19 (external, cli)';
  return `KimiCLI/${PACKAGE_VERSION}`;
}

/**
 * 获取完整的 Kimi 请求头
 */
export function getKimiHeaders(): Record<string, string> {
  return {
    ...getCommonHeaders(),
    'User-Agent': getUserAgent(),
  };
}
