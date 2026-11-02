import type { Instance } from '../src/model.js';
import { defaults } from '../src/model.js';
// Separate fixture PRNG: the test corpus does not depend on solver PRNG behavior.
export function rng(seed: number): () => number { return () => { seed = Math.imul(1664525, seed) + 1013904223 | 0; return (seed >>> 0) / 4294967296; }; }
export function tiny(seed: number, micro = false): Instance {
  const r = rng(seed), mode = seed % 6;
  const n = micro ? 1 + seed % 4 : [2, 3, 4, 6, 3, 2][mode]!;
  const m = Math.min(n, micro ? 2 : 2 + seed % 2);
  const count = micro ? 1 + seed % 2 : [4, 2, 2, 1, 2, 3][mode]!;
  const households = Array.from({ length: n }, (_, j) => ({ id: `h${j}`, name: `Family ${j}`, placeId: `p${j}`, seats: n + 2 }));
  const kids = households.flatMap((h, j) => Array.from({ length: (seed + j) % 5 === 0 ? 2 : 1 }, (_, k) => ({ id: `k${j}_${k}`, name: `Kid ${j}.${k}`, householdId: h.id })));
  const i: Instance = {
    places: [...households.map((h) => ({ id: h.placeId, x: Math.round(r() * 20) / 10, y: Math.round(r() * 20) / 10 })), { id: 'v', x: 2, y: 2 }],
    households, kids, venues: [{ id: 'v', name: 'Field', placeId: 'v' }],
    legs: Array.from({ length: count }, (_, j) => ({ id: `l${j}`, day: j, venueId: 'v', dir: (j + seed) % 2 ? 'from' : 'to', kidIds: kids.map(k => k.id), driverIds: households.slice(0, m).map(h => h.id), winStart: j * 1440 + 900, winEnd: j * 1440 + 960 })),
    params: { ...defaults, lambda: [0, 0.25, 0.5, 1, 2, 3][Math.floor(seed / 6) % 6]!, seed, maxRide: 45 },
    history: Object.fromEntries(households.map(h => [h.id, Math.floor(r() * 21) - 10]))
  };
  // Directed, nonmetric overrides are explicitly supported and exercised.
  if (seed % 7 === 0) i.travelOverride = Object.fromEntries(i.places.map(a => [a.id, Object.fromEntries(i.places.map(b => [b.id, a.id === b.id ? 0 : 1 + Math.floor(r() * 6)]))]));
  if (mode === 4 && !micro) { i.legs[1]!.day = 0; i.legs[1]!.winStart = 930; i.legs[1]!.winEnd = 980; }
  return i;
}
export function symmetric(families = 3, legs = 1): Instance {
  return {
    places: [{ id: 'home', x: 0, y: 0 }, { id: 'field', x: 2, y: 0 }],
    households: Array.from({ length: families }, (_, j) => ({ id: `h${j}`, name: `Family ${j}`, placeId: 'home', seats: families })),
    kids: Array.from({ length: families }, (_, j) => ({ id: `k${j}`, name: `Kid ${j}`, householdId: `h${j}` })),
    venues: [{ id: 'v', name: 'Field', placeId: 'field' }],
    legs: Array.from({ length: legs }, (_, j) => ({ id: `l${j}`, day: j, venueId: 'v', dir: j % 2 ? 'from' : 'to', kidIds: Array.from({ length: families }, (_, j) => `k${j}`), driverIds: Array.from({ length: families }, (_, j) => `h${j}`), winStart: j * 1440 + 900, winEnd: j * 1440 + 960 })),
    params: { ...defaults, lambda: 3, seed: 42 }, history: {}
  };
}
export function performanceWeek(): Instance {
  const r = rng(808), i = symmetric(12, 0);
  i.places = [...i.households.map((h, j) => { h.placeId = `p${j}`; h.seats = 4; return { id: h.placeId, x: r() * 4, y: r() * 4 }; }), { id: 'field', x: 2, y: 2 }];
  i.legs = Array.from({ length: 10 }, (_, j) => ({ id: `l${j}`, day: Math.floor(j / 2), venueId: 'v', dir: j % 2 ? 'from' : 'to', kidIds: i.kids.map(k => k.id), driverIds: i.households.slice(0, 6).map(h => h.id), winStart: Math.floor(j / 2) * 1440 + 900 + j % 2 * 150, winEnd: Math.floor(j / 2) * 1440 + 960 + j % 2 * 150 }));
  return i;
}
