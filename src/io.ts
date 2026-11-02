import { z } from 'zod';
import type { Instance } from './model.js';
const id = z.string().min(1);
const integer = z.number().int().safe();
const ids = z.array(id).refine(a => new Set(a).size === a.length, 'IDs must be unique');
export const instanceSchema = z.strictObject({
  places: z.array(z.strictObject({ id, x: z.number().finite(), y: z.number().finite() })).min(1),
  households: z.array(z.strictObject({ id, name: id, placeId: id, seats: integer.nonnegative() })).min(1),
  kids: z.array(z.strictObject({ id, name: id, householdId: id })),
  venues: z.array(z.strictObject({ id, name: id, placeId: id })).min(1),
  legs: z.array(z.strictObject({ id, day: integer.min(0).max(6), venueId: id, dir: z.enum(['to', 'from']), kidIds: ids, driverIds: ids, winStart: integer.min(0).max(10079), winEnd: integer.min(0).max(10079) })),
  params: z.strictObject({ speedKmh: z.number().positive().finite().default(28), detour: z.number().positive().finite().default(1.3), dwell: integer.nonnegative().default(2), maxRide: integer.nonnegative().default(45), lambda: z.number().nonnegative().finite().default(0.5), seed: integer.min(0).max(4294967295) }),
  history: z.record(id, integer),
  travelOverride: z.record(id, z.record(id, integer.nonnegative())).optional()
}).superRefine((v, ctx) => {
  const fail = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });
  for (const kind of ['places', 'households', 'kids', 'venues', 'legs'] as const) {
    if (new Set(v[kind].map(x => x.id)).size !== v[kind].length) fail('Duplicate ID', [kind]);
  }
  const places = new Set(v.places.map(x => x.id)), homes = new Set(v.households.map(x => x.id)), kids = new Set(v.kids.map(x => x.id)), venues = new Set(v.venues.map(x => x.id));
  v.households.forEach((h, i) => { if (!places.has(h.placeId)) fail('Unknown place', ['households', i, 'placeId']); });
  v.venues.forEach((h, i) => { if (!places.has(h.placeId)) fail('Unknown place', ['venues', i, 'placeId']); });
  v.kids.forEach((k, i) => { if (!homes.has(k.householdId)) fail('Unknown household', ['kids', i, 'householdId']); });
  v.legs.forEach((l, i) => {
    if (!venues.has(l.venueId)) fail('Unknown venue', ['legs', i, 'venueId']);
    if (l.winStart > l.winEnd || Math.floor(l.winStart / 1440) !== l.day || Math.floor(l.winEnd / 1440) !== l.day) fail('Window must be ordered and within day', ['legs', i]);
    for (const k of l.kidIds) if (!kids.has(k)) fail('Unknown kid: ' + k, ['legs', i, 'kidIds']);
    for (const d of l.driverIds) if (!homes.has(d)) fail('Unknown driver: ' + d, ['legs', i, 'driverIds']);
  });
  for (const h of Object.keys(v.history)) if (!homes.has(h)) fail('Unknown history household', ['history', h]);
  if (v.travelOverride) {
    for (const a of places) for (const b of places) {
      const t = v.travelOverride[a]?.[b];
      if (t === undefined || (a === b ? t !== 0 : t < 1)) fail('Matrix must be complete, diagonal zero, other entries positive', ['travelOverride', a, b]);
    }
    for (const [a, row] of Object.entries(v.travelOverride)) {
      if (!places.has(a) || Object.keys(row).some(b => !places.has(b))) fail('Unknown matrix place', ['travelOverride', a]);
    }
  }
});
export function importInstance(json: string): Instance {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error('Invalid JSON: could not parse instance'); }
  const parsed = instanceSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    throw new Error('Invalid instance: ' + issues.slice(0, 8).map(e => `${e.path.join('.')}: ${e.message}`).join('; ') + (issues.length > 8 ? `; and ${issues.length - 8} more errors` : ''));
  }
  return parsed.data;
}
export function exportInstance(instance: Instance): string { return JSON.stringify(instanceSchema.parse(instance), null, 2); }
