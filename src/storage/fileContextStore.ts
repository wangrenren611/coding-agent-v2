/**
 * 文件上下文存储实现
 */

import type { ContextData } from './types';
import type { IContextStorage } from './interfaces';
import { BaseFileStore } from './base';

/**
 * 文件上下文存储
 */
export class FileContextStorage extends BaseFileStore<ContextData> implements IContextStorage {
  constructor(basePath: string, io?: import('./atomic-json').AtomicJsonStore) {
    super({ basePath, subDir: 'contexts', io });
  }

  protected transformData(sessionId: string, data: ContextData): ContextData {
    return { ...data, sessionId };
  }
}
