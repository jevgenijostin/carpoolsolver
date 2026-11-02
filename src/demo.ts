import type { Instance } from './model.js';
import { defaults } from './model.js';
export function demo(): Instance {
  const names = ['Adler', 'Bauer', 'Chen', 'Diaz', 'Evans', 'Fischer'];
  const coordinates = [[0, 0], [1, 0.6], [2, 0], [0.5, 2], [2.5, 1.5], [3, 3]];
  const households = names.map((name, n) => ({ id: `h${n}`, name, placeId: `p${n}`, seats: [4, 3, 4, 3, 4, 3][n]! }));
  const kidNames = ['Alex', 'Ava', 'Ben', 'Cara', 'Cleo', 'Diego', 'Ella', 'Finn', 'Freya'];
  const homes = [0, 0, 1, 2, 2, 3, 4, 5, 5];
  const kids = kidNames.map((name, n) => ({ id: `k${n}`, name, householdId: `h${homes[n]}` }));
  return {
    places: [...coordinates.map(([x, y], n) => ({ id: `p${n}`, x: x!, y: y! })), { id: 'field', x: 4, y: 1 }, { id: 'hall', x: 1, y: 4 }],
    households, kids, venues: [{ id: 'v0', name: 'Tiger Field', placeId: 'field' }, { id: 'v1', name: 'Sports Hall', placeId: 'hall' }],
    legs: [0, 1, 2, 3, 4].map((n) => ({ id: `leg${n}`, day: n < 2 ? 1 : n < 4 ? 3 : 5, venueId: n < 2 ? 'v0' : 'v1', dir: n % 2 ? 'from' : 'to', kidIds: kids.map(k => k.id), driverIds: households.filter((_, j) => (j + n) % 4 !== 0).map(h => h.id), winStart: (n < 2 ? 1 : n < 4 ? 3 : 5) * 1440 + (n % 2 ? 1110 : 990), winEnd: (n < 2 ? 1 : n < 4 ? 3 : 5) * 1440 + (n % 2 ? 1155 : 1035) })),
    params: { ...defaults, seed: 20261102 }, history: { h0: 20, h1: -10, h2: 8, h3: -12, h4: -6, h5: 0 }
  };
}
