/**
 * 配置加载器
 *
 * 支持从文件或环境变量加载模型配置
 */

import type { ModelId } from '../types';
import fs from 'node:fs';
import { MODEL_DEFINITIONS } from './model-config';

/**
 * 模型配置文件格式
 */
export interface ModelConfigFile {
  models: Record<string, Omit<(typeof MODEL_DEFINITIONS)[ModelId], 'apiKey'>>;
}

/**
 * 从文件加载配置
 *
 * @param path 配置文件路径
 * @returns 模型配置映射
 */
export function loadConfigFromFile(
  path: string
): Record<string, Omit<(typeof MODEL_DEFINITIONS)[ModelId], 'apiKey'>> {
  const content = fs.readFileSync(path, 'utf-8');
  const parsed = JSON.parse(content) as ModelConfigFile;
  return parsed.models;
}

/**
 * 从环境变量加载配置
 *
 * @returns 默认的模型配置
 */
export function loadConfigFromEnv(): typeof MODEL_DEFINITIONS {
  return MODEL_DEFINITIONS;
}
