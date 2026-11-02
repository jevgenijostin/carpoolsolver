import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:http';
import { cpus, platform, arch } from 'node:os';
import { Worker as NodeWorker } from 'node:worker_threads';
import { chromium } from 'playwright';
import ts from 'typescript';
import { solve } from '../src/solver/index.js';
import { oracle, heldKarp } from '../src/oracle/index.js';
import { validate, type ValidationCode } from '../src/validator/index.js';
import { confirmWeek, exportHistory, importHistory, saveHistory, loadHistory } from '../src/ledger.js';
import { exportInstance, importInstance } from '../src/io.js';
import { parentMessage } from '../src/messages.js';
import { demo } from '../src/demo.js';
import { naiveRoundRobin } from '../src/baseline.js';
import { schedule, route, stopsFor } from '../src/core.js';
import type { Instance, Schedule } from '../src/model.js';
import { tiny, symmetric, performanceWeek } from './fixtures.js';
import { brute } from './brute.js';
import { regressions } from './regressions.js';

type Stats = Record<string, unknown>;
interface Gate { id: string; pass: boolean; seconds: number; stats: Stats; error?: string }
const results: Gate[] = [];
async function gate(id: string, action: (stats: Stats) => void | Promise<void>): Promise<void> {
  const stats: Stats = {}, start = performance.now(); let error: string | undefined;
  try { await action(stats); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const result: Gate = { id, pass: error === undefined, seconds: (performance.now() - start) / 1000, stats, ...(error ? { error } : {}) };
  results.push(result); console.log(JSON.stringify(result));
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/gates.json', JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, gates: results }, null, 2) + '\n');
}
function checked(i: Instance, s: Schedule): void { assert.equal(s.status, 'ok', JSON.stringify(s.reason)); assert.deepEqual(validate(i, s), { valid: true, errors: [] }); }
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  function walk(file: string): void {
    file = resolve(file); if (seen.has(file)) return; seen.add(file);
    assert(!/[\\/](solver|oracle)[\\/]/.test(file), 'Validator imports forbidden implementation: ' + file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      let spec: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) spec = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        assert(node.arguments[0] && ts.isStringLiteral(node.arguments[0]), 'Computed imports are forbidden in validator graph'); spec = (node.arguments[0] as ts.StringLiteral).text;
      }
      if (spec) { assert(spec.startsWith('.'), 'Validator graph must use only local, audited dependencies'); walk(resolve(dirname(file), spec.replace(/\.js$/, '.ts'))); }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  walk(entry); return [...seen].map(p => p.replaceAll('\\', '/').split('/carpoolsolver/').at(-1)!);
}

await gate('G1', stats => {
  stats.importGraph = importGraph('src/validator/index.ts');
  let valid = 0;
  for (let n = 0; n < 200; n++) { const i = tiny(1000 + n); checked(i, solve(i)); valid++; }
  stats.randomOutputs = valid;
  const rejected: Record<string, number> = {};
  for (let n = 0; n < 5; n++) {
    for (const code of ['MISSING_KID', 'DUPLICATE_KID', 'CAPACITY', 'UNAVAILABLE_DRIVER', 'OVERLAP', 'RIDE_CAP'] as ValidationCode[]) {
      const base = symmetric(3, 2); base.params.seed = n; base.places[1]!.x += n / 5;
      let routes = base.legs.map(l => [route(base, l, 'h0', ['h0', 'h1', 'h2'])!]);
      if (code === 'CAPACITY') {
        base.households.forEach(h => h.seats = 2);
        routes = base.legs.map(l => [route(base, l, 'h0', ['h0', 'h1'])!, route(base, l, 'h1', ['h2'])!]);
      }
      if (code === 'UNAVAILABLE_DRIVER') base.legs[0]!.driverIds = ['h0'];
      if (code === 'OVERLAP') {
        base.legs[1]!.day = 0; base.legs[1]!.winStart = base.legs[0]!.winEnd; base.legs[1]!.winEnd = 990;
        routes[1] = [route(base, base.legs[1]!, 'h1', ['h0', 'h1', 'h2'])!];
      }
      if (code === 'RIDE_CAP') {
        base.places = [{ id: 'p0', x: 0, y: 0 }, { id: 'p1', x: 1, y: 0 }, { id: 'p2', x: 2, y: 0 }, { id: 'field', x: 3 + n / 10, y: 0 }];
        base.households.forEach((h, j) => h.placeId = `p${j}`); base.params.maxRide = 10;
        routes = base.legs.map(l => base.households.map(h => route(base, l, h.id, [h.id])!));
      }
      const validSchedule = schedule(base, routes); checked(base, validSchedule);
      const corrupt = structuredClone(validSchedule), first = corrupt.legs[0]!.routes[0]!;
      if (code === 'MISSING_KID') first.kidIds.pop();
      if (code === 'DUPLICATE_KID') first.kidIds.push(first.kidIds[0]!);
      if (code === 'CAPACITY') { first.stops.push('h2'); first.kidIds.push('k2'); corrupt.legs[0]!.routes.pop(); }
      if (code === 'UNAVAILABLE_DRIVER') first.driverId = 'h1';
      if (code === 'OVERLAP') corrupt.legs[1]!.routes[0]!.driverId = 'h0';
      if (code === 'RIDE_CAP') {
        const relaxed = { ...base, params: { ...base.params, maxRide: 999 } };
        corrupt.legs[0]!.routes = [route(relaxed, base.legs[0]!, 'h0', ['h2', 'h1', 'h0'])!];
      }
      const errors = validate(base, corrupt); assert(!errors.valid); assert(errors.errors.some(e => e.code === code), `${code}: ${JSON.stringify(errors)}`); rejected[code] = (rejected[code] ?? 0) + 1;
    }
  }
  stats.mutations = rejected; stats.correctRejections = Object.values(rejected).reduce((a, b) => a + b, 0);
  // Additional numeric/accounting corruption, outside the required 30.
  const i = symmetric(), s = solve(i);
  for (const code of ['MINUTES', 'LOADS', 'OBJECTIVE'] as const) {
    const bad = structuredClone(s);
    if (code === 'MINUTES') bad.legs[0]!.routes[0]!.minutes++;
    else if (code === 'LOADS') bad.loads.h0!++; else bad.J++;
    assert(validate(i, bad).errors.some(e => e.code === code));
  }
  stats.accountingMutations = 3;
  stats.adversarialRegressions = regressions();
});

