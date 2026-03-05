/**
 * 文件后端路由器实现
 */

import type { ExecutionTarget } from './types';
import type { FileAccessRequest, FileBackend, FileBackendRouter } from './file';

export interface StaticFileBackendRouterOptions {
  defaultTarget?: ExecutionTarget;
  backends?: FileBackend[];
}

/**
 * 静态文件后端路由器
 */
export class StaticFileBackendRouter implements FileBackendRouter {
  private readonly backendsByTarget = new Map<ExecutionTarget, FileBackend[]>();
  private readonly defaultTarget: ExecutionTarget;

  constructor(options: StaticFileBackendRouterOptions = {}) {
    this.defaultTarget = options.defaultTarget ?? 'local';
    for (const backend of options.backends ?? []) {
      this.register(backend);
    }
  }

  register(backend: FileBackend): void {
    const list = this.backendsByTarget.get(backend.target) ?? [];
    list.push(backend);
    this.backendsByTarget.set(backend.target, list);
  }

  route(request: FileAccessRequest): FileBackend {
    const target = request.target ?? this.defaultTarget;
    const backends = this.backendsByTarget.get(target) ?? [];
    if (backends.length === 0) {
      throw new Error(`No file backend registered for target "${target}"`);
    }

    const backend = backends.find((candidate) => candidate.canAccess(request.path));
    if (!backend) {
      throw new Error(`No compatible file backend found for target "${target}"`);
    }

    return backend;
  }
}
