// Independent permutation/assignment enumeration. No solver, oracle, core or validator.
import type { Instance, Leg, Route, Schedule } from '../src/model.js';
function* permutations<T>(items: T[]): Generator<T[]> {
  if (!items.length) { yield []; return; }
  for (let j = 0; j < items.length; j++) for (const tail of permutations([...items.slice(0, j), ...items.slice(j + 1)])) yield [items[j]!, ...tail];
}
export function brute(i: Instance): Schedule | undefined {
  const time = (a: string, b: string) => {
    if (i.travelOverride) return i.travelOverride[a]![b]!;
    if (a === b) return 0;
    const p = i.places.find(p => p.id === a)!, q = i.places.find(p => p.id === b)!;
    return Math.max(1, Math.round(Math.hypot(p.x - q.x, p.y - q.y) * i.params.detour / i.params.speedKmh * 60));
  };
  function* legPlans(l: Leg): Generator<Route[]> {
    const stops = [...new Set(l.kidIds.map(k => i.kids.find(x => x.id === k)!.householdId))];
    const groups: string[][] = l.driverIds.map(() => []);
    function* orders(d: number, routes: Route[]): Generator<Route[]> {
      if (d === groups.length) { yield routes; return; }
      const group = groups[d]!, driver = i.households.find(h => h.id === l.driverIds[d])!;
      if (!group.length) { yield* orders(d + 1, routes); return; }
      const kids = l.kidIds.filter(k => group.includes(i.kids.find(x => x.id === k)!.householdId));
      if (kids.length > driver.seats) return;
      const venue = i.venues.find(v => v.id === l.venueId)!.placeId;
      for (const order of permutations(group)) {
        let elapsed = 0, at = l.dir === 'to' ? driver.placeId : venue;
        const arrivals: number[] = [];
        for (const h of order) {
          const p = i.households.find(x => x.id === h)!.placeId;
          elapsed += time(at, p); arrivals.push(elapsed);
          if (p !== driver.placeId) elapsed += i.params.dwell;
          at = p;
        }
        elapsed += time(at, l.dir === 'to' ? venue : driver.placeId);
        if (arrivals.some(t => (l.dir === 'to' ? elapsed - t : t) > i.params.maxRide)) continue;
        yield* orders(d + 1, [...routes, { driverId: driver.id, stops: order, kidIds: kids, minutes: elapsed }]);
      }
    }
    function* assign(n: number): Generator<Route[]> {
      if (n === stops.length) { yield* orders(0, []); return; }
      for (const group of groups) { group.push(stops[n]!); yield* assign(n + 1); group.pop(); }
    }
    yield* assign(0);
  }
  const plans = i.legs.map(l => [...legPlans(l)]);
  let best: Schedule | undefined;
  function weeks(li: number, chosen: Route[][]): void {
    if (li === i.legs.length) {
      const loads = Object.fromEntries(i.households.map(h => [h.id, 0]));
      for (const r of chosen.flat()) loads[r.driverId]! += r.minutes;
      const weights = i.households.map(h => Math.max(1, i.kids.filter(k => k.householdId === h.id).length)), W = weights.reduce((a, b) => a + b, 0);
      const S = i.households.reduce((sum, h) => sum + loads[h.id]! + (i.history[h.id] ?? 0), 0);
      const F = i.households.reduce((sum, h, j) => sum + Math.abs(W * (loads[h.id]! + (i.history[h.id] ?? 0)) - weights[j]! * S), 0) / W;
      const J = Object.values(loads).reduce((a, b) => a + b, 0) + i.params.lambda * F;
      if (!best || J < best.J - 1e-9) best = { status: 'ok', legs: i.legs.map((l, j) => ({ legId: l.id, routes: chosen[j]! })), loads, F, J };
      return;
    }
    for (const rs of plans[li]!) {
      if (chosen.some((prior, j) => i.legs[j]!.winStart <= i.legs[li]!.winEnd && i.legs[li]!.winStart <= i.legs[j]!.winEnd && rs.some(r => prior.some(p => p.driverId === r.driverId)))) continue;
      weeks(li + 1, [...chosen, rs]);
    }
  }
  weeks(0, []);
  return best;
}
