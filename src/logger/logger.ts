/**
 * Logger 核心实现
 *
 * 简洁实用的日志系统，支持：
 * - 多级别日志 (TRACE ~ FATAL)
 * - 多输出目标 (Console, File)
 * - 结构化日志 (JSON/Pretty)
 * - 日志轮转
 * - 任意数据存储
 * - 敏感字段脱敏
 * - 异步上下文隔离
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  LoggerConfig,
  LogRecord,
  LogLevel,
  LogContext,
  LogError,
  LogMiddleware,
  FileConfig,
  ConsoleConfig,
  ITransport,
  LogCallback,
} from './types';
import { LogLevel as Lvl, LogLevelName } from './types';

// =============================================================================
// 默认配置
// =============================================================================

const DEFAULT_SENSITIVE_FIELDS = [
  'apiKey',
  'api_key',
  'password',
  'token',
  'secret',
  'authorization',
  'credential',
];

const DEFAULT_CONFIG: Required<Omit<LoggerConfig, 'defaultContext'>> & {
  defaultContext: LogContext;
} = {
  service: 'app',
  env: 'development',
  level: Lvl.INFO,
  defaultContext: {},
  console: {
    enabled: true,
    format: 'pretty',
    colorize: true,
  },
  file: {
    enabled: false,
    filepath: './logs/app.log',
    format: 'json',
    maxSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
  },
  sensitiveFields: DEFAULT_SENSITIVE_FIELDS,
  transports: [],
  onLog: undefined as unknown as LogCallback,
};

// =============================================================================
// 工具函数
// =============================================================================

/**
 * 安全序列化任意数据
 */
function safeStringify(data: unknown): string {
  return stringifyWithCircular(data);
}

/**
 * 带循环引用检测的序列化
 */
function stringifyWithCircular(data: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (data === null || data === undefined) {
    return JSON.stringify(data);
  }

  if (typeof data !== 'object') {
    try {
      return JSON.stringify(data);
    } catch {
      return JSON.stringify(String(data));
    }
  }

  // 处理特殊对象类型
  if (data instanceof Error) {
    return JSON.stringify({
      __type: 'Error',
      name: data.name,
      message: data.message,
      stack: data.stack,
    });
  }

  if (data instanceof Date) {
    return JSON.stringify(data.toISOString());
  }

  if (data instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of data) {
      obj[String(k)] = v;
    }
    return stringifyWithCircular(obj, seen);
  }

  if (data instanceof Set) {
    return stringifyWithCircular(Array.from(data), seen);
  }

  if (Buffer.isBuffer(data)) {
    return JSON.stringify(data.toString('base64'));
  }

  if (seen.has(data as object)) return '"[Circular]"';
  seen.add(data as object);

  if (Array.isArray(data)) {
    const items = data.map((item) => stringifyWithCircular(item, seen));
    return '[' + items.join(', ') + ']';
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(data as object)) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === 'object' && value !== null) {
      result[key] = JSON.parse(stringifyWithCircular(value, seen));
    } else {
      result[key] = value;
    }
  }

  try {
    return JSON.stringify(result);
  } catch {
    return '"[Non-serializable]"';
  }
}

/**
 * 脱敏对象
 */
