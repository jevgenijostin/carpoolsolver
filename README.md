# CarpoolSolver

Local-first TypeScript engine for weekly youth-sport carpools. Includes a seeded weekly solver, independent validator, bounded exact oracle, signed-minute fairness ledger, naive baseline, JSON I/O, parent messages, browser Web Worker, and verified **U10 Tigers** CLI demo (9 kids, 6 households, 2 venues, 5 legs). No server or external routing service is required. UI and G10 are deferred.

**Acceptance status: 8/9 green; G7 red.** The exact ledger formula in the brief contradicts its claimed conservation rule for nonzero history sums. The implementation preserves the formula and the gate reports the failure. `npm run gates` exits **1**, and both CI matrix jobs must remain red for this failure. See the explanation below; no gate is skipped or marked expected-failure.

## Run

Node.js 24 recommended (CI uses 24).

```sh
npm ci
npx playwright install chromium
npm run gates
npm run demo
# Optional instance JSON input:
node dist/src/cli.js fixtures/u10-tigers.json
```

On Linux, use `npx playwright install --with-deps chromium`. `npm run build` type-checks in strict mode and emits Node ESM/declarations in `dist/src` and self-contained browser modules in `dist/web`. Chromium is used solely to test the actual engine Web Worker; there is no UI or G10 implementation.

Gate measurements are written to [`reports/gates.json`](reports/gates.json), including OS, CPU, Node version, raw timings, failures, and sample counts. All 300 heuristic/oracle comparisons, with seeds and dimensions, are in [`reports/oracle-comparison.json`](reports/oracle-comparison.json). GitHub Actions runs the same command on **ubuntu-latest and windows-latest**, fails on any red gate, and always uploads the measurements and runs the demo. No `continue-on-error`.

## Model

Canonical strict types: [`src/model.ts`](src/model.ts). All times are integer minutes. Coordinates are planar kilometers; IDs are nonempty strings.

```ts
Place     { id, x, y }
Household { id, name, placeId, seats } // passenger seats, excludes driver
Kid       { id, name, householdId }
Venue     { id, name, placeId }
Leg       { id, day, venueId, dir: 'to' | 'from', kidIds, driverIds,
            winStart, winEnd }
Params    { speedKmh: 28, detour: 1.3, dwell: 2, maxRide: 45,
            lambda: 0.5, seed }
History   { [householdId]: signedIntegerMinutes }
Instance  { places, households, kids, venues, legs, params, history,
            travelOverride? }
Schedule  { status: 'ok' | 'infeasible', reason?,
            legs: [{ legId, routes: [{ driverId, stops, kidIds, minutes }] }],
            loads: { [driverId]: minutes }, J, F }
```

Days are 0=Monday through 6=Sunday. Windows are minute-of-week within that day and **closed intervals**: touching endpoints overlap. Windows reserve driver availability; they are not route-departure timestamps and do not impose an additional duration constraint. One household supplies one driver, identified by household ID. All households in the pool participate in the objective, including those unavailable to drive that week. Missing history is zero. Siblings on a leg are an indivisible household stop. Empty legs have no routes; drivers with no routes have zero load.

`travelOverride`, if supplied, is a complete `Record<placeId, Record<placeId, integerMinutes>>`, with zero diagonal and positive off-diagonal entries. Directed and nonmetric matrices are allowed. Otherwise:

```text
t(a,b) = a == b ? 0 : max(1, round(distKm(a,b) * detour / speedKmh * 60))
```

The Zod schema rejects unknown keys, duplicate IDs, dangling references, invalid windows, duplicate riders/drivers, fractional times/history, negative seats, and malformed matrices. Imports produce readable paths. The six non-seed parameters have the specified defaults; seed is a uint32. Lambda is nonnegative; the planned UI slider range is [0,3], not an engine restriction.

## Routes and objective

Outbound: driver home → ordered household stops → venue. Return: venue → ordered household stops → driver home.

```text
minutes = sum t(consecutive places) + dwell * stops not at driver's home place
L_d = sum route minutes driven by d
w_d = max(1, number of d's kids in the pool)
W = sum w_d
S = sum (H_d + L_d)
mu = S / W
F = sum |W*(H_d + L_d) - w_d*S| / W
J = sum L_d + lambda*F
```

The absolute-value numerator is calculated on integer values before division. Outbound in-car time begins on arrival at pickup and includes that stop's dwell through venue arrival. Return in-car time ends on arrival at drop-off, before that stop's dwell; the driver-only trip home still counts toward driving load. No dwell at the driver's home place, including co-located households. Each route must satisfy passenger capacity, hard driver availability, and every rider's ride cap. A driver cannot serve overlapping legs or two routes on the same leg. Each leg's kids must appear exactly once, and a household cannot be split between routes.

