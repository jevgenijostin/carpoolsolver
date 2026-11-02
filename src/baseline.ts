import type { Instance, Route, Schedule } from './model.js';
import { overlap, route, schedule, stopsFor } from './core.js';
export interface BaselineResult { schedule?: Schedule; reason?: string }
/** Rotate the first driver by leg index, assign stops in input order; no geography
 * optimization. If this naive assignment fails, report that instead of a bad plan. */
export function naiveRoundRobin(i: Instance): BaselineResult {
  const routes: Route[][] = [];
  for (let li = 0; li < i.legs.length; li++) {
    const l = i.legs[li]!, rs: Route[] = [], available = i.households.map(h => h.id).filter(d => l.driverIds.includes(d) && !routes.some((old, j) => overlap(l, i.legs[j]!) && old.some(r => r.driverId === d)));
    const drivers = [...available.slice(li % Math.max(1, available.length)), ...available.slice(0, li % Math.max(1, available.length))];
    for (const h of stopsFor(i, l)) {
      let inserted = false;
      for (const d of drivers) {
        const index = rs.findIndex(r => r.driverId === d), r = route(i, l, d, [...(rs[index]?.stops ?? []), h]);
        if (r) { if (index < 0) rs.push(r); else rs[index] = r; inserted = true; break; }
      }
      if (!inserted) return { reason: `Naive assignment failed on ${l.id}` };
    }
    routes.push(rs);
  }
  return { schedule: schedule(i, routes) };
}
export function spread(i: Instance, s: Schedule): number {
  const loads = i.households.map(h => (i.history[h.id] ?? 0) + (s.loads[h.id] ?? 0));
  return Math.max(...loads) - Math.min(...loads);
}
