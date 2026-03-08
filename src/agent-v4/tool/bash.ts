import { spawn } from 'child_process';
import z from 'zod';
import { BaseTool } from './base-tool';
import { ToolExecutionContext } from './types';
import { ToolExecutionError } from './error';

const schema = z.object({
  command: z.string().min(1).describe('The bash command to run'),
  timeout: z
    .number()
    .int()
    .min(0)
    .max(600000)
    .describe('Command timeout in milliseconds')
    .optional(),
});

type BashArgs = z.infer<typeof schema>;

export class BashTool extends BaseTool<typeof schema> {
  parameters = schema;
  name = 'bash';
  description = 'Execute shell command';

  async execute(args: BashArgs, context?: ToolExecutionContext) {
    const { command, timeout = 60000 } = args;
    const startTime = Date.now();

    try {
      const output = await this.executeCommand(command, timeout, context);
      
      return {
        success: true,
        output,
        metadata: {
          executionTime: Date.now() - startTime,
          command
        }
      };
    } catch (error) {
      const err = new ToolExecutionError((error as Error).message);
      return {
        success: false,
        error: err,
        metadata: {
          executionTime: Date.now() - startTime,
          command
        }
      };
    }
  }

  private executeCommand(
    command: string,
    timeout: number,
    context?: ToolExecutionContext
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/sh';
      const shellArgs = isWindows ? ['-Command', command] : ['-c', command];

      const child = spawn(shell, shellArgs, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const abortSignal = context?.toolAbortSignal;

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        finishReject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      function cleanup(): void {
        abortSignal?.removeEventListener('abort', onAbort);
        clearTimeout(timer);
      }

      function finishReject(error: Error): void {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      }

      function finishResolve(value: string): void {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      }

      function onAbort(): void {
        if (!settled) {
          child.kill('SIGTERM');
          finishReject(new Error('Command aborted'));
        }
      }

      if (abortSignal) {
        if (abortSignal.aborted) {
          onAbort();
          return;
        }
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        context?.onChunk?.({
          type: 'stdout',
          data: chunk,
          content: chunk,
          timestamp: Date.now(),
        });
      });

      child.stderr?.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        context?.onChunk?.({
          type: 'stderr',
          data: chunk,
          content: chunk,
          timestamp: Date.now(),
        });
      });

      child.on('close', (code) => {
        if (code === 0) {
          finishResolve(stdout);
        } else {
          const errorMessage = stderr || `Command exited with code ${code}`;
          finishReject(new Error(errorMessage));
        }
      });

      child.on('error', (error) => {
        finishReject(error);
      });
    });
  }
}