The validator independently recomputes travel, ride times, coverage, capacity, windows, loads and the objective. Its only dependency is the model. G1 walks its transitive TypeScript import graph (including dynamic imports), rejecting any solver/oracle dependency or unaudited external import.

## Solver

[`src/solver/index.ts`](src/solver/index.ts) has no oracle dependency.

1. Start with greedy insertion: stops sorted farthest from venue first; select the cheapest feasible driver and insertion position by extra driving minutes.
2. Run seeded mulberry32 simulated annealing over the whole week, with **8 restarts**. Later restarts randomize leg order and driver cost biases to explore different feasible assignments, including disconnected overlap assignments.
3. Propose stop relocation to another driver/position, inter-route stop swaps, or-opt block insertion / 2-opt reversal, or replacement by a free available driver. All infeasible moves are rejected; there are no constraint penalties.
4. Retain the best true weekly objective and canonicalize route order for serialization.

The **2-second search target** is implemented as a deterministic work budget: 6,000 proposals per restart for tiny-shaped instances and 2,200 for larger weeks. It is deliberately not a wall-clock cutoff, which would make byte-identical cross-runtime results impossible. G8 measures the actual time on a 10-leg × 12-stop × 6-driver week and enforces the hard median ≤3 seconds. Runtime is hardware-dependent; arbitrary huge inputs are not promised a hard 2-second bound. Feasible-route evaluation is cached within one solve.

If greedy fails, an exhaustive feasibility repair explores whole-stop assignments and route insertion orders, honoring driver conflicts. It finds a feasible initial plan or proves failure before returning a reason. Partial ride-cap pruning is disabled in this repair because an inserted stop can shorten a nonmetric override path. This fallback can be expensive on large infeasible instances; it is not an optimal-objective search. Failures have no partial plan (`legs: []`, `loads: {}`, J=F=0):

| Code | Payload / meaning |
| --- | --- |
| `NO_DRIVER` | `legId`: riders but no available drivers |
| `CAPACITY_SHORT` | `legId`: whole-household rider groups cannot fit the available seats |
| `RIDE_CAP` | `kidId`: capacity is sufficient but no ride-feasible leg partition exists; identifies an individually impossible rider where possible, otherwise an affected rider in that leg |
| `OVERLAP` | Every leg is individually feasible, but no joint driver assignment avoids overlapping windows |

Use imported/schema-validated instances at API boundaries. Browser integration runs the solver off the main thread:

```js
const worker = new Worker('/dist/web/solver/worker.js', { type: 'module' });
worker.onmessage = ({ data }) => {
  // { id, schedule } or { id, error }; independently validate before confirmation.
  console.log(data);
};
worker.postMessage({ id: 'week-1', instance });
```

The main-thread export exists for tests/CLI. The browser bundle has no Node dependencies, network calls, or telemetry. A separate `worker_threads` adapter supports Node tests.

## Exact oracle and limits

**Oracle-only bound: ≤6 household stops per leg, ≤3 distinct available drivers across the instance, ≤4 legs.** Out-of-bound calls throw. The shipped solver makes **no optimality claim beyond or within these limits**; its observed agreement is a measured test result.

Per leg/driver, Held–Karp subset DP retains elapsed-time labels and route witnesses. Return paths grow forward; outbound paths grow backward from the venue so ride caps become suffix checks. Equal `(mask, last, elapsed)` labels have identical continuations and can be deduplicated. Every distinct feasible route duration is retained, including nonminimal ones: a longer route can improve fairness.

The usual minimum-cost Held–Karp baseline is O(m·2^n·n²). Retaining **all duration labels** adds a label-count factor; claiming the minimum-only complexity for this fairness-exact implementation would be incorrect. Subset partitioning lifts `g_k(mask)` to sets of driver increment vectors, enumerating every submask (O(m·3^n) before vector multiplicity). It does **not** dominance-prune larger loads.

Across legs, reachable sets are Minkowski sums of per-leg vectors. Deduplication keys include integer load vectors plus driver assignments on past legs whose windows can conflict with future legs. Keeping this overlap signature prevents discarding necessary assignment alternatives with the same load. The final objective selects the best reachable vector. Reachable-set size is data-dependent and can grow substantially even within the tiny bounds. The independent brute-force test separately enumerates assignments and permutations, computes route timing and objective itself, and shares no oracle/solver/core logic.

