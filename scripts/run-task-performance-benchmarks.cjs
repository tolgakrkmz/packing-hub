/* Loopback Chrome measurements; generated tasks/images, no production files or traces. */
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const baseline = process.argv.find(value => value.startsWith('--baseline='))?.slice('--baseline='.length);
let sourceRoot = root, archiveDir;
const baseCommit = execFileSync('git', ['rev-parse', '--verify', (baseline || 'HEAD') + '^{commit}'], {cwd: root}).toString().trim();
if (baseline) {
  archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-task-performance-baseline-'));
  execFileSync('tar', ['-x', '-C', archiveDir], {env: {...process.env, LC_ALL: 'C'}, input: execFileSync('git', ['archive', baseCommit], {cwd: root, maxBuffer: 32 * 1024 * 1024})});
  sourceRoot = archiveDir;
}
const {createHubServer} = require(path.join(sourceRoot, 'server/server.cjs'));
const {jpeg} = require(path.join(sourceRoot, 'server/task-photos.cjs'));
const median = values => Number([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(1));
const now = Date.parse('2026-10-12T10:00:00+03:00'), samples = 7, count = 2000;
async function main() {
  const hub = createHubServer({filename: ':memory:', publicOrigin: 'http://127.0.0.1:0', allowHttp: true, taskNow: () => now});
  let browser;
  try {
    const manager = await hub.auth.create('demo-task-performance', 'Fictional-performance-123', 'admin');
    await new Promise(resolve => hub.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + hub.server.address().port;
    browser = await chromium.launch({channel: 'chrome', headless: true});
    console.log(JSON.stringify({browser: browser.version(), node: process.version, baseCommit, archivedBaseline: !!baseline, trackedChanges: !baseline && execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: root}).length > 0, count, samples, network: 'loopback, no throttle', images: 'generated noise; 4 per card', limitations: 'CPU 4x simulation, no live server or phone'}));
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, timezoneId: 'Europe/Sofia'});
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await context.addInitScript(() => { window.setInterval = () => 0; });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', () => errors.push('Fictional task benchmark page error'));
    await page.goto(base + '/login');
    await page.locator('#username').fill(manager.username); await page.locator('#password').fill('Fictional-performance-123');
    await page.locator('button[type=submit]').click(); await page.waitForURL(base + '/');
    const data = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(canvas.width, canvas.height);
      let seed = 123;
      for (let i = 0; i < pixels.data.length; i += 4) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i] = seed & 255; pixels.data[i + 1] = seed >>> 8 & 255; pixels.data[i + 2] = seed >>> 16 & 255; pixels.data[i + 3] = 255; }
      ctx.putImageData(pixels, 0, 0);
      const binary = atob(canvas.toDataURL('image/jpeg', .3).split(',')[1]), parts = [binary.slice(0, 2)];
      for (let offset = 2; offset < binary.length;) {
        const marker = binary.charCodeAt(offset + 1);
        if (marker === 0xda) { parts.push(binary.slice(offset)); break; }
        const end = offset + 2 + (binary.charCodeAt(offset + 2) << 8) + binary.charCodeAt(offset + 3);
        if (!(marker >= 0xe0 && marker <= 0xef || marker === 0xfe)) parts.push(binary.slice(offset, end));
        offset = end;
      }
      return btoa(parts.join(''));
    });
    const image = jpeg(data), insert = hub.store.db.prepare('INSERT INTO task_items(id,data) VALUES(?,?)');
    const photoInsert = hub.store.db.prepare('INSERT INTO task_photos(id,content,created_at) VALUES(?,?,?)');
    const ids = [];
    hub.store.transaction(() => {
      for (let i = 0; i < count; i++) {
        const id = randomUUID(), problemPhotos = i < 50 ? Array.from({length: 4}, () => ({id: randomUUID(), at: now, bytes: image.content.length, width: image.width, height: image.height})) : [];
        for (const photo of problemPhotos) photoInsert.run(photo.id, image.content, now);
        const item = {id, kind: 'global', title: 'Fictional benchmark task ' + i, description: 'Generated task performance fixture', priority: 'normal', requiresPhotos: false,
          owner: {id: manager.id, username: manager.username, team: 'А'}, participants: [], status: 'pending', due: now + 86400000 + i * 60000, createdAt: now, updatedAt: now, problemPhotos,
          events: Array.from({length: 10}, (_, j) => ({at: now + j, actor: {id: manager.id, username: manager.username}, action: 'progress', note: 'Fictional progress ' + j}))};
        insert.run(id, JSON.stringify(item)); if (problemPhotos.length) ids.push({id, photo: problemPhotos[0].id});
      }
    });
    hub.tasks.maintain();
    const serverMs = [];
    for (let i = 0; i <= samples; i++) {
      const start = performance.now(); for (const item of ids.slice(0, 20)) hub.tasks.photo('items', item.id, item.photo, manager);
      if (i) serverMs.push(performance.now() - start);
    }
    console.log(JSON.stringify({action: '20 authorized photo reads', medianMs: median(serverMs), photoBytes: image.content.length}));
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', {rate: 4});
    let photoRequests = 0;
    page.on('request', request => { if (/\/api\/tasks\/items\/[^/]+\/photos\//.test(request.url())) photoRequests++; });
    await page.goto(base + '/tasks'); await page.locator('[data-view=global]').click();
    await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 50);
    await page.waitForTimeout(800);
    console.log(JSON.stringify({action: 'first viewport, 800ms after cards ready', requests: photoRequests, payloadKiB: Number((photoRequests * image.content.length / 1024).toFixed(1)), cardCount: 50, imageCount: 200}));
    for (const language of ['bg', 'en']) {
      await page.locator('[data-hub-language=' + language + ']').click();
      for (const action of ['same-view', 'search']) {
        const timings = [];
        for (let i = 0; i <= samples; i++) {
          const result = await page.evaluate(async ({action, i}) => {
            const content = document.getElementById('taskContent'), start = performance.now();
            const done = new Promise(resolve => { const observer = new MutationObserver(() => { observer.disconnect(); resolve(); }); observer.observe(content, {childList: true}); });
            if (action === 'same-view') document.querySelector('[data-view=global]').click();
            else { const input = document.getElementById('taskSearch'); input.value = i % 2 ? 'Fictional benchmark task 1' : 'Fictional'; input.dispatchEvent(new Event('input', {bubbles: true})); }
            await done; const resultsMs = performance.now() - start;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return {resultsMs, settledMs: performance.now() - start};
          }, {action, i});
          if (i) timings.push(result);
        }
        console.log(JSON.stringify({action, language, cpu: 4, resultsMs: median(timings.map(t => t.resultsMs)), settledMs: median(timings.map(t => t.settledMs))}));
      }
      await page.locator('#taskSearch').fill(''); await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 50);
    }
    assert.deepEqual(errors, []); await context.close();
  } finally { await browser?.close(); await hub.close(); if (archiveDir) fs.rmSync(archiveDir, {recursive: true, force: true}); }
}
main().catch(() => { console.error('Task performance benchmark failed; no task contents logged.'); process.exitCode = 1; });
