# Ledger conservation fix — 2026-11-02

**9/9 gates pass locally and on both CI runners** after correcting the specification implemented at `9c4e439`.

Verified algebra: the old update subtracts shares summing to `sum(H + L)`, so it resets the ledger total toward zero. Carry-forward now uses `muCarry = sum(L)/W`; its total changes only by rounding error, bounded by households/2. The in-week objective remains `F = sum |W*(H+L) - w*sum(H+L)|/W`, `J = sum(L) + lambda*F`. The solver, core/oracle, independent validator, and brute-force reference retain that objective. No gate threshold was relaxed.

G7's original counterexample is now **30 → 30**, slack **0 ≤1.5 minutes**. Both 8-week simulations retain maximum weekly slack 0 and maximum cumulative adjusted spread 6 minutes against a 6-minute bound. New weights 2:1:1 exercise rounding with positive and negative history: **30 → 29** and **−21 → −22**, each slack **1 ≤1.5 minutes**.

Local full-suite command: `npm run gates` (exit 0), including strict TypeScript build and real Chromium main/worker checks. Windows x64, Intel Core Ultra 7 155U, Node v24.17.0, Chromium 156.0.8078.4. Raw results: [reports/gates.json](reports/gates.json); all 300 oracle comparisons: [reports/oracle-comparison.json](reports/oracle-comparison.json).

| Gate | Status | Measured result |
| --- | --- | --- |
| G1 | PASS | 200/200 valid random plans; 30/30 schedule corruptions rejected with their expected codes (5 each of 6 kinds); import graph isolated; 3 accounting corruptions and 9 adversarial regressions |
| G2 | PASS | 300/300 exact matches (100%); 0 below oracle; maximum gap 0%; maximum reachable set 4,325 states |
| G3 | PASS | 50/50 micro-instance exact agreements (100%); multiple route-duration labels explicitly retained |
| G4 | PASS | 10/10 instances byte-identical across repeated Node main, Node worker, Chromium main, and actual Chromium module worker |
| G5 | PASS | 20/20 constructed failures correctly diagnosed (100%; 5 per reason), also confirmed infeasible by oracle |
| G6 | PASS | 100/100 adjacent lambda comparisons; 8 symmetric cases with spread 0 against typical-leg bound 6 min |
| G7 | PASS | 2 × 8-week simulations: spread ≤6 min, slack 0; nonzero history 30 → 30; weighted signed histories have slack 1 ≤1.5 min |
| G8 | PASS | Median **148.0426 ms** (limit 3,000 ms); five runs: 140.6242, 148.0426, 137.9448, 170.4678, 196.3864 ms |
| G9 | PASS | 21/21 exact JSON round-trips; 10/10 malformed inputs rejected readably; 1 fixed parent-message golden snapshot; ledger storage/JSON and naive demo validation |

[GitHub Actions run 41525283866](https://github.com/jevgenijostin/carpoolsolver/actions/runs/41525283866) completed successfully on both Ubuntu and Windows for fix commit `b98570a01696d2b1cd0effc5f050b4879210d2c1`. Both ran all nine gates and the verified demo. Downloaded artifacts confirm the same G1–G7/G9 counts and results as the local table, including G7 30 → 30 (slack 0), weighted-history slack 1, and G2 300/300 optimum matches.

| Runner | Node | G8 median (ms) | Raw runs (ms) | Result |
| --- | --- | --- | --- | --- |
| ubuntu-latest | v24.22.1 | 122.480754 | 139.156140, 113.691966, 122.480754, 137.056485, 107.489914 | 9/9 PASS |
| windows-latest | v24.22.2 | 154.979700 | 181.553800, 154.979700, 146.438500, 158.803600, 124.839600 | 9/9 PASS |

Downloaded CI evidence: [Ubuntu](reports/ci/ubuntu.json), [Windows](reports/ci/windows.json). This report/evidence update changes no engine code, gate code, or CI configuration.
