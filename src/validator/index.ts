// Deliberately independent: no routing, objective, solver or oracle implementation imports.
import type { Instance, Schedule } from '../model.js';
export type ValidationCode = 'INFEASIBLE' | 'STRUCTURE' | 'MISSING_KID' | 'DUPLICATE_KID' | 'UNKNOWN_KID' | 'CAPACITY' | 'UNAVAILABLE_DRIVER' | 'OVERLAP' | 'RIDE_CAP' | 'STOPS' | 'MINUTES' | 'LOADS' | 'OBJECTIVE';
export interface ValidationError { code: ValidationCode; message: string }
export function validate(i: Instance, s: Schedule): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const add = (code: ValidationCode, message: string) => errors.push({ code, message });
  if (s.status !== 'ok') return { valid: false, errors: [{ code: 'INFEASIBLE', message: 'No schedule to validate' }] };
  const time = (a: string, b: string): number => {
    if (i.travelOverride) return i.travelOverride[a]![b]!;
    if (a === b) return 0;
    const p = i.places.find(p => p.id === a)!, q = i.places.find(p => p.id === b)!;
    return Math.max(1, Math.round(Math.hypot(p.x - q.x, p.y - q.y) * i.params.detour / i.params.speedKmh * 60));
  };
  const loads = Object.fromEntries(i.households.map(h => [h.id, 0]));
  const assigned = new Map<string, string[]>();
  if (s.legs.length !== i.legs.length || new Set(s.legs.map(l => l.legId)).size !== s.legs.length) add('STRUCTURE', 'Legs must occur exactly once');
  for (const extra of s.legs) if (!i.legs.some(l => l.id === extra.legId)) add('STRUCTURE', `Unknown leg ${extra.legId}`);
  for (const leg of i.legs) {
    const item = s.legs.find(x => x.legId === leg.id);
    if (!item) { add('STRUCTURE', `Missing leg ${leg.id}`); continue; }
    const seen: string[] = [], drivers = new Set<string>(), householdRoutes = new Set<string>();
    for (const r of item.routes) {
      seen.push(...r.kidIds);
      const d = i.households.find(h => h.id === r.driverId);
      if (!d || !leg.driverIds.includes(r.driverId)) add('UNAVAILABLE_DRIVER', `${r.driverId} unavailable on ${leg.id}`);
      if (drivers.has(r.driverId)) add('OVERLAP', `Driver ${r.driverId} has two routes on ${leg.id}`);
      drivers.add(r.driverId);
      const previous = assigned.get(r.driverId) ?? [];
      for (const priorId of previous) {
        const p = i.legs.find(l => l.id === priorId)!;
        if (p.winStart <= leg.winEnd && leg.winStart <= p.winEnd) add('OVERLAP', `Driver ${r.driverId}: ${p.id} overlaps ${leg.id}`);
      }
      assigned.set(r.driverId, [...previous, leg.id]);
      if (!d) continue;
      if (r.kidIds.length > d.seats) add('CAPACITY', `${r.driverId}: ${r.kidIds.length} passengers > ${d.seats} seats`);
      const expectedStops = new Set(r.kidIds.map(k => i.kids.find(x => x.id === k)?.householdId));
      if (!r.stops.length || new Set(r.stops).size !== r.stops.length || expectedStops.size !== r.stops.length || r.stops.some(h => !expectedStops.has(h))) add('STOPS', 'Stops and rider households differ');
      for (const h of r.stops) {
        if (householdRoutes.has(h)) add('STOPS', `Household ${h} split across routes`);
        householdRoutes.add(h);
      }
      if (r.stops.some(h => !i.households.some(x => x.id === h))) { add('STOPS', 'Unknown household stop'); continue; }
      const venue = i.venues.find(v => v.id === leg.venueId)!.placeId;
      let elapsed = 0, at = leg.dir === 'to' ? d.placeId : venue;
      const pickupTimes: { h: string; t: number }[] = [];
      for (const h of r.stops) {
        const dest = i.households.find(x => x.id === h)!.placeId;
        elapsed += time(at, dest);
        pickupTimes.push({ h, t: elapsed });
        if (leg.dir === 'from' && elapsed > i.params.maxRide) add('RIDE_CAP', `${h}: ${elapsed} minutes in car`);
        if (dest !== d.placeId) elapsed += i.params.dwell;
        at = dest;
      }
      elapsed += time(at, leg.dir === 'to' ? venue : d.placeId);
      if (leg.dir === 'to') for (const p of pickupTimes) if (elapsed - p.t > i.params.maxRide) add('RIDE_CAP', `${p.h}: ${elapsed - p.t} minutes in car`);
      if (!Number.isSafeInteger(r.minutes) || r.minutes !== elapsed) add('MINUTES', `Expected ${elapsed}, got ${r.minutes}`);
      loads[d.id]! += elapsed;
    }
    for (const k of leg.kidIds) {
      const count = seen.filter(x => x === k).length;
      if (count === 0) add('MISSING_KID', `${leg.id}: missing ${k}`);
      if (count > 1) add('DUPLICATE_KID', `${leg.id}: duplicate ${k}`);
    }
    for (const k of seen) if (!leg.kidIds.includes(k)) add('UNKNOWN_KID', `${leg.id}: unexpected ${k}`);
  }
  if (Object.keys(s.loads).length !== i.households.length || i.households.some(h => s.loads[h.id] !== loads[h.id])) add('LOADS', 'Reported loads differ from recomputed route minutes');
  let W = 0, S = 0, total = 0;
  const weights = i.households.map(h => Math.max(1, i.kids.filter(k => k.householdId === h.id).length));
  i.households.forEach((h, n) => { W += weights[n]!; S += (i.history[h.id] ?? 0) + loads[h.id]!; total += loads[h.id]!; });
  let numerator = 0;
  i.households.forEach((h, n) => { numerator += Math.abs(W * ((i.history[h.id] ?? 0) + loads[h.id]!) - weights[n]! * S); });
  const F = numerator / W, J = total + i.params.lambda * F;
  if (!Number.isFinite(s.F) || !Number.isFinite(s.J) || Math.abs(s.F - F) > 1e-9 || Math.abs(s.J - J) > 1e-9) add('OBJECTIVE', `Expected F=${F}, J=${J}`);
  return { valid: errors.length === 0, errors };
}
