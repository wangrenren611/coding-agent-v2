/**
 * 文件历史存储实现
 */

import type { HistoryMessage } from './types';
import type { IHistoryStorage } from './interfaces';
import { BaseArrayFileStore } from './base';

/**
 * 文件历史存储
 */
export class FileHistoryStore
  extends BaseArrayFileStore<HistoryMessage>
  implements IHistoryStorage
{
  constructor(basePath: string, io?: import('./atomic-json').AtomicJsonStore) {
    super({ basePath, subDir: 'histories', io });
  }
}