function sanitize(
  obj: unknown,
  sensitiveFields: string[],
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (seen.has(obj as object)) return '[Circular]';
  seen.add(obj as object);

  // 处理特殊类型
  if (obj instanceof Error) {
    return {
      __type: 'Error',
      name: obj.name,
      message: obj.message,
      stack: obj.stack,
    };
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  if (obj instanceof Map) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of obj) {
      result[String(k)] = sanitize(v, sensitiveFields, seen);
    }
    return result;
  }

  if (obj instanceof Set) {
    return Array.from(obj).map((item) => sanitize(item, sensitiveFields, seen));
  }

  if (Buffer.isBuffer(obj)) {
    return obj.toString('base64');
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitize(item, sensitiveFields, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (sensitiveFields.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitize(value, sensitiveFields, seen);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// =============================================================================
// 格式化器
// =============================================================================

/** ANSI 颜色代码 */
const Colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bgRed: '\x1b[41m',
  white: '\x1b[37m',
};

const LevelColors: Record<LogLevel, string> = {
  [Lvl.TRACE]: Colors.dim,
  [Lvl.DEBUG]: Colors.cyan,
  [Lvl.INFO]: Colors.green,
  [Lvl.WARN]: Colors.yellow,
  [Lvl.ERROR]: Colors.red,
  [Lvl.FATAL]: Colors.bgRed + Colors.white,
};

/**
 * 格式化为 JSON
 */
function formatJson(record: LogRecord): string {
  const output: Record<string, unknown> = {
    '@timestamp': record.timestamp,
    '@level': record.levelName,
    '@message': record.message,
    '@context': record.context, // 始终包含上下文
  };

  if (record.module) output['@module'] = record.module;
  if (record.error) output['@error'] = record.error;
  if (record.data !== undefined) output['@data'] = record.data;

  return safeStringify(output);
}

/**
 * 格式化为可读文本
 */
function formatPretty(record: LogRecord, colorize: boolean): string {
  const color = (text: string, code: string) => (colorize ? `${code}${text}${Colors.reset}` : text);

  const parts: string[] = [];

  // 时间戳
  const date = new Date(record.timestamp);
  const time =
    date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) +
    '.' +
    String(date.getMilliseconds()).padStart(3, '0');
  parts.push(color(time, Colors.dim));

  // 级别
  const levelName = LogLevelName[record.level].padEnd(5);
  parts.push(color(levelName, LevelColors[record.level] + Colors.bold));

  // 模块
  if (record.module) {
    parts.push(color(`[${record.module}]`, Colors.cyan));
  }

  // 消息
  parts.push(record.message);

  // 上下文（最多5个字段）
  if (Object.keys(record.context).length > 0) {
    const pairs = Object.entries(record.context)
      .slice(0, 5)
      .map(([k, v]) => {
        const str = typeof v === 'object' ? safeStringify(v) : String(v);
        const truncated = str.length > 30 ? str.slice(0, 30) + '...' : str;
        return `${k}=${truncated}`;
      });
    parts.push(color(`(${pairs.join(', ')})`, Colors.dim));
  }

  let output = parts.join(' ');

  // 错误信息
  if (record.error) {
    output += '\n' + formatErrorDisplay(record.error, colorize);
  }

  // 数据
  if (record.data !== undefined) {
    output += '\n' + color(safeStringify(record.data), Colors.dim);
  }

  return output;
}

function formatErrorDisplay(error: LogError, colorize: boolean): string {
  const color = (text: string, code: string) => (colorize ? `${code}${text}${Colors.reset}` : text);
  const lines: string[] = [];

  lines.push(color('┌─ Error ─────────────────────────────', Colors.red));
  lines.push(color(`│ Type: ${error.name}`, Colors.red));
  lines.push(color(`│ Message: ${error.message}`, Colors.red));
  if (error.code) lines.push(color(`│ Code: ${error.code}`, Colors.red));
  if (error.stack) {
    lines.push(color('│ Stack:', Colors.red));
    for (const line of error.stack.split('\n').slice(0, 8)) {
      lines.push(color(`│   ${line}`, Colors.dim));
    }
  }
  lines.push(color('└──────────────────────────────────────', Colors.red));

  return lines.join('\n');
}

// =============================================================================
// 上下文管理器
// =============================================================================

class ContextManager {
  private static instance: ContextManager;
  private readonly storage = new AsyncLocalStorage<LogContext>();
  private fallback: LogContext = {};

  static getInstance(): ContextManager {
    if (!ContextManager.instance) {
      ContextManager.instance = new ContextManager();
    }
    return ContextManager.instance;
  }

  get(): LogContext {
    return this.storage.getStore() ?? this.fallback;
  }

  set(context: LogContext): void {
    this.fallback = context;
    this.storage.enterWith(context);
  }

  update(context: Partial<LogContext>): void {
    const next = { ...this.get(), ...context };
    this.fallback = next;
    this.storage.enterWith(next);
  }

  clear(): void {
    this.fallback = {};
    this.storage.enterWith({});
  }

  run<T>(context: LogContext, fn: () => T): T {
    return this.storage.run({ ...this.get(), ...context }, fn);
  }
}

export const contextManager = ContextManager.getInstance();

// =============================================================================
// Transport 实现
// =============================================================================

/**
 * 控制台输出
 */
class ConsoleTransport implements ITransport {
  readonly name = 'console';
  private config: {
    enabled: boolean;
    format: 'json' | 'pretty';
    colorize: boolean;
    level?: LogLevel;
  };

  constructor(config: ConsoleConfig) {
    this.config = {
      format: 'pretty',
      colorize: true,
      ...config,
      enabled: config.enabled ?? true,
    };
  }

  write(record: LogRecord, globalLevel: LogLevel): void {
    if (!this.config.enabled) return;
    if (record.level < (this.config.level ?? globalLevel)) return;

    const formatted =
      this.config.format === 'json'
        ? formatJson(record)
        : formatPretty(record, this.config.colorize);

    // ERROR/FATAL 输出到 stderr
    const stream = record.level >= Lvl.ERROR ? process.stderr : process.stdout;
    stream.write(formatted + '\n');
  }
}

/**
 * 文件输出（支持日志轮转）
 */
class FileTransport implements ITransport {
  readonly name = 'file';
  private config: {
    enabled: boolean;
    filepath: string;
    format: 'json' | 'pretty';
    level?: LogLevel;
    maxSize: number;
    maxFiles: number;
  };
  private stream: fs.WriteStream | null = null;
  private currentSize = 0;

  constructor(config: FileConfig) {
    this.config = {
      format: 'json',
      maxSize: 10 * 1024 * 1024,
      maxFiles: 5,
      ...config,
      enabled: config.enabled ?? false,
      filepath: config.filepath ?? './logs/app.log',
    };

    if (this.config.enabled) {
      this.initStream();
    }
  }

  private initStream(): void {
    const dir = path.dirname(this.config.filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.stream = fs.createWriteStream(this.config.filepath, { flags: 'a', encoding: 'utf8' });

    try {
      this.currentSize = fs.statSync(this.config.filepath).size;
    } catch {
      this.currentSize = 0;
    }

    this.stream.on('error', (err) => {
      console.error(`[Logger] File transport error: ${err.message}`);
    });
  }

  write(record: LogRecord, globalLevel: LogLevel): void {
    if (!this.config.enabled || !this.stream) return;
    if (record.level < (this.config.level ?? globalLevel)) return;

    const formatted =
      this.config.format === 'pretty' ? formatPretty(record, false) : formatJson(record);

    const content = formatted + '\n';
    this.stream.write(content);
    this.currentSize += Buffer.byteLength(content, 'utf8');

    this.checkRotation();
  }

  private checkRotation(): void {
    if (this.currentSize < this.config.maxSize) return;

    // 关闭当前流
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }

    const dir = path.dirname(this.config.filepath);
    const ext = path.extname(this.config.filepath);
    const base = path.basename(this.config.filepath, ext);

    // 轮转文件
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldFile = path.join(dir, `${base}.${i}${ext}`);
      const newFile = path.join(dir, `${base}.${i + 1}${ext}`);
      try {
        if (fs.existsSync(oldFile)) {
          if (i === this.config.maxFiles - 1) {
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      } catch (err) {
        console.error(`[Logger] Rotation error: ${(err as Error).message}`);
      }
    }

    // 重命名当前文件
    try {
      fs.renameSync(this.config.filepath, path.join(dir, `${base}.1${ext}`));
    } catch (err) {
      console.error(`[Logger] Rename error: ${(err as Error).message}`);
    }

    this.initStream();
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

// =============================================================================
// Logger 类
// =============================================================================

/**
 * 日志器类
 */
export class Logger {
  private config: Required<Omit<LoggerConfig, 'defaultContext' | 'transports' | 'onLog'>> & {
    defaultContext: LogContext;
    transports?: ITransport[];
    onLog?: LogCallback;
  };
  private middlewares: LogMiddleware[] = [];
  private consoleTransport: ConsoleTransport;
  private fileTransport: FileTransport;
  private customTransports: ITransport[] = [];
  private closed = false;

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      console: { ...DEFAULT_CONFIG.console, ...config?.console },
      file: { ...DEFAULT_CONFIG.file, ...config?.file },
      defaultContext: config?.defaultContext ?? {},
      sensitiveFields: config?.sensitiveFields ?? DEFAULT_CONFIG.sensitiveFields,
      transports: config?.transports,
      onLog: config?.onLog,
    };

    this.consoleTransport = new ConsoleTransport(this.config.console);
    this.fileTransport = new FileTransport(this.config.file);

    this.customTransports = config?.transports ?? [];

    // 默认上下文中间件
    if (Object.keys(this.config.defaultContext).length > 0) {
      this.middlewares.push((record, next) => {
        record.context = { ...this.config.defaultContext, ...record.context };
        next();
      });
    }

    // 敏感字段脱敏中间件
    if (this.config.sensitiveFields.length > 0) {
      this.middlewares.push((record, next) => {
        record.context = sanitize(record.context, this.config.sensitiveFields) as LogContext;
        if (record.data !== undefined) {
          record.data = sanitize(record.data, this.config.sensitiveFields);
        }
        next();
      });
    }
  }

  /**
   * 添加中间件
   */
  use(middleware: LogMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * 添加自定义 Transport
   */
  addTransport(transport: ITransport): this {
    this.customTransports.push(transport);
    return this;
  }

  /**
   * 创建日志记录
   */
  private createRecord(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error,
    data?: unknown
  ): LogRecord {
    const globalContext = contextManager.get();
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      levelName: LogLevelName[level],
      message,
      context: { ...globalContext, ...context },
      data,
    };

    if (error) {
      record.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return record;
  }

  /**
   * 执行中间件链
   */
  private executeMiddlewares(record: LogRecord): void {
    let index = 0;
    const next = () => {
      if (index < this.middlewares.length) {
        this.middlewares[index++](record, next);
      }
    };
    next();
  }

  /**
   * 写入日志
   */
  private log(record: LogRecord): void {
    if (this.closed) return;
    if (record.level < this.config.level) return;

    this.executeMiddlewares(record);

    // 写入内置 Transport
    this.consoleTransport.write(record, this.config.level);
    this.fileTransport.write(record, this.config.level);

    // 写入自定义 Transport
    for (const transport of this.customTransports) {
      try {
        transport.write(record, this.config.level);
      } catch (err) {
        console.error(`[Logger] Transport "${transport.name ?? 'unknown'}" error:`, err);
      }
    }

    // 调用 onLog 回调
    if (this.config.onLog) {
      try {
        this.config.onLog(record);
      } catch (err) {
        console.error('[Logger] onLog callback error:', err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 日志方法
  // ---------------------------------------------------------------------------

  trace(message: string, context?: LogContext): void {
    this.log(this.createRecord(Lvl.TRACE, message, context));
  }

  debug(message: string, context?: LogContext, data?: unknown): void {
    this.log(this.createRecord(Lvl.DEBUG, message, context, undefined, data));
  }

  info(message: string, context?: LogContext, data?: unknown): void {
    this.log(this.createRecord(Lvl.INFO, message, context, undefined, data));
  }

  warn(message: string, context?: LogContext, data?: unknown): void {
    this.log(this.createRecord(Lvl.WARN, message, context, undefined, data));
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const err = error instanceof Error ? error : undefined;
    const data = error !== undefined && !(error instanceof Error) ? error : undefined;
    this.log(this.createRecord(Lvl.ERROR, message, context, err, data));
  }

  fatal(message: string, error?: Error | unknown, context?: LogContext): void {
    const err = error instanceof Error ? error : undefined;
    const data = error !== undefined && !(error instanceof Error) ? error : undefined;
    this.log(this.createRecord(Lvl.FATAL, message, context, err, data));
  }

  /**
   * 直接记录 LogRecord
   */
  write(record: LogRecord): void {
    this.log(record);
  }

  // ---------------------------------------------------------------------------
  // 子日志器
  // ---------------------------------------------------------------------------

  child(module: string, additionalContext?: LogContext): ChildLogger {
    return new ChildLogger(this, module, additionalContext);
  }

  // ---------------------------------------------------------------------------
  // 生命周期
  // ---------------------------------------------------------------------------

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.fileTransport.close();

    // 关闭自定义 Transport
    for (const transport of this.customTransports) {
      if (transport.close) {
        try {
          transport.close();
        } catch (err) {
          console.error(`[Logger] Transport "${transport.name ?? 'unknown'}" close error:`, err);
        }
      }
    }
  }

  getConfig(): Readonly<typeof this.config> {
    // 返回浅拷贝，避免外部修改内部配置
    return {
      ...this.config,
      console: { ...this.config.console },
      file: { ...this.config.file },
      sensitiveFields: [...this.config.sensitiveFields],
    };
  }
}

/**
 * 子日志器
 */
export class ChildLogger {
  constructor(
    private parent: Logger,
    private module: string,
    private context: LogContext = {}
  ) {}

  private merge(ctx?: LogContext): LogContext {
    return { ...this.context, ...ctx };
  }

  trace(message: string, context?: LogContext): void {
    this.parent.trace(`[${this.module}] ${message}`, this.merge(context));
  }

  debug(message: string, context?: LogContext, data?: unknown): void {
    this.parent.debug(`[${this.module}] ${message}`, this.merge(context), data);
  }

  info(message: string, context?: LogContext, data?: unknown): void {
    this.parent.info(`[${this.module}] ${message}`, this.merge(context), data);
  }

  warn(message: string, context?: LogContext, data?: unknown): void {
    this.parent.warn(`[${this.module}] ${message}`, this.merge(context), data);
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    this.parent.error(`[${this.module}] ${message}`, error, this.merge(context));
  }

  fatal(message: string, error?: Error | unknown, context?: LogContext): void {
    this.parent.fatal(`[${this.module}] ${message}`, error, this.merge(context));
  }

  child(subModule: string, additionalContext?: LogContext): ChildLogger {
    return new ChildLogger(this.parent, `${this.module}:${subModule}`, {
      ...this.context,
      ...additionalContext,
    });
  }
}

// =============================================================================
// 全局实例
// =============================================================================

let defaultLogger: Logger | null = null;

export function getLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger();
  }
  return defaultLogger;
}

export function setDefaultLogger(logger: Logger): void {
  defaultLogger = logger;
}

export function createLogger(config?: Partial<LoggerConfig>): Logger {
  return new Logger(config);
}
