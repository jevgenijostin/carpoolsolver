import { solve } from './index.js';
import { instanceSchema } from '../io.js';
import type { Instance } from '../model.js';
export interface WorkerRequest { id: string; instance: Instance }
export function handleRequest(request: WorkerRequest): unknown {
  try { return { id: request.id, schedule: solve(instanceSchema.parse(request.instance)) }; }
  catch (e) { return { id: request.id, error: e instanceof Error ? e.message : String(e) }; }
}
// Module Web Worker entry point; no Node imports or main-thread side effects.
const scope = globalThis as unknown as { document?: unknown; postMessage?: (v: unknown) => void; onmessage?: (event: MessageEvent<WorkerRequest>) => void };
if (scope.document === undefined && typeof scope.postMessage === 'function') scope.onmessage = event => scope.postMessage!(handleRequest(event.data));