await gate('G2', stats => {
  let matches = 0, below = 0, maxGap = 0, feasible = 0, maxStates = 0;
  const misses: unknown[] = [], records: unknown[] = [];
  for (let seed = 1; seed <= 300; seed++) {
    const i = tiny(seed), exact = oracle(i), h = solve(i), o = exact.schedule;
    assert(o, `Corpus seed ${seed} must be feasible`); checked(i, o); checked(i, h); feasible++;
    maxStates = Math.max(maxStates, ...exact.reachableCounts);
    if (h.J < o.J - 1e-8) below++;
    const gap = o.J === 0 ? (h.J === 0 ? 0 : Infinity) : (h.J - o.J) / o.J;
    maxGap = Math.max(maxGap, gap);
    if (Math.abs(h.J - o.J) < 1e-8) matches++; else misses.push({ seed, heuristic: h.J, oracle: o.J, gapPercent: gap * 100 });
    records.push({ seed, stops: i.legs.map(l => stopsFor(i, l).length), drivers: new Set(i.legs.flatMap(l => l.driverIds)).size, legs: i.legs.length, lambda: i.params.lambda, heuristic: h.J, oracle: o.J, gapPercent: gap * 100 });
    if (seed % 50 === 0) console.log(`G2 progress ${seed}/300: ${matches} exact, max gap ${(maxGap * 100).toFixed(3)}%`);
  }
  writeFileSync('reports/oracle-comparison.json', JSON.stringify(records, null, 2) + '\n');
  Object.assign(stats, { instances: feasible, matches, matchPercent: matches / 3, belowOracle: below, maxGapPercent: maxGap * 100, maxReachableStates: maxStates, misses });
  assert.equal(below, 0); assert(matches >= 285, `${matches}/300 <95%`); assert(maxGap <= 0.05 + 1e-9, `Max gap ${maxGap * 100}% >5%`);
});

await gate('G3', stats => {
  let matches = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const i = tiny(2000 + seed, true); if (seed % 5 === 0) i.params.maxRide = 7;
    const a = oracle(i).schedule, b = brute(i);
    assert.equal(Boolean(a), Boolean(b), `Feasibility mismatch seed ${seed}`);
    if (a && b) { checked(i, a); checked(i, b); assert(Math.abs(a.J - b.J) < 1e-9, `seed ${seed}: ${a.J} vs ${b.J}`); }
    matches++;
  }
  stats.microInstances = matches; stats.exactAgreementPercent = matches * 2;
  // Explicitly require retention of nonminimal route durations.
  const i = tiny(3), table = heldKarp(i, i.legs[0]!, i.legs[0]!.driverIds[0]!);
  const count = Math.max(...[...table.values()].map(rs => rs.length)); assert(count > 1);
  stats.maxDistinctDurationsForOneSubset = count;
});

