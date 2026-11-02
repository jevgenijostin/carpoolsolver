import type { Instance, Leg, Route, Schedule } from './model.js';
export function travel(i: Instance, a: string, b: string): number {
  if (i.travelOverride) return i.travelOverride[a]![b]!;
  if (a === b) return 0;
  const p = i.places.find(p => p.id === a)!, q = i.places.find(p => p.id === b)!;
  return Math.max(1, Math.round(Math.hypot(p.x - q.x, p.y - q.y) * i.params.detour / i.params.speedKmh * 60));
}
export function stopsFor(i: Instance, l: Leg): string[] { return [...new Set(l.kidIds.map(k => i.kids.find(x => x.id === k)!.householdId))]; }
export function overlap(a: Leg, b: Leg): boolean { return a.winStart <= b.winEnd && b.winStart <= a.winEnd; }
export function route(i: Instance, l: Leg, driverId: string, stops: string[]): Route | undefined {
  const d = i.households.find(h => h.id === driverId);
  if (!d || !l.driverIds.includes(driverId) || !stops.length || new Set(stops).size !== stops.length) return undefined;
  const kidIds = stops.flatMap(h => l.kidIds.filter(k => i.kids.find(x => x.id === k)!.householdId === h));
  if (kidIds.length > d.seats || stops.some(h => !i.households.some(x => x.id === h))) return undefined;
  const venue = i.venues.find(v => v.id === l.venueId)!.placeId;
  let prev = l.dir === 'to' ? d.placeId : venue, elapsed = 0;
  const pickups: number[] = [];
  for (const h of stops) {
    const place = i.households.find(x => x.id === h)!.placeId;
    elapsed += travel(i, prev, place);
    if (l.dir === 'from' && elapsed > i.params.maxRide) return undefined;
    pickups.push(elapsed);
    elapsed += place === d.placeId ? 0 : i.params.dwell;
    prev = place;
  }
  elapsed += travel(i, prev, l.dir === 'to' ? venue : d.placeId);
  if (l.dir === 'to' && pickups.some(t => elapsed - t > i.params.maxRide)) return undefined;
  return { driverId, stops: [...stops], kidIds, minutes: elapsed };
}
export function objective(i: Instance, loads: Record<string, number>): { F: number; J: number } {
  const weights = i.households.map(h => Math.max(1, i.kids.filter(k => k.householdId === h.id).length));
  const W = weights.reduce((a, b) => a + b, 0);
  const S = i.households.reduce((s, h) => s + (i.history[h.id] ?? 0) + (loads[h.id] ?? 0), 0);
  const numerator = i.households.reduce((s, h, n) => s + Math.abs(W * ((i.history[h.id] ?? 0) + (loads[h.id] ?? 0)) - weights[n]! * S), 0);
  const F = numerator / W;
  return { F, J: Object.values(loads).reduce((a, b) => a + b, 0) + i.params.lambda * F };
}
export function schedule(i: Instance, routes: Route[][]): Schedule {
  const loads = Object.fromEntries(i.households.map(h => [h.id, 0]));
  for (const rs of routes) for (const r of rs) loads[r.driverId]! += r.minutes;
  return { status: 'ok', legs: i.legs.map((l, n) => ({ legId: l.id, routes: routes[n]! })), loads, ...objective(i, loads) };
}
export function mulberry32(seed: number): () => number {
  return () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
