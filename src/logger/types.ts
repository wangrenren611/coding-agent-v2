/**
 * Logger 类型定义
 */

/**
 * 日志级别
 */
export enum LogLevel {
  TRACE = 0,
  DEBUG = 10,
  INFO = 20,
  WARN = 30,
  ERROR = 40,
  FATAL = 50,
}

/**
 * 日志级别名称映射
 */
export const LogLevelName: Record<LogLevel, string> = {
  [LogLevel.TRACE]: 'TRACE',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
};

/**
 * 日志上下文
 */
export interface LogContext {
  [key: string]: unknown;
}

/**
 * 错误信息结构
 */
export interface LogError {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
}

/**
 * 日志记录
 */
export interface LogRecord {
  /** 时间戳 ISO 8601 */
  timestamp: string;
  /** 日志级别 */
  level: LogLevel;
  /** 日志级别名称 */
  levelName: string;
  /** 日志消息 */
  message: string;
  /** 上下文 */
  context: LogContext;
  /** 错误信息 */
  error?: LogError;
  /** 任意数据（支持任意类型） */
  data?: unknown;
  /** 模块名 */
  module?: string;
}

/**
 * 文件输出配置
 */
export interface FileConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 文件路径 */
  filepath: string;
  /** 日志级别（可选，默认使用全局级别） */
  level?: LogLevel;
  /** 输出格式 */
  format?: 'json' | 'pretty';
  /** 日志轮转最大文件大小（字节） */
  maxSize?: number;
  /** 日志轮转最大文件数 */
  maxFiles?: number;
}

/**
 * 控制台输出配置
 */
export interface ConsoleConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 日志级别（可选，默认使用全局级别） */
  level?: LogLevel;
  /** 输出格式 */
  format?: 'json' | 'pretty';
  /** 是否彩色输出 */
  colorize?: boolean;
}

/**
 * Transport 接口
 *
 * 实现此接口以支持自定义日志输出目标（如数据库、远程服务等）
 */
export interface ITransport {
  /** Transport 名称（用于调试） */
  readonly name?: string;
  /**
   * 写入日志记录
   * @param record 日志记录（已脱敏）
   * @param globalLevel 全局日志级别
   */
  write(record: LogRecord, globalLevel: LogLevel): void | Promise<void>;
  /** 关闭 Transport（可选） */
  close?(): void | Promise<void>;
}

/**
 * 日志回调函数
 */
export type LogCallback = (record: LogRecord) => void | Promise<void>;

/**
 * Logger 配置
 */
export interface LoggerConfig {
  /** 服务名称 */
  service: string;
  /** 环境 */
  env?: 'development' | 'production' | 'test';
  /** 全局最小日志级别 */
  level?: LogLevel;
  /** 默认上下文 */
  defaultContext?: LogContext;
  /** 控制台配置 */
  console?: ConsoleConfig;
  /** 文件配置 */
  file?: FileConfig;
  /** 敏感字段列表（会被脱敏） */
  sensitiveFields?: string[];
  /** 自定义 Transport 列表（如数据库存储） */
  transports?: ITransport[];
  /** 日志回调（每条日志都会调用） */
  onLog?: LogCallback;
}

/**
 * 中间件函数类型
 */
export type LogMiddleware = (record: LogRecord, next: () => void) => void;
