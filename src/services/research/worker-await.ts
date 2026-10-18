import { AsyncLocalStorage } from "node:async_hooks";

export class ResearchWaiting extends Error {
  constructor(public readonly taskIds: string[]) { super("Research is waiting for browser workers"); }
}
const context = new AsyncLocalStorage<{ tasks: Set<string>; ignored: Set<string> }>();
export function withWorkerDeferral<T>(fn: () => Promise<T>, ignored: string[] = []) { return context.run({ tasks: new Set(), ignored: new Set(ignored) }, fn); }
export function isWorkerDeferring() { return context.getStore() !== undefined; }
export function ignoredWorkerPayload(hash: string) { return context.getStore()?.ignored.has(hash) ?? false; }
export function deferWorkerTask(taskId: string): boolean {
  const tasks = context.getStore();
  if (!tasks) return false;
  tasks.tasks.add(taskId);
  return true;
}
export function suspendForWorkers() {
  const tasks = context.getStore();
  if (tasks?.tasks.size) throw new ResearchWaiting([...tasks.tasks]);
}
