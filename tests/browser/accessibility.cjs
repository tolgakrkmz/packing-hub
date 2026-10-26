/* Keyboard, focus, names and readability of the core flows. Fictional accounts and records only. */
const assert = require('node:assert/strict');
const {assertResponsive} = require('./responsive.cjs');

// Focusable controls and open dialogs without an accessible name, from Chrome's accessibility tree.
async function unnamedControls(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.getDocument', {depth: -1});
  const {nodes} = await cdp.send('Accessibility.getFullAXTree');
  const unnamed = [];
  for (const node of nodes) {
    const focusable = node.properties?.some(property => property.name === 'focusable' && property.value.value);
    if (node.ignored || !(focusable || node.role?.value === 'dialog') || node.name?.value?.trim() || ['RootWebArea', 'status'].includes(node.role?.value)) continue; // Status regions only take programmatic focus.
    const {node: element} = await cdp.send('DOM.describeNode', {backendNodeId: node.backendDOMNodeId});
    const attributes = element.attributes || [];
    unnamed.push(`${node.role?.value}:${element.localName}#${attributes.includes('id') ? attributes[attributes.indexOf('id') + 1] : ''}`);
  }
  await cdp.detach();
  return unnamed;
}

// WCAG AA text contrast against the nearest opaque background; decorative and disabled text is exempt.
function lowContrastText(page) {
  return page.evaluate(() => {
    const parse = value => { const match = value.match(/rgba?\(([^)]+)\)/); if (!match) return null; const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number); return {r, g, b, a}; };
    const luminance = ({r, g, b}) => [r, g, b].map(value => { value /= 255; return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const background = element => {
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.backgroundImage !== 'none') return null;
        const color = parse(style.backgroundColor);
        if (color && color.a > 0.9) return color;
      }
      return parse(getComputedStyle(document.body).backgroundColor);
    };
    return [...document.querySelectorAll('body *')].filter(element => element.checkVisibility({opacityProperty: true, visibilityProperty: true})
      && [...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()) && !element.closest('[aria-hidden=true], :disabled, [aria-disabled=true]'))
      .flatMap(element => {
        const style = getComputedStyle(element), fg = parse(style.color), bg = background(element);
        if (!fg || !bg) return [];
        const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a), ratio = (light + 0.05) / (dark + 0.05);
        const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
        return ratio < (large ? 3 : 4.5) ? [`${element.tagName.toLowerCase()}.${element.className} ${ratio.toFixed(2)}`] : [];
      });
  });
}

// Tab from the top of the page until focus wraps; every stop must show a focus indicator.
async function tabStops(page, limit = 80) {
  await page.evaluate(() => { document.activeElement?.blur(); for (const element of document.querySelectorAll('[data-a11y-stop]')) delete element.dataset.a11yStop; });
  const stops = [];
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      if (element.dataset.a11yStop) return {seen: true, again: element === window.a11yLastStop};
      element.dataset.a11yStop = '1'; window.a11yLastStop = element;
      const style = getComputedStyle(element);
      return {id: element.id || element.className, ring: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none'};
    });
    if (stop?.again) continue; // Date fields keep focus across their segments.
    if (!stop || stop.seen) break;
    stops.push(stop);
  }
  return {ids: stops.map(stop => stop.id), noRing: stops.filter(stop => !stop.ring).map(stop => stop.id)};
}

const focused = page => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);

async function checkPage(page, label, expected) {
  assert.deepEqual(await unnamedControls(page), [], label + ': accessible names');
  assert.deepEqual(await lowContrastText(page), [], label + ': text contrast');
  const walk = await tabStops(page);
  assert.deepEqual(walk.noRing, [], label + ': visible keyboard focus');
  for (const id of expected) assert.ok(walk.ids.includes(id), `${label}: ${id} reachable by Tab (${walk.ids.join(', ')})`);
  // Browser zoom shrinks the CSS viewport: 640 px is a 1280 px window at 200%, 320 px the same window at 400%.
  for (const width of [320, 390, 640]) {
    await page.setViewportSize({width, height: 800});
    await assertResponsive(page, `${label} ${width}px`);
  }
  await page.setViewportSize({width: 1280, height: 900});
}

