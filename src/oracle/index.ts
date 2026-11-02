import type { Instance, Leg, Route, Schedule } from '../model.js';
import { overlap, schedule, stopsFor, travel } from '../core.js';

/** Resource-labelled Held-Karp. Keep ALL elapsed-time labels, not just the cheapest.
 * Reverse outbound paths make every ride cap a suffix check; inbound uses prefixes.
 * Equal (mask,last,elapsed) states have identical possible continuations. */
export function heldKarp(i: Instance, l: Leg, driverId: string): Map<number, Route[]> {
  const stops = stopsFor(i, l), n = stops.length, d = i.households.find(h => h.id === driverId)!;
  const places = stops.map(h => i.households.find(x => x.id === h)!.placeId);
  const counts = stops.map(h => l.kidIds.filter(k => i.kids.find(x => x.id === k)!.householdId === h).length);
  const venue = i.venues.find(v => v.id === l.venueId)!.placeId;
  const dwell = (j: number) => places[j] === d.placeId ? 0 : i.params.dwell;
  const dp = Array.from({ length: 1 << n }, () => Array.from({ length: n }, () => new Map<number, number[]>()));
  const result = new Map<number, Route[]>([[0, []]]);
  for (let j = 0; j < n; j++) {
    const ride = l.dir === 'to' ? dwell(j) + travel(i, places[j]!, venue) : travel(i, venue, places[j]!);
    if (counts[j]! <= d.seats && ride <= i.params.maxRide) dp[1 << j]![j]!.set(ride + (l.dir === 'from' ? dwell(j) : 0), [j]);
  }
  for (let mask = 1; mask < 1 << n; mask++) {
    const passengers = counts.reduce((sum, c, j) => sum + ((mask & (1 << j)) ? c : 0), 0);
    const costs = new Map<number, Route>();
    for (let last = 0; last < n; last++) for (const [elapsed, path] of dp[mask]![last]!) {
      const minutes = elapsed + (l.dir === 'to' ? travel(i, d.placeId, places[last]!) : travel(i, places[last]!, d.placeId));
      const order = (l.dir === 'to' ? [...path].reverse() : path).map(j => stops[j]!);
      if (!costs.has(minutes)) costs.set(minutes, { driverId, stops: order, kidIds: order.flatMap(h => l.kidIds.filter(k => i.kids.find(x => x.id === k)!.householdId === h)), minutes });
      for (let j = 0; j < n; j++) if (!(mask & (1 << j)) && passengers + counts[j]! <= d.seats) {
        const ride = l.dir === 'to' ? dwell(j) + travel(i, places[j]!, places[last]!) + elapsed : elapsed + travel(i, places[last]!, places[j]!);
        if (ride <= i.params.maxRide) {
          const next = ride + (l.dir === 'from' ? dwell(j) : 0), target = dp[mask | (1 << j)]![j]!;
          if (!target.has(next)) target.set(next, [...path, j]);
        }
      }
    }
    result.set(mask, [...costs.values()]);
  }
  return result;
}
export interface LegVector { loads: number[]; used: number; routes: Route[] }
export function legVectors(i: Instance, l: Leg): LegVector[] {
  const tables = l.driverIds.map(d => heldKarp(i, l, d));
  const allDrivers = [...new Set(i.legs.flatMap(leg => leg.driverIds))];
  const result = new Map<string, LegVector>();
  const full = (1 << stopsFor(i, l).length) - 1;
  // The subset-partition recurrence, lifted from scalar costs to vector sets.
  function partition(k: number, remaining: number, loads: number[], used: number, routes: Route[]): void {
    if (k === tables.length) {
      if (!remaining) result.set(loads.join(',') + '/' + used, { loads, used, routes });
      return;
    }
    const index = i.households.findIndex(h => h.id === l.driverIds[k]);
    for (let sub = remaining; ; sub = (sub - 1) & remaining) {
      if (!sub) partition(k + 1, remaining, loads, used, routes);
      else for (const r of tables[k]!.get(sub) ?? []) {
        const next = [...loads]; next[index] = r.minutes;
        partition(k + 1, remaining ^ sub, next, used | (1 << allDrivers.indexOf(l.driverIds[k]!)), [...routes, r]);
      }
      if (!sub) break;
    }
  }
  partition(0, full, i.households.map(() => 0), 0, []);
  return [...result.values()];
}
export interface OracleResult { schedule: Schedule | undefined; legVectorCounts: number[]; reachableCounts: number[] }
export function oracle(i: Instance): OracleResult {
  const drivers = new Set(i.legs.flatMap(l => l.driverIds));
  if (drivers.size > 3 || i.legs.length > 4 || i.legs.some(l => stopsFor(i, l).length > 6)) throw new Error('Oracle bound: <=6 stops/leg, <=3 available drivers total, <=4 legs');
  interface State { loads: number[]; used: number[]; routes: Route[][] }
  let reachable: State[] = [{ loads: i.households.map(() => 0), used: [], routes: [] }];
  const legVectorCounts: number[] = [], reachableCounts: number[] = [];
  for (let li = 0; li < i.legs.length; li++) {
    const l = i.legs[li]!, vectors = legVectors(i, l), next = new Map<string, State>();
    legVectorCounts.push(vectors.length);
    for (const state of reachable) for (const v of vectors) {
      if (state.used.some((u, j) => (u & v.used) !== 0 && overlap(i.legs[j]!, l))) continue;
      const loads = state.loads.map((x, j) => x + v.loads[j]!), used = [...state.used, v.used];
      // Retain assignment history only for windows that can affect future legs.
      const active = used.map((u, j) => i.legs.slice(li + 1).some(future => overlap(i.legs[j]!, future)) ? u : 0);
      const key = loads.join(',') + '/' + active.join(',');
      if (!next.has(key)) next.set(key, { loads, used, routes: [...state.routes, v.routes] });
    }
    reachable = [...next.values()]; reachableCounts.push(reachable.length);
  }
  let best: Schedule | undefined;
  for (const state of reachable) {
    const s = schedule(i, state.routes);
    if (!best || s.J < best.J - 1e-9 || (Math.abs(s.J - best.J) <= 1e-9 && s.F < best.F)) best = s;
  }
  return { schedule: best, legVectorCounts, reachableCounts };
}
