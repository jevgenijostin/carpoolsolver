import assert from 'node:assert/strict';
import type { Instance } from '../src/model.js';
import { defaults } from '../src/model.js';
import { route, schedule, travel } from '../src/core.js';
import { oracle } from '../src/oracle/index.js';
import { solve } from '../src/solver/index.js';
import { validate } from '../src/validator/index.js';
import { importInstance, exportInstance } from '../src/io.js';
import { symmetric } from './fixtures.js';

/** Adversarial hand calculations supplement randomized agreement tests. */
export function regressions(): number {
  let count = 0;
  const i: Instance = {
    places: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'v', x: 2, y: 0 }],
    households: [{ id: 'a', name: 'A', placeId: 'a', seats: 2 }, { id: 'b', name: 'B', placeId: 'b', seats: 2 }],
    kids: [{ id: 'ka', name: 'A kid', householdId: 'a' }, { id: 'kb', name: 'B kid', householdId: 'b' }],
    venues: [{ id: 'v', name: 'V', placeId: 'v' }],
    legs: [{ id: 'l', day: 0, venueId: 'v', dir: 'to', kidIds: ['ka', 'kb'], driverIds: ['a'], winStart: 100, winEnd: 200 }],
    params: { ...defaults, speedKmh: 60, detour: 1, maxRide: 4, seed: 1 }, history: {},
    travelOverride: { a: { a: 0, b: 1, v: 10 }, b: { a: 1, b: 0, v: 1 }, v: { a: 1, b: 1, v: 0 } }
  };
  assert.equal(route(i, i.legs[0]!, 'a', ['a']), undefined);
  // Inserting b reduces a's ride from 10 to 4; repair must not prune that prefix.
  const s = solve(i); assert.equal(s.status, 'ok'); assert.equal(s.J, oracle(i).schedule!.J); assert(validate(i, s).valid); count++;
  const out = route(i, i.legs[0]!, 'a', ['a', 'b'])!; assert.equal(out.minutes, 4); count++;
  i.params.maxRide = 3; assert.equal(route(i, i.legs[0]!, 'a', ['a', 'b']), undefined); count++;
  i.legs[0]!.dir = 'from';
  const inbound = route(i, i.legs[0]!, 'a', ['a', 'b'])!;
  assert.equal(inbound.minutes, 5); assert(validate(i, schedule(i, [[inbound]])).valid); count++; // Drop-off occurs before dwell; homeward driver-only travel doesn't count.
  delete i.travelOverride;
  assert.equal(travel(i, 'a', 'a'), 0); assert.equal(travel(i, 'a', 'b'), 1); i.places[1]!.x = 0; assert.equal(travel(i, 'a', 'b'), 1); count++;
  const empty = symmetric(3, 0); assert.deepEqual(solve(empty).loads, { h0: 0, h1: 0, h2: 0 }); assert(validate(empty, solve(empty)).valid); count++;
  const farDriver = symmetric(2, 1);
  // Driver indexing must not depend on a <=30 bound on all pool households.
  for (let n = 0; n < 35; n++) farDriver.households.unshift({ id: `unused${n}`, name: 'Unused', placeId: 'home', seats: 0 });
  const exact = oracle(farDriver).schedule!; assert(validate(farDriver, exact).valid); count++;
  const bounded = symmetric(4, 1); assert.throws(() => oracle(bounded), /Oracle bound/); count++;
  const input = symmetric(2, 1); input.params.lambda = 20; assert.deepEqual(importInstance(exportInstance(input)), input); count++;
  return count;
}
