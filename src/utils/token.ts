/**
 * Token 估算工具
 */

/**
 * 估算文本 Token 数
 *
 * 算法说明：
 * - 中文字符（Unicode \u4e00-\u9fa5）：1 字符 ≈ 1.5 token
 * - 其他字符（英文、数字、符号等）：1 字符 ≈ 0.25 token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let cnCount = 0;
  let otherCount = 0;

  for (const char of text) {
    if (char >= '\u4e00' && char <= '\u9fa5') {
      cnCount++;
    } else {
      otherCount++;
    }
  }

  const totalTokens = cnCount * 1.5 + otherCount * 0.25;
  return Math.ceil(totalTokens);
}
