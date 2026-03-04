/**
 * Logger 模块
 *
 * 简洁实用的日志系统
 *
 * @example
 * ```typescript
 * import { createLogger, LogLevel, contextManager } from './logger';
 *
 * // 创建日志器
 * const logger = createLogger({
 *   service: 'my-app',
 *   level: LogLevel.DEBUG,
 *   console: { colorize: true },
 *   file: { enabled: true, filepath: './logs/app.log' }
 * });
 *
 * // 基础日志
 * logger.info('Application started');
 * logger.debug('Request data', { requestId: '123' }, { body: request.body });
 * logger.error('Something went wrong', new Error('Oops'));
 *
 * // 子日志器
 * const moduleLogger = logger.child('MyModule');
 * moduleLogger.info('Processing...');
 *
 * // 异步上下文
 * contextManager.run({ requestId: '123' }, () => {
 *   logger.info('This will include requestId');
 * });
 * ```
 */

// 类型导出
export type {
  LoggerConfig,
  LogRecord,
  LogLevel as LogLevelType,
  LogContext,
  LogError,
  LogMiddleware,
  ITransport,
  LogCallback,
  ConsoleConfig,
  FileConfig,
} from './types';
export { LogLevel, LogLevelName } from './types';

// 核心类
export {
  Logger,
  ChildLogger,
  createLogger,
  getLogger,
  setDefaultLogger,
  contextManager,
} from './logger';
