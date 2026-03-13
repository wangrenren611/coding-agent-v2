import type { DependencyGraphState } from './task-types';

function ensureUniquePush(values: string[], next: string): void {
  if (!values.includes(next)) {
    values.push(next);
  }
}

export function ensureGraphNode(graph: DependencyGraphState, taskId: string): void {
  if (!graph.adjacency[taskId]) {
    graph.adjacency[taskId] = [];
  }
  if (!graph.reverse[taskId]) {
    graph.reverse[taskId] = [];
  }
}

export function addDependencyEdge(
  graph: DependencyGraphState,
  blockerId: string,
  dependentId: string
): void {
  ensureGraphNode(graph, blockerId);
  ensureGraphNode(graph, dependentId);
  ensureUniquePush(graph.adjacency[blockerId], dependentId);
  ensureUniquePush(graph.reverse[dependentId], blockerId);
}

export function removeDependencyEdge(
  graph: DependencyGraphState,
  blockerId: string,
  dependentId: string
): void {
  ensureGraphNode(graph, blockerId);
  ensureGraphNode(graph, dependentId);
  graph.adjacency[blockerId] = graph.adjacency[blockerId].filter((id) => id !== dependentId);
  graph.reverse[dependentId] = graph.reverse[dependentId].filter((id) => id !== blockerId);
}

export function hasPath(graph: DependencyGraphState, fromId: string, toId: string): boolean {
  if (fromId === toId) {
    return true;
  }

  const visited = new Set<string>();
  const queue: string[] = [fromId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === toId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const nextNodes = graph.adjacency[current] || [];
    for (const next of nextNodes) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return false;
}

export function wouldCreateCycle(
  graph: DependencyGraphState,
  blockerId: string,
  dependentId: string
): boolean {
  if (blockerId === dependentId) {
    return true;
  }
  // If dependent can already reach blocker, blocker -> dependent creates a cycle.
  return hasPath(graph, dependentId, blockerId);
}