await gate('G4', async stats => {
  const server = createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Engine worker test</title>'); return; }
    const files: Record<string, string> = { '/worker.js': 'dist/web/solver/worker.js', '/engine.js': 'dist/web/browser.js' };
    const file = files[req.url ?? '']; if (!file) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); assert(address && typeof address !== 'string');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const nodeWorker = new NodeWorker(new URL('../src/solver/node-worker.js', import.meta.url));
  try {
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`);
    let matched = 0;
    for (let n = 0; n < 10; n++) {
      const i = n === 9 ? demo() : tiny(3000 + n), expected = JSON.stringify(solve(i));
      assert.equal(JSON.stringify(solve(i)), expected);
      const nodeResult = await new Promise<{ schedule: Schedule }>((resolve, reject) => {
        nodeWorker.once('message', resolve); nodeWorker.once('error', reject); nodeWorker.postMessage({ id: String(n), instance: i });
      });
      assert.equal(JSON.stringify(nodeResult.schedule), expected);
      const browserResults = await page.evaluate(async (instance) => {
        const url = '/engine.js'; const engine = await import(url) as { solve: (i: Instance) => Schedule };
        const main = JSON.stringify(engine.solve(instance));
        const worker = new Worker('/worker.js', { type: 'module' });
        const background = await new Promise<string>((resolve, reject) => {
          worker.onerror = e => reject(new Error(e.message));
          worker.onmessage = e => { if (e.data.error) reject(new Error(e.data.error)); else resolve(JSON.stringify(e.data.schedule)); };
          worker.postMessage({ id: 'check', instance });
        });
        worker.terminate(); return { main, background };
      }, i);
      assert.equal(browserResults.main, expected); assert.equal(browserResults.background, expected); matched++;
    }
    stats.instances = matched; stats.byteIdenticalPercent = 100; stats.runtimes = ['Node main x2', 'Node worker_threads', 'Chromium main', 'Chromium module Web Worker']; stats.chromium = browser.version();
  } finally { await nodeWorker.terminate(); await browser?.close(); await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r())); }
});

await gate('G5', stats => {
  const counts: Record<string, number> = {};
  for (let n = 0; n < 5; n++) for (const code of ['CAPACITY_SHORT', 'NO_DRIVER', 'RIDE_CAP', 'OVERLAP'] as const) {
    const i = symmetric(3, code === 'OVERLAP' ? 2 : 1); i.params.seed = n;
    if (code === 'CAPACITY_SHORT') i.households.forEach(h => h.seats = 0);
    if (code === 'NO_DRIVER') i.legs[0]!.driverIds = [];
    if (code === 'RIDE_CAP') i.params.maxRide = 1;
    if (code === 'OVERLAP') { i.legs.forEach(l => { l.driverIds = ['h0']; l.day = 0; l.winStart = 900; l.winEnd = 960; }); }
    const s = solve(i); assert.equal(s.status, 'infeasible'); assert.equal(s.reason?.code, code); assert.equal(s.legs.length, 0); assert.equal(oracle(i).schedule, undefined);
    if (code === 'RIDE_CAP') { const reason = s.reason; assert(reason && 'kidId' in reason); assert(i.kids.some(k => k.id === reason.kidId)); }
    counts[code] = (counts[code] ?? 0) + 1;
  }
  stats.cases = counts; stats.correctPercent = 100;
});

await gate('G6', stats => {
  const grid = [0, 0.25, 0.5, 1, 2, 3]; let comparisons = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const i = tiny(4000 + seed, true); let previous: Schedule | undefined;
    for (const lambda of grid) {
      i.params.lambda = lambda; const s = oracle(i).schedule!; checked(i, s);
      if (previous) { assert(s.F <= previous.F + 1e-9); assert(Object.values(s.loads).reduce((a, b) => a + b, 0) >= Object.values(previous.loads).reduce((a, b) => a + b, 0)); comparisons++; }
      previous = s;
    }
  }
  const symmetricResults: unknown[] = [];
  for (const families of [2, 3]) for (const legs of [1, 2, 3, 4]) {
    const i = symmetric(families, legs), s = oracle(i).schedule!; checked(i, s);
    const values = i.households.map(h => (i.history[h.id] ?? 0) + s.loads[h.id]!), spread = Math.max(...values) - Math.min(...values), typical = route(i, i.legs[0]!, 'h0', i.households.map(h => h.id))!.minutes;
    assert(spread <= typical); symmetricResults.push({ families, legs, spread, typicalLegMinutes: typical });
  }
  Object.assign(stats, { lambdaGrid: grid, instances: 20, monotonicComparisons: comparisons, violations: 0, symmetricResults });
});

await gate('G7', stats => {
  let maxWeeklySlack = 0, maxCumulativeSpread = 0;
  const weeks: unknown[] = [];
  for (const families of [2, 3]) {
    const i = symmetric(families, 1), cumulative = i.households.map(() => 0);
    i.params.lambda = 0.5; // Exercise rotation of a scarce weekly duty, not all families driving every week.
    const typical = route(i, i.legs[0]!, 'h0', i.households.map(h => h.id))!.minutes;
    for (let week = 1; week <= 8; week++) {
      const s = solve(i); checked(i, s); const next = confirmWeek(i, s);
      const slack = Math.abs(Object.values(next).reduce((a, b) => a + b, 0) - Object.values(i.history).reduce((a, b) => a + b, 0));
      maxWeeklySlack = Math.max(maxWeeklySlack, slack);
      const total = Object.values(s.loads).reduce((a, b) => a + b, 0);
      i.households.forEach((h, j) => cumulative[j]! += s.loads[h.id]! - total / families);
      const spread = Math.max(...cumulative) - Math.min(...cumulative); maxCumulativeSpread = Math.max(maxCumulativeSpread, spread);
      weeks.push({ families, week, slack, cumulativeAdjustedSpread: spread, typicalLegMinutes: typical });
      assert(slack <= families / 2 + 1e-9); assert(spread <= typical + 1e-9); i.history = next;
    }
  }
  // Test the literal supplied claim on a legitimate signed integer history.
  const i = symmetric(3, 1); i.history = { h0: 10, h1: 10, h2: 10 };
  const s = solve(i), next = confirmWeek(i, s), beforeSum = 30, afterSum = Object.values(next).reduce((a, b) => a + b, 0), slack = Math.abs(afterSum - beforeSum);
  Object.assign(stats, { sequentialWeeks: weeks, maxWeeklySlack, maxCumulativeSpread, nonzeroHistory: { beforeSum, afterSum, slack, allowedSlack: 1.5 }, exactFormulaImplemented: true });
  assert(slack <= 1.5, `Brief contradiction: exact update changes history sum ${beforeSum} -> ${afterSum}, slack ${slack} >1.5`);
});

await gate('G8', stats => {
  const i = performanceWeek(), timings: number[] = [];
  for (let run = 0; run < 5; run++) { const start = performance.now(), s = solve(i); timings.push(performance.now() - start); checked(i, s); }
  const median = [...timings].sort((a, b) => a - b)[2]!;
  Object.assign(stats, { legs: 10, stopsPerLeg: 12, availableDrivers: 6, runsMs: timings, medianMs: median, limitMs: 3000 }); assert(median <= 3000, `Median ${median}ms >3000ms`);
});

await gate('G9', stats => {
  const samples = [demo(), ...Array.from({ length: 20 }, (_, n) => tiny(5000 + n))];
  for (const i of samples) assert.deepEqual(importInstance(exportInstance(i)), i);
  const malformed: string[] = ['{', '{}', JSON.stringify({ ...demo(), surprise: true })];
  for (const mutate of [
    (i: Instance) => { i.households[0]!.seats = -1; },
    (i: Instance) => { i.kids[0]!.householdId = 'missing'; },
    (i: Instance) => { i.legs[0]!.winStart = 1.5; },
    (i: Instance) => { i.legs[0]!.kidIds.push(i.legs[0]!.kidIds[0]!); },
    (i: Instance) => { i.travelOverride = {}; },
    (i: Instance) => { i.history.unknown = 1; },
    (i: Instance) => { i.places[0]!.x = Infinity; }
  ]) { const i = demo(); mutate(i); malformed.push(JSON.stringify(i)); }
  const errors: string[] = [];
  for (const json of malformed) assert.throws(() => importInstance(json), (e: unknown) => { assert(e instanceof Error); errors.push(e.message); return /Invalid (JSON|instance):/.test(e.message); });
  const i = symmetric(2, 2), s = schedule(i, i.legs.map(l => [route(i, l, 'h0', ['h0', 'h1'])!])); checked(i, s);
  assert.equal(parentMessage(i, s, 'h0') + '\n', readFileSync('fixtures/parent-message.txt', 'utf8').replaceAll('\r\n', '\n'));
  const storage = new Map<string, string>(), adapter = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); } };
  const history = { h0: -15, h1: 15 }; saveHistory(history, adapter); assert.deepEqual(loadHistory(adapter), history); assert.deepEqual(importHistory(exportHistory(history)), history);
  assert.throws(() => importHistory('{"h0":1.5}'));
  const baseline = naiveRoundRobin(demo()); assert(baseline.schedule); checked(demo(), baseline.schedule);
  Object.assign(stats, { roundTrips: samples.length, malformedRejected: errors.length, readableErrors: errors, goldenSnapshots: 1, historyStorageRoundTrip: true, demoBaselineValidated: true });
});

console.log(`${results.filter(r => r.pass).length}/9 gates green. Full measurements: reports/gates.json`);
if (results.some(r => !r.pass)) process.exitCode = 1;
