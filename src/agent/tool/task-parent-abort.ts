import type { SubagentRunnerAdapter } from './task-runner-adapter';
import type { TaskStore } from './task-store';
import type { ToolExecutionContext } from './types';

export const PARENT_ABORT_REASON = 'Cancelled by parent agent abort';

interface ParentAbortCascadeParams {
  context?: ToolExecutionContext;
  namespace: string;
  agentId: string;
  linkedTaskId?: string;
  runner: SubagentRunnerAdapter;
  store: TaskStore;
}

interface CancelLinkedTaskParams {
  namespace: string;
  linkedTaskId: string;
  agentId: string;
  agentStatus: string;
  store: TaskStore;
}

export function attachParentAbortCascade(params: ParentAbortCascadeParams): () => void {
  const signal = params.context?.toolAbortSignal;
  if (!signal) {
    return () => {};
  }

  let settled = false;
  const onAbort = () => {
    if (settled) {
      return;
    }
    settled = true;
    void onParentAborted(params);
  };

  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) {
    onAbort();
  }

  return () => {
    signal.removeEventListener('abort', onAbort);
  };
}

async function onParentAborted(params: ParentAbortCascadeParams): Promise<void> {
  try {
    const cancelled = await params.runner.cancel(
      params.namespace,
      params.agentId,
      PARENT_ABORT_REASON
    );
    await params.context?.onChunk?.({
      type: 'info',
      content: `subagent cancelled by parent abort: ${params.agentId}`,
      data: `subagent cancelled by parent abort: ${params.agentId}`,
    });

    if (cancelled?.status === 'cancelled' && params.linkedTaskId) {
      await cancelLinkedTaskOnParentAbort({
        namespace: params.namespace,
        linkedTaskId: params.linkedTaskId,
        agentId: params.agentId,
        agentStatus: cancelled.status,
        store: params.store,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await params.context?.onChunk?.({
      type: 'stderr',
      content: `failed to cascade parent abort: ${message}`,
      data: `failed to cascade parent abort: ${message}`,
    });
  }
}

async function cancelLinkedTaskOnParentAbort(params: CancelLinkedTaskParams): Promise<void> {
  await params.store.updateState(params.namespace, (state) => {
    const task = state.tasks[params.linkedTaskId];
    if (!task) {
      return null;
    }
    if (task.agentId && task.agentId !== params.agentId) {
      return null;
    }
    if (task.status === 'completed' || task.status === 'cancelled') {
      return null;
    }

    const now = Date.now();
    const previousStatus = task.status;
    task.status = 'cancelled';
    task.owner = null;
    task.cancelledAt = now;
    task.updatedAt = now;
    task.version += 1;
    task.history.push({
      timestamp: now,
      action: 'cancelled',
      fromStatus: previousStatus,
      toStatus: 'cancelled',
      actor: 'task-parent-abort',
      reason: PARENT_ABORT_REASON,
      metadata: {
        agentId: params.agentId,
        agentStatus: params.agentStatus,
      },
    });
    return null;
  });
}