## Ledger: exact formula and the red gate

Confirmation validates the plan, then applies exactly:

```text
H'_d = H_d + L_d - round(w_d * mu)
mu = sum(H + L) / W
```

Positive H means over-driven. JavaScript `Math.round` defines half ties toward +∞. Storage adapters default to `localStorage` under `carpoolsolver.history.v1`; signed-integer history is JSON-exportable/importable. Confirmation is an explicit organizer action; solving never updates history.

The brief also states `|sum H' - sum H| <= drivers/2`. This cannot hold for arbitrary allowed histories with the given formula:

```text
sum H' = S - sum round(w_d*S/W) ≈ 0
```

It recenters the sum near **zero**, not near the previous sum. G7 demonstrates a valid 3-family history `{h0:10,h1:10,h2:10}` whose sum changes **30 → 0**, a **30-minute** change against the **1.5-minute** allowance. The separate 8-week symmetric simulations at lambda=0.5 rotate scarce driving duties; both family counts stay within one typical leg (6 minutes), with zero observed weekly rounding slack. Those passing subchecks do not turn G7 green.

Resolving this requires a specification decision: either change the conservation claim to `|sum H'| <= drivers/2`, or change the update to subtract `round(w_d * sum(L)/W)` if preserving the incoming sum is the intended invariant. Neither change has been silently applied.

## Gates and measured results

The seeded G2 corpus includes both directions, siblings, nonzero signed history, lambda 0 through 3, directed nonmetric overrides, and overlapping legs. Its six dimension strata cover 2 stops/4 legs, 3/2, 4/2, 6/1, overlapping 3/2, and 2/3, with up to 3 drivers. Seeds are 1–300; the corpus and thresholds were unchanged while improving the solver. G1 uses separate seeds 1000–1199. This is evidence on a declared corpus, not a proof of heuristic optimality.

| Gate | Status | Measured result |
| --- | --- | --- |
| G1 | PASS | 200/200 valid random plans; 30/30 schedule corruptions rejected with their expected codes (5 each of 6 kinds); import graph isolated; 3 accounting corruptions and 9 adversarial regressions |
| G2 | PASS | 300/300 exact matches (100%); 0 below oracle; maximum gap 0%; maximum reachable set 4,325 states |
| G3 | PASS | 50/50 micro-instance exact agreements (100%); multiple route-duration labels explicitly retained |
| G4 | PASS | 10/10 instances byte-identical across repeated Node main, Node worker, Chromium main, and actual Chromium module worker |
| G5 | PASS | 20/20 constructed failures correctly diagnosed (100%; 5 per reason), also confirmed infeasible by oracle |
| G6 | PASS | 100/100 adjacent lambda comparisons; 8 symmetric cases with spread 0 against typical-leg bound 6 min |
| G7 | **FAIL** | 2 × 8-week simulations: spread ≤6 min, slack 0; nonzero-history case changes sum by 30 min, allowance 1.5 min |
| G8 | PASS | Median **282.78 ms** (limit 3,000 ms); five runs: 247.34, 273.23, 282.78, 334.82, 288.84 ms |
| G9 | PASS | 21/21 exact JSON round-trips; 10/10 malformed inputs rejected readably; 1 fixed parent-message golden snapshot; ledger storage/JSON and naive demo validation |

G8's timings are measurements, not constants asserted by the test. Gate output records every individual run. CI reruns all gates on both operating systems; measured timing may differ.

## Demo and files

`fixtures/u10-tigers.json` is the portable demo input. The CLI prints only a successfully validated plan (or an infeasible reason), weekly loads/F/J, comparison against naive round-robin, and a message for every parent. The baseline rotates the starting driver by leg order and fills stops in input order without geography optimization, while respecting feasibility. If naive insertion fails it reports failure rather than presenting an invalid comparison. Spread means max minus min of H+L.

| Path | Purpose |
| --- | --- |
| `src/model.ts`, `src/io.ts` | Strict types, Zod import/export |
| `src/validator/` | Independent schedule validator |
| `src/solver/` | Seeded heuristic, Web Worker and Node adapter |
| `src/oracle/` | Labelled Held–Karp, vector partition and weekly exact search |
| `src/ledger.ts` | Validated week confirmation, localStorage and JSON |
| `src/demo.ts`, `src/cli.ts` | U10 Tigers fixture and verified CLI |
| `src/baseline.ts`, `src/messages.ts` | Naive comparison and parent messages |
| `tests/` | Real gates, independent brute force, seeded fixtures, regressions |
| `reports/` | Raw gate and per-instance measurements |

MIT licensed.
