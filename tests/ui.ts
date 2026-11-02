import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import ICAL from 'ical.js';

export async function uiGate(): Promise<Record<string, unknown>> {
  const server = createServer((req, res) => {
    const path = resolve('dist/app', '.' + (req.url === '/' ? '/index.html' : (req.url ?? '').split('?')[0]));
    if (!path.startsWith(resolve('dist/app') + '/') && !path.startsWith(resolve('dist/app') + '\\')) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' } as Record<string, string>)[extname(path)] ?? 'application/octet-stream'); res.end(readFileSync(path)); } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch();
  const errors: string[] = [], external: string[] = [];
  const started = performance.now();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
    context.on('request', req => { if (!req.url().startsWith(origin + '/') && !req.url().startsWith('data:') && !req.url().startsWith('blob:')) external.push(req.url()); });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    let workers = 0; page.on('worker', () => workers++);
    await page.goto(origin);
    await page.getByRole('button', { name: 'Load demo', exact: true }).click();
    assert.equal(await page.getByRole('heading', { name: 'Your team, in place' }).count(), 1);
    const solveStart = performance.now();
    await page.getByRole('button', { name: 'Solve week →', exact: true }).click();
    await page.getByTestId('verified').waitFor();
    const solveMs = performance.now() - solveStart;
    assert.equal(await page.getByTestId('result-leg').count(), 5);
    await page.getByLabel('Efficiency to fairness').fill('2');
    await page.getByTestId('verified').waitFor();
    assert.equal(await page.getByTestId('lambda').textContent(), 'λ 2.00');
    assert(workers >= 2, 'Both solves must use actual workers');
    await page.getByRole('button', { name: 'Messages/Export', exact: true }).click();
    let copied = 0;
    for (const name of ['Adler', 'Bauer', 'Chen', 'Diaz', 'Evans', 'Fischer']) {
      await page.getByRole('button', { name: `Copy ${name} message`, exact: true }).click();
      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      assert(clipboard.startsWith(`${name} — weekly carpool`)); assert(clipboard.includes('Your driving:')); copied++;
    }
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download ICS', exact: true }).click();
    const file = await event; const path = await file.path(); assert(path);
    const content = readFileSync(path, 'utf8');
    const parsed = new ICAL.Component(ICAL.parse(content));
    const events = parsed.getAllSubcomponents('vevent').map(c => new ICAL.Event(c));
    assert.equal(events.length, 5); assert.equal(new Set(events.map(e => e.uid)).size, 5);
    for (const e of events) { assert(e.startDate.compare(e.endDate) < 0); assert(e.summary.includes('U10 Tigers')); assert(e.description.includes('stops')); }
    const jsonEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const jsonFile = await jsonEvent; const jsonPath = await jsonFile.path(); assert(jsonPath);
    const exported = JSON.parse(readFileSync(jsonPath, 'utf8')) as { instance: { legs: unknown[] }; schedule: { status: string } };
    assert.equal(exported.instance.legs.length, events.length); assert.equal(exported.schedule.status, 'ok');
    await page.getByRole('button', { name: 'Ledger', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm week', exact: true }).click();
    assert(await page.getByRole('button', { name: 'Week confirmed ✓' }).isDisabled());
    await page.reload();
    await page.getByRole('button', { name: 'Ledger', exact: true }).click();
    assert(await page.getByRole('button', { name: 'Week confirmed ✓' }).isDisabled());
    // Exercise editable inputs and invalidation, not just the seeded happy path.
    await page.getByRole('button', { name: 'Roster & Places', exact: true }).click();
    const before = await page.getByLabel('X (km)', { exact: true }).inputValue();
    await page.getByRole('img', { name: 'Click to place selected home or venue' }).click({ position: { x: 150, y: 120 } });
    assert.notEqual(await page.getByLabel('X (km)', { exact: true }).inputValue(), before);
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    for (const name of ['Bauer', 'Chen', 'Diaz', 'Fischer']) await page.getByLabel(`${name} available leg0`).uncheck();
    await page.getByRole('button', { name: 'Solve week →', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert((await page.getByRole('alert').textContent())!.includes('NO_DRIVER'));
    assert.equal(await page.getByTestId('verified').count(), 0);
    await page.getByRole('button', { name: 'Load demo', exact: true }).click();
    await page.getByRole('button', { name: 'Solve week →', exact: true }).click();
    await page.getByTestId('verified').waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout must not overflow');
    mkdirSync('reports', { recursive: true });
    await page.screenshot({ path: 'reports/ui-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: 'reports/ui-desktop.png', fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    return { chromium: browser.version(), viewport: '390×844 + 1440×1000', solveMs, elapsedMs: performance.now() - started, resultLegs: 5, lambda: 2, messagesCopied: copied, icsEvents: events.length, expectedEvents: exported.instance.legs.length, icsParsed: true, jsonDownloaded: true, persistedConfirmation: true, duplicateConfirmationBlocked: true, placementEdited: true, infeasibilityDisplayed: true, mobileOverflow: false, workers, consoleErrors: errors.length, externalRequests: external.length };
  } finally { await browser.close(); await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r())); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const stats = await uiGate(); mkdirSync('reports', { recursive: true }); writeFileSync('reports/g10.json', JSON.stringify(stats, null, 2) + '\n'); console.log(JSON.stringify(stats, null, 2));
}
