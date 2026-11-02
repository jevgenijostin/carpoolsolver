# Engine round report — 2026-11-02

Implemented the strict TypeScript engine, independent validator, labelled Held–Karp/vector oracle, seeded 8-restart heuristic, actual browser worker, ledger/localStorage/JSON adapters, naive baseline, parent messages, U10 Tigers JSON/demo CLI, G1–G9, MIT license, README, and Ubuntu/Windows CI. UI and G10 are deferred as requested.

**8/9 gates pass. G7 fails honestly.** The requested ledger formula is implemented exactly. With valid history `{h0:10,h1:10,h2:10}`, it changes total history from 30 to 0. That is a 30-minute change, exceeding the stated 1.5-minute conservation allowance. Changing either the formula or invariant requires a specification decision. The test exits nonzero and CI does not hide the failure.

Local measurements: Windows x64, Intel Core Ultra 7 155U, Node v24.17.0, Chromium 156.0.8078.4. Full raw output: [reports/gates.json](reports/gates.json). Seed-by-seed G2 output: [reports/oracle-comparison.json](reports/oracle-comparison.json).

| Gate | Status | Actual result |
| --- | --- | --- |
| G1 | PASS | 200 valid random outputs; 30 correct corruption rejections (5×6 types); isolated import graph; 3 additional accounting mutations; 9 adversarial regressions |
| G2 | PASS | 300/300 optimum matches, 100%; below-oracle violations 0; maximum gap 0%; largest reachable set 4,325 |
| G3 | PASS | 50/50 exact brute-force agreements; up to 16 distinct durations for one tested subset |
| G4 | PASS | 10/10 byte-identical across repeat Node main, Node worker, Chromium main, Chromium module Web Worker |
| G5 | PASS | 20/20 correct infeasibility reason codes, 100%; oracle confirms all failures |
| G6 | PASS | 100/100 monotonic lambda comparisons; 8 symmetric cases, spread 0 min ≤6 min |
| G7 | **FAIL** | Two 8-week simulations have max spread 6 min ≤6, weekly slack 0; arbitrary-history conservation counterexample has slack 30 >1.5 min |
| G8 | PASS | Median 279.1785 ms ≤3,000; five runs 274.2433, 272.0788, 298.8892, 279.1785, 305.4670 ms |
| G9 | PASS | 21 round-trips, 10 readable malformed-input rejections, 1 fixed golden message, history storage/JSON round-trips and validated baseline |

The initial G2 run matched 296/300 but failed the 5% maximum-gap ceiling (worst 18.42%). Diversified restart assignments and a higher annealing starting temperature fixed all four misses on the unchanged corpus. No threshold was relaxed and no oracle is called by the solver.

Final demo: independently valid; driving 225 min, F=2, J=226; naive baseline driving 297 min. Comparison: **72 fewer minutes**, adjusted-load spread **65 minutes lower**. Run `npm run demo` or `node dist/src/cli.js fixtures/u10-tigers.json` after building.

Important limitations: exact oracle restricted to ≤6 stops/leg, ≤3 available drivers total, ≤4 legs; heuristic optimality is not guaranteed. Determinism uses fixed work rather than wall-clock termination; the 2-second target is measured, not an arbitrary-input deadline. Exhaustive feasibility repair and oracle reachable-set enumeration can grow expensive. No UI is shipped in this round.

Publication and final CI results are recorded below after the remote jobs finish.
