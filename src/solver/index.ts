import type { Instance, Leg, Reason, Route, Schedule } from '../model.js';
import { mulberry32, overlap, route, schedule, stopsFor, travel } from '../core.js';

export interface SolveOptions { iterationsPerRestart?: number }
const failed = (reason: Reason): Schedule => ({ status: 'infeasible', reason, legs: [], loads: {}, J: 0, F: 0 });

function free(i: Instance, routes: Route[][], li: number, d: string): boolean {
  return !routes.some((rs, j) => j !== li && overlap(i.legs[li]!, i.legs[j]!) && rs.some(r => r.driverId === d));
}
function orderedStops(i: Instance, l: Leg): string[] {
  const v = i.venues.find(v => v.id === l.venueId)!.placeId;
  return stopsFor(i, l).sort((a, b) => travel(i, i.households.find(h => h.id === b)!.placeId, v) - travel(i, i.households.find(h => h.id === a)!.placeId, v) || (a < b ? -1 : a > b ? 1 : 0));
}
function greedy(i: Instance, random?: () => number): Route[][] | undefined {
  const routes: Route[][] = i.legs.map(() => []);
  const order = i.legs.map((_, j) => j);
  if (random) for (let j = order.length - 1; j > 0; j--) { const k = Math.floor(random() * (j + 1)); [order[j], order[k]] = [order[k]!, order[j]!]; }
  for (const li of order) {
    const l = i.legs[li]!;
    const bias = new Map(l.driverIds.map(d => [d, random ? random() * 24 : 0]));
    for (const h of orderedStops(i, l)) {
      let best: { r: Route; index: number; extra: number } | undefined;
      for (const d of l.driverIds) if (free(i, routes, li, d)) {
        const index = routes[li]!.findIndex(r => r.driverId === d), old = routes[li]![index];
        for (let pos = 0; pos <= (old?.stops.length ?? 0); pos++) {
          const stops = [...(old?.stops ?? [])]; stops.splice(pos, 0, h);
          const r = route(i, l, d, stops), extra = r ? r.minutes - (old?.minutes ?? 0) + bias.get(d)! : Infinity;
          if (r && (!best || extra < best.extra)) best = { r, index, extra };
        }
      }
      if (!best) return undefined;
      if (best.index < 0) routes[li]!.push(best.r); else routes[li]![best.index] = best.r;
    }
  }
  return routes;
}

/** Exhaustive feasibility repair, only after greedy fails. No objective optimization.
 * Search assigns household stops and all insertion positions; never confuses a
 * heuristic dead end with a proof of infeasibility. Can be expensive on large failures. */
function* feasibleLeg(i: Instance, l: Leg, allowed: string[]): Generator<Route[]> {
  const stops = orderedStops(i, l);
  // Arbitrary override matrices need not obey the triangle inequality. A partial
  // path that exceeds the cap may become shorter after inserting another stop.
  const relaxed = { ...i, params: { ...i.params, maxRide: Number.MAX_SAFE_INTEGER } };
  function* visit(n: number, routes: Route[]): Generator<Route[]> {
    if (n === stops.length) {
      const checked = routes.map(r => route(i, l, r.driverId, r.stops));
      if (checked.every((r): r is Route => r !== undefined)) yield checked;
      return;
    }
    const choices: { routes: Route[]; cost: number }[] = [];
    for (const d of allowed) {
      const index = routes.findIndex(r => r.driverId === d), old = routes[index];
      for (let p = 0; p <= (old?.stops.length ?? 0); p++) {
        const order = [...(old?.stops ?? [])]; order.splice(p, 0, stops[n]!);
        const r = route(relaxed, l, d, order);
        if (r) { const next = [...routes]; if (index < 0) next.push(r); else next[index] = r; choices.push({ routes: next, cost: r.minutes - (old?.minutes ?? 0) }); }
      }
    }
    choices.sort((a, b) => a.cost - b.cost);
    for (const c of choices) yield* visit(n + 1, c.routes);
  }
  yield* visit(0, []);
}
function capacityPack(i: Instance, l: Leg): boolean {
  const sizes = stopsFor(i, l).map(h => l.kidIds.filter(k => i.kids.find(x => x.id === k)!.householdId === h).length).sort((a, b) => b - a);
  const seats = l.driverIds.map(d => i.households.find(h => h.id === d)!.seats);
  function put(n: number): boolean {
    if (n === sizes.length) return true;
    const seen = new Set<number>();
    for (let d = 0; d < seats.length; d++) if (seats[d]! >= sizes[n]! && !seen.has(seats[d]!)) {
      seen.add(seats[d]!); seats[d]! -= sizes[n]!;
      if (put(n + 1)) return true;
      seats[d]! += sizes[n]!;
    }
    return false;
  }
  return put(0);
}
function diagnoseAndRepair(i: Instance): Route[][] | Reason {
  for (const l of i.legs) {
    if (!l.kidIds.length) continue;
    if (!l.driverIds.length) return { code: 'NO_DRIVER', legId: l.id };
    if (!capacityPack(i, l)) return { code: 'CAPACITY_SHORT', legId: l.id };
    if (feasibleLeg(i, l, l.driverIds).next().done) return { code: 'RIDE_CAP', kidId: l.kidIds.find(k => {
      const h = i.kids.find(x => x.id === k)!.householdId;
      return !l.driverIds.some(d => route(i, l, d, [h]));
    }) ?? l.kidIds[0]! };
  }
  const routes: Route[][] = i.legs.map(() => []);
  function visit(li: number): Route[][] | undefined {
    if (li === i.legs.length) return routes.map(rs => [...rs]);
    const l = i.legs[li]!;
    for (const rs of feasibleLeg(i, l, l.driverIds.filter(d => free(i, routes, li, d)))) {
      routes[li] = rs;
      const found = visit(li + 1); if (found) return found;
      routes[li] = [];
    }
    return undefined;
  }
  return visit(0) ?? { code: 'OVERLAP' };
}