async function exerciseAccessibility({admin, hub, base, device, expect}) {
  const operatorUser = await hub.auth.create('demo-a11y-operator', 'Fictional-password-123', 'operator', undefined, {canViewTasks: true}, undefined, {taskSupervisor: true, taskTeam: 'В'});
  const operator = await device(operatorUser.username);
  const routes = {'/': [], '/production-log': ['dateInput', 'tonInput', 'brakInput'], '/tasks': ['taskSearch', 'refreshTasks'], '/shift-closeout': ['closeoutDate', 'closeoutRefresh']};
  for (const [role, page] of [['admin', admin], ['operator', operator]]) {
    for (const language of ['bg', 'en']) {
      for (const [route, expected] of Object.entries(routes)) {
        if (role === 'operator' && route === '/shift-closeout') continue; // Not granted to this restricted role.
        await page.setViewportSize({width: 1280, height: 900});
        await page.goto(base + route);
        await page.locator(`[data-hub-language=${language}]`).click();
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        // The operator's own team В is preselected, so its form opens with the automatic / manual breakdown.
        const fields = role === 'operator' && route === '/production-log' ? expected.map(id => id === 'tonInput' ? 'autoKgInput' : id) : expected;
        await checkPage(page, `${role} ${language} ${route}`, role === 'admin' && route === '/tasks' ? ['newTask', ...fields] : fields);
      }
    }
    await page.locator('[data-hub-language=bg]').click();
  }
  console.log('PASS names, contrast, Tab order, focus rings, 320/390/640 px (400%/200% zoom) for BG/EN admin and operator');

  // Login: a keyboard submit keeps focus on the form after an error.
  const context = await admin.context().browser().newContext();
  const login = await context.newPage();
  await login.goto(base + '/login');
  await login.locator('#username').fill(operatorUser.username);
  await login.locator('#password').fill('Fictional-wrong-password');
  for (const language of ['bg', 'en']) {
    await login.locator(`[data-hub-language=${language}]`).click();
    await login.locator('#loginForm button[type=submit]').focus();
    await login.keyboard.press('Enter');
    await expect(login.locator('#loginMessage')).toHaveText(language === 'bg' ? 'Невалидно потребителско име или парола.' : 'Invalid username or password.');
    await expect(login.locator('#loginForm button[type=submit]')).toBeFocused();
    await expect(login.locator('#loginMessage')).toHaveAttribute('role', 'status');
  }
  await context.close();
  console.log('PASS login keyboard error keeps focus and announces status');

  // Tonnage: shift state without colour, keyboard save, and focus after failure and success.
  const operations = '**/api/reports/production-log/operations';
  const unavailable = route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"UNAVAILABLE"}'});
  for (const [role, page, team] of [['admin', admin, 'А'], ['operator', operator, 'Б']]) {
    await page.goto(base + '/production-log');
    const shift = page.locator(`.shift-btn[data-shift="${team}"]`);
    await shift.focus(); await page.keyboard.press('Space');
    await expect(shift).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.shift-btn[aria-pressed=true]')).toHaveCount(1);
    assert.equal(await shift.evaluate(element => getComputedStyle(element).textDecorationLine), 'underline', role + ': selected shift is marked without colour');
    if (role === 'operator') {
      // The restricted account learns why saving is blocked from text, not from a colour.
      await expect(page.locator('#productionAccessMessage')).toContainText('само за екип');
      await expect(page.locator('#saveBtn')).toBeDisabled();
      continue;
    }
    await page.locator('#autoKgInput').fill('1200');
    await expect(page.locator('#saveBtn')).toBeEnabled();
    await page.route(operations, unavailable);
    await page.locator('#saveBtn').focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#msg')).toContainText('Промяната не е потвърдена');
    await expect(page.locator('#retrySaveBtn')).toBeFocused();
    await page.unroute(operations, unavailable);
    await page.keyboard.press('Enter');
    await expect(page.locator('#msg')).toContainText('Записано');
    await expect(page.locator('#msg')).toBeFocused();
    await expect(page.locator('.shift-btn[aria-pressed=true]')).toHaveCount(0);
  }
  console.log('PASS tonnage shift state, keyboard save, retry focus and success focus');

  // Tasks: named dialogs, focus on open, Escape, server error and save.
  await admin.goto(base + '/tasks');
  for (const language of ['en', 'bg']) {
    await admin.locator(`[data-hub-language=${language}]`).click();
    await admin.locator('#newTask').focus(); await admin.keyboard.press('Enter');
    await expect(admin.locator('#taskEditor')).toBeVisible();
    await expect(admin.locator('#taskTitle')).toBeFocused();
    assert.deepEqual(await unnamedControls(admin), [], 'task editor dialog name ' + language);
    await admin.keyboard.press('Escape');
    await expect(admin.locator('#newTask')).toBeFocused();
  }
  await admin.keyboard.press('Enter');
  await admin.keyboard.type('Fictional keyboard task');
  await admin.locator('#taskRequiresPhotos').uncheck();
  await admin.locator('#taskOwner').selectOption(String(operatorUser.id));
  await admin.locator('#taskFrom').fill('2001-01-01');
  await admin.locator('#saveTask').focus(); await admin.keyboard.press('Enter');
  await expect(admin.locator('#editorFeedback')).not.toBeEmpty();
  await expect(admin.locator('#saveTask')).toBeFocused();
  await admin.locator('#taskKind').selectOption('global');
  await admin.locator('#taskDueDate').fill('2030-12-03');
  await admin.locator('#saveTask').focus(); await admin.keyboard.press('Enter');
  await expect(admin.locator('#taskEditor')).not.toBeVisible();
  await expect(admin.locator('#taskMessage')).toHaveText('Промяната е записана.');
  assert.notEqual(await focused(admin), 'BODY', 'focus kept after creating a task');

  await operator.goto(base + '/tasks');
  await operator.locator('[data-view=global]').click();
  const report = operator.locator('.task-card').filter({hasText: 'Fictional keyboard task'}).getByRole('button', {name: 'Отчети', exact: true});
  await report.focus(); await operator.keyboard.press('Enter');
  await expect(operator.locator('#taskAction')).toBeVisible();
  assert.deepEqual(await unnamedControls(operator), [], 'task action dialog name');
  await operator.keyboard.press('Escape');
  await expect(report).toBeFocused();
  await operator.keyboard.press('Enter');
  await operator.locator('#actionForm button[type=submit]').focus(); await operator.keyboard.press('Enter');
  await expect(operator.locator('#actionNote')).toBeFocused();
  await operator.keyboard.type('Fictional keyboard note');
  await operator.locator('#actionForm button[type=submit]').focus(); await operator.keyboard.press('Enter');
  await expect(operator.locator('#taskAction')).not.toBeVisible();
  await expect(operator.locator('#taskMessage')).toHaveText('Промяната е записана.');
  assert.notEqual(await focused(operator), 'BODY', 'focus kept after reporting a task');
  console.log('PASS task dialogs: names, open focus, Escape, error focus and save focus');

  // End of shift: the state is text, and a failed refresh keeps focus and announces the status.
  await admin.goto(base + '/shift-closeout');
  await expect(admin.locator('#closeoutProductionStatus')).not.toBeEmpty();
  await admin.route('**/api/shift-closeout?*', unavailable);
  await admin.locator('#closeoutRefresh').focus(); await admin.keyboard.press('Enter');
  await expect(admin.locator('#closeoutMessage')).toContainText('не са актуални');
  await expect(admin.locator('#closeoutMessage')).toHaveAttribute('role', 'status');
  await expect(admin.locator('#closeoutRefresh')).toBeFocused();
  await admin.unroute('**/api/shift-closeout?*', unavailable);
  console.log('PASS end-of-shift keyboard refresh, text status and error announcement');
}

module.exports = {exerciseAccessibility};
