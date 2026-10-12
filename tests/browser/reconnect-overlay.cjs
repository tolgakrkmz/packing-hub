/* Connection UI against an isolated server and fictional drafts only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
async function exerciseReconnectOverlay({admin, base, hub, expect, screenshotDir}) {
  console.log('RUN reconnect visual, snapshot barrier, preserved drafts and bounded timeout');
  await admin.context().addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url, options) { super(url, options); if (url === '/api/events') window.__reconnectSource = this; }
    };
  });
  const emit = type => admin.evaluate(type => {
    const source = window.__reconnectSource;
    source.dispatchEvent(type === 'version' ? new MessageEvent('version', {data:JSON.stringify({version:window.HUB_SERVER_BOOT.version})}) : new Event(type));
  }, type);
  const overlay = admin.locator('#serverReconnectOverlay');
  async function ready() {
    await expect(admin.locator('#serverState')).toHaveAttribute('data-connection', 'ready');
    await expect(overlay).toBeHidden();
  }
  async function geometry(width, height) {
    const metrics = await overlay.evaluate(node => {
      const card = node.querySelector('.server-reconnect-card').getBoundingClientRect(), rect = node.getBoundingClientRect();
      return {card:{left:card.left,right:card.right,top:card.top,bottom:card.bottom},rect:{width:rect.width,height:rect.height},pointerEvents:getComputedStyle(node).pointerEvents,
        pageWidth:document.documentElement.scrollWidth, backdrop:getComputedStyle(node).backdropFilter, background:getComputedStyle(node).backgroundColor};
    });
    assert.equal(metrics.rect.width,width); assert.equal(metrics.rect.height,height);
    assert.ok(metrics.card.left >= 0 && metrics.card.right <= width + 1 && metrics.card.top >= 0 && metrics.card.bottom <= height + 1, 'Reconnect card fits configured viewport');
    assert.ok(metrics.pageWidth <= width + 1, 'Reconnect visual does not expand mobile viewport');
    assert.equal(metrics.pointerEvents,'none'); return metrics;
  }
  await admin.goto(base + '/production-log'); await ready();
  await expect(admin.locator('#connDot')).toHaveClass(/\bon\b/);
  await admin.locator('#dateInput').fill('2026-10-05');
  await admin.locator('#tonInput').fill('417'); await admin.locator('#tonInput').focus();
  const data = hub.store.get('production-log');
  hub.store.put('production-log', {...data.data,entries:[{id:'demo-reconnect-report',date:'2026-10-05',shift:'СТИКЕРИ',tonnage:1250,brak:10}]}, data.revision, hub.auth.list()[0]);
  let release, reads = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const holdSnapshot = async route => { reads++; await gate; await route.continue(); };
  await admin.route('**/api/data/production-log',holdSnapshot);
  try {
    await emit('error'); await emit('open'); await emit('version');
    await expect.poll(() => reads).toBe(1); await expect(overlay).toBeVisible();
    await expect(admin.locator('#serverState')).toHaveAttribute('data-connection','ready');
    await expect(admin.locator('#tonInput')).toHaveValue('417');
    assert.equal(await admin.evaluate(() => document.activeElement.id),'tonInput');
    await admin.locator('#tonInput').fill('418'); // The decorative layer never intercepts editing.
    await expect(admin.locator('#tonInput')).toHaveValue('418');
    for (const [width,height] of [[320,640],[390,844],[768,700],[1440,900],[844,390],[640,320]]) {
      await admin.setViewportSize({width,height});
      for (const language of ['bg','en']) {
        await admin.evaluate(language => HubI18n.setLanguage(language),language);
        await expect(overlay.locator('.server-reconnect-message')).toHaveText(language === 'en' ? 'Reconnecting…' : 'Възстановяване на връзката…');
        await expect(overlay.locator('.server-reconnect-note')).toHaveText(language === 'en' ? 'Checking the connection and current data.' : 'Проверяваме връзката и актуалните данни.');
        const metrics = await geometry(width,height); assert.equal(metrics.backdrop,'blur(6px)');
      }
      if (screenshotDir && [390,1440].includes(width)) {
        fs.mkdirSync(screenshotDir,{recursive:true});
        await admin.screenshot({path:path.join(screenshotDir,width === 390 ? 'reconnect-mobile.png' : 'reconnect-desktop.png')});
      }
    }
    await admin.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await overlay.locator('.server-reconnect-ring').evaluate(node => getComputedStyle(node).animationName),'none');
    assert.equal(await overlay.evaluate(node => getComputedStyle(node).animationName),'none');
    const fallback = await admin.addStyleTag({content:'.server-reconnect-overlay{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'});
    const metrics = await geometry(640,320); assert.equal(metrics.backdrop,'none'); assert.notEqual(metrics.background,'rgba(0, 0, 0, 0)');
    await fallback.evaluate(node => node.remove()); await admin.emulateMedia({reducedMotion:'no-preference'});
    release(); await ready(); await expect(admin.locator('#dayVal')).toHaveText('1250 kg');
    await expect(admin.locator('#tonInput')).toHaveValue('418'); assert.equal(reads,1);
  } finally { release(); await admin.unroute('**/api/data/production-log',holdSnapshot); }

  // Native socket interruption proves the EventSource wiring beyond synthetic events.
  let allowStream, streamAttempts = 0;
  const streamGate = new Promise(resolve => { allowStream = resolve; });
  const holdStream = async route => { streamAttempts++; await streamGate; await route.continue(); };
  await admin.route('**/api/events',holdStream);
  try {
    hub.server.closeAllConnections();
    await expect(admin.locator('#serverState')).toHaveAttribute('data-connection','pending');
    await expect(overlay).toBeVisible();
    await expect.poll(() => streamAttempts).toBe(1);
    allowStream(); await ready();
  } finally { allowStream(); await admin.unroute('**/api/events',holdStream); }

  await emit('error'); await expect(overlay).toBeVisible();
  await admin.clock.runFor(8000); await expect(overlay).toBeHidden();
  await expect(admin.locator('#serverState')).toHaveAttribute('data-connection','pending');
  await admin.locator('#tonInput').fill('419'); await emit('open'); await emit('version'); await ready();
  await expect(admin.locator('#tonInput')).toHaveValue('419');

  let resumeRelease, resumedReads = 0;
  const resumeGate = new Promise(resolve => { resumeRelease = resolve; });
  const resumeSnapshot = async route => { resumedReads++; await resumeGate; await route.continue(); };
  await admin.route('**/api/data/production-log',resumeSnapshot);
  try {
    await admin.evaluate(() => {
      let hidden = true;
      Object.defineProperty(document,'hidden',{configurable:true,get:() => hidden}); document.dispatchEvent(new Event('visibilitychange'));
      hidden = false; document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
    });
    await expect.poll(() => resumedReads).toBe(1); await expect(overlay).toBeVisible();
    resumeRelease(); await ready(); assert.equal(resumedReads,1);
  } finally { resumeRelease(); await admin.unroute('**/api/data/production-log',resumeSnapshot); await admin.evaluate(() => { delete document.hidden; }); }

  await admin.goto(base + '/tasks'); await ready(); await expect(admin.locator('#newTask')).toBeVisible();
  await admin.locator('#newTask').click(); await admin.locator('#taskTitle').fill('Fictional reconnect draft');
  await emit('error'); await expect(overlay).toBeVisible();
  await expect(admin.locator('#taskEditor')).toBeVisible(); assert.equal(await admin.evaluate(() => document.activeElement.id),'taskTitle');
  await admin.locator('#taskTitle').fill('Fictional usable reconnect draft');
  await emit('open'); await emit('version'); await ready();
  await expect(admin.locator('#taskEditor')).toBeVisible(); await expect(admin.locator('#taskTitle')).toHaveValue('Fictional usable reconnect draft');
  assert.equal(await admin.evaluate(() => document.activeElement.id),'taskTitle'); await admin.keyboard.press('Escape');

  await admin.goto(base + '/report-history'); await expect(overlay).toHaveCount(0);
  await admin.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})); });
  await expect(overlay).toHaveCount(0); assert.equal(await admin.evaluate(() => !!window.__reconnectSource),false);
  await admin.goto(base + '/login'); await expect(overlay).toHaveCount(0);
  const offline = await admin.context().newPage();
  try {
    await offline.route(base + '/offline-reconnect.html',route => route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../../production-log.html'),'utf8')}));
    await offline.goto(base + '/offline-reconnect.html'); await expect(offline.locator('#serverReconnectOverlay')).toHaveCount(0);
    assert.equal(await offline.evaluate(() => typeof HubServer),'undefined');
  } finally { await offline.close(); }
  console.log('PASS real SSE interruption/reconnect, held snapshots, unique foreground refresh, preserved report/task drafts and focus, eight-second cap, BG/EN, 320–1440px/landscape, reduced motion, blur fallback and manual/login/offline exclusions');
}
module.exports = {exerciseReconnectOverlay};