export function solve(i: Instance, options: SolveOptions = {}): Schedule {
  let initial = greedy(i);
  if (!initial) { const repair = diagnoseAndRepair(i); if (!Array.isArray(repair)) return failed(repair); initial = repair; }
  let best = schedule(i, initial);
  if (!i.legs.some(l => l.kidIds.length)) return best;
  const random = mulberry32(i.params.seed), pick = (n: number) => Math.floor(random() * n);
  // Fixed deterministic work budget, calibrated against the two-second target.
  // Wall-clock stopping would violate byte-identical worker/main-thread results.
  const iterations = options.iterationsPerRestart ?? (i.legs.length <= 4 && i.legs.every(l => stopsFor(i, l).length <= 6) ? 6000 : 2200);
  const weights = i.households.map(h => Math.max(1, i.kids.filter(k => k.householdId === h.id).length));
  const W = weights.reduce((a, b) => a + b, 0), history = i.households.map(h => i.history[h.id] ?? 0);
  const driverIndex = new Map(i.households.map((h, j) => [h.id, j]));
  const score = (loads: number[]) => {
    const total = loads.reduce((a, b) => a + b, 0), S = total + history.reduce((a, b) => a + b, 0);
    return total + i.params.lambda * loads.reduce((sum, x, j) => sum + Math.abs(W * (x + history[j]!) - weights[j]! * S), 0) / W;
  };
  const cache = i.legs.map(() => new Map<string, Route | undefined>());
  const getRoute = (li: number, d: string, stops: string[]) => {
    const key = JSON.stringify([d, stops]), c = cache[li]!;
    if (!c.has(key)) c.set(key, route(i, i.legs[li]!, d, stops));
    return c.get(key);
  };
  for (let restart = 0; restart < 8; restart++) {
    const restartPlan = restart === 0 ? initial : greedy(i, random) ?? best.legs.map(l => l.routes);
    let current = restartPlan.map(rs => [...rs]);
    let loads = i.households.map(h => current.flat().filter(r => r.driverId === h.id).reduce((s, r) => s + r.minutes, 0)), value = score(loads);
    if (value < best.J - 1e-9) best = schedule(i, current);
    const startTemp = Math.max(12, best.J / Math.max(1, i.legs.length) * 0.7);
    for (let step = 0; step < iterations; step++) {
      const li = pick(i.legs.length), l = i.legs[li]!, old = current[li]!;
      if (!old.length) continue;
      const draft = old.map(r => ({ d: r.driverId, stops: [...r.stops] })), a = pick(draft.length), source = draft[a]!, move = pick(4);
      if (move === 0) { // relocate one whole household stop, optionally opening a route
        const h = source.stops.splice(pick(source.stops.length), 1)[0]!, d = l.driverIds[pick(l.driverIds.length)]!;
        let target = draft.find(r => r.d === d);
        if (!target) { target = { d, stops: [] }; draft.push(target); }
        target.stops.splice(pick(target.stops.length + 1), 0, h);
      } else if (move === 1) { // swap stops across routes
        const b = pick(draft.length); if (a === b) continue;
        const target = draft[b]!, x = pick(source.stops.length), y = pick(target.stops.length);
        [source.stops[x], target.stops[y]] = [target.stops[y]!, source.stops[x]!];
      } else if (move === 2) { // 2-opt reversal or or-opt contiguous block insertion
        const x = pick(source.stops.length), y = pick(source.stops.length);
        const lo = Math.min(x, y), hi = Math.max(x, y);
        if (random() < 0.5) source.stops.splice(lo, hi - lo + 1, ...source.stops.slice(lo, hi + 1).reverse());
        else { const block = source.stops.splice(lo, hi - lo + 1); source.stops.splice(pick(source.stops.length + 1), 0, ...block); }
      } else { // replace with a free available driver
        const d = l.driverIds[pick(l.driverIds.length)]!;
        if (draft.some(r => r.d === d)) continue;
        source.d = d;
      }
      const next: Route[] = []; let valid = true;
      for (const r of draft) if (r.stops.length) {
        if (!free(i, current, li, r.d)) { valid = false; break; }
        const evaluated = getRoute(li, r.d, r.stops);
        if (!evaluated) { valid = false; break; } next.push(evaluated);
      }
      if (!valid) continue;
      const newLoads = [...loads];
      for (const r of old) newLoads[driverIndex.get(r.driverId)!]! -= r.minutes;
      for (const r of next) newLoads[driverIndex.get(r.driverId)!]! += r.minutes;
      const newValue = score(newLoads), temp = startTemp * Math.pow(0.005 / startTemp, step / iterations);
      if (newValue <= value + 1e-9 || random() < Math.exp((value - newValue) / temp)) {
        current[li] = next; loads = newLoads; value = newValue;
        if (value < best.J - 1e-9) best = schedule(i, current);
      }
    }
  }
  // Canonical ordering makes the serialized result independent of route creation order.
  best = schedule(i, best.legs.map(l => [...l.routes].sort((a, b) => a.driverId < b.driverId ? -1 : a.driverId > b.driverId ? 1 : 0)));
  return best;
}
