/**
 * 文件名编解码工具
 *
 * 安全地将 sessionId 等字符串编码为文件名
 */

// =============================================================================
// 编码字符映射表
// =============================================================================

/**
 * 需要转义的字符及其转义序列
 */
const ENCODE_MAP: Record<string, string> = {
  '/': '!s!',
  '\\': '!b!',
  ':': '!c!',
  '*': '!a!',
  '?': '!q!',
  '"': '!d!',
  '<': '!l!',
  '>': '!g!',
  '|': '!p!',
  '!': '!!',
  '\0': '!n!',
};

/**
 * 解码映射表（反向）
 */
const DECODE_MAP: Record<string, string> = {};
for (const [char, esc] of Object.entries(ENCODE_MAP)) {
  DECODE_MAP[esc] = char;
}

// =============================================================================
// 编解码函数
// =============================================================================

/**
 * 将字符串编码为安全的文件名
 *
 * @param raw 原始字符串
 * @returns 编码后的文件名
 */
export function encodeEntityFileName(raw: string): string {
  let result = '';
  for (const char of raw) {
    result += ENCODE_MAP[char] ?? char;
  }
  return `${result}.json`;
}

/**
 * 从文件名解码原始字符串
 *
 * @param fileName 编码后的文件名
 * @returns 原始字符串，解码失败返回 null
 */
export function safeDecodeEntityFileName(fileName: string): string | null {
  // 移除 .json 后缀
  const raw = fileName.endsWith('.json') ? fileName.slice(0, -5) : fileName;

  let result = '';
  let i = 0;

  while (i < raw.length) {
    if (raw[i] === '!') {
      // 尝试匹配转义序列
      let matched = false;
      for (const [esc, char] of Object.entries(DECODE_MAP)) {
        if (raw.startsWith(esc, i)) {
          result += char;
          i += esc.length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // 无效的转义序列
        return null;
      }
    } else {
      result += raw[i];
      i += 1;
    }
  }

  return result;
}
