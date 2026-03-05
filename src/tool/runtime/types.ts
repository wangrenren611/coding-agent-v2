/**
 * Tool 运行时通用类型
 */

/**
 * 执行目标
 *
 * - local: 本地机器执行
 * - remote: 远程服务执行
 * - sandbox: 独立沙箱执行
 * - custom: 自定义后端
 */
export type ExecutionTarget = 'local' | 'remote' | 'sandbox' | 'custom';

/**
 * 执行安全画像
 */
export type ExecutionProfile = 'trusted' | 'untrusted' | 'ci';
