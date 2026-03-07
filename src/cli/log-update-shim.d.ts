declare module 'log-update' {
  export type Options = {
    readonly showCursor?: boolean;
  };

  export type LogUpdateMethods = {
    clear(): void;
    done(): void;
  };

  type LogUpdateFn = ((...text: string[]) => void) & LogUpdateMethods;

  export function createLogUpdate(
    stream: NodeJS.WritableStream,
    options?: Options
  ): LogUpdateFn;

  const logUpdate: LogUpdateFn;
  export default logUpdate;
}
