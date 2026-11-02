import type { History, Instance, Schedule } from './model.js';
import { validate } from './validator/index.js';
export function confirmWeek(i: Instance, s: Schedule): History {
  const validation = validate(i, s);
  if (!validation.valid) throw new Error('Cannot confirm an invalid schedule: ' + validation.errors.map(e => e.code).join(', '));
  const w = i.households.map(h => Math.max(1, i.kids.filter(k => k.householdId === h.id).length));
  const totalLoad = i.households.reduce((sum, h) => sum + s.loads[h.id]!, 0), W = w.reduce((a, b) => a + b, 0);
  // Carry uses only this week's loads to conserve history; in-week fairness includes H + L.
  const muCarry = totalLoad / W;
  return Object.fromEntries(i.households.map((h, j) => [h.id, (i.history[h.id] ?? 0) + s.loads[h.id]! - Math.round(w[j]! * muCarry)]));
}
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function exportHistory(history: History): string { return JSON.stringify(history, null, 2); }
export function importHistory(json: string): History {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([k, v]) => !k || !Number.isSafeInteger(v))) throw new Error('History must map household IDs to signed integer minutes');
  return value as History;
}
export function saveHistory(history: History, storage: StorageLike = localStorage): void { storage.setItem('carpoolsolver.history.v1', exportHistory(history)); }
export function loadHistory(storage: StorageLike = localStorage): History { return importHistory(storage.getItem('carpoolsolver.history.v1') ?? '{}'); }
