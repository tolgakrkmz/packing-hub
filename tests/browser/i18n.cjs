/* Real-DOM regression checks use presentation labels and fictional user values only. */
const assert = require('node:assert/strict');
async function exerciseI18n({page,expect}) {
  await page.evaluate(() => {
    HubI18n.setLanguage('bg');
    const host = document.createElement('section'); host.id='i18nRegression';
    host.innerHTML='<p id="i18nLabel" title="Месечен резултат">Тонаж и брак</p>'
      +'<div translate="no"><span id="i18nPrivate">Тонаж и брак</span></div>'
      +'<div data-i18n="no"><span id="i18nIgnored">Месечен резултат</span></div>'
      +'<div data-i18n-exact><span id="i18nExact">Материал от Демо зона</span></div>'
      +'<select id="i18nOptions"><option>Месечен резултат</option><option value="stable-id">Тонаж и брак</option></select>'
      +'<input id="i18nInput" placeholder="Месечен резултат" value="Тонаж и брак">'
      +'<span id="i18nFileConnText">Свързан с: Тонаж и брак.json</span><div id="i18nDynamic"></div><!-- Fictional marker -->';
    document.body.append(host);
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>HubI18n.setLanguage('en'));
  await expect(page.locator('#i18nLabel')).toHaveText('Production & Scrap');
  await expect(page.locator('#i18nLabel')).toHaveAttribute('title','Monthly Result');
  await expect(page.locator('#i18nPrivate')).toHaveText('Тонаж и брак');
  await expect(page.locator('#i18nExact')).toHaveText('Материал от Демо зона');
  await expect(page.locator('#i18nInput')).toHaveValue('Тонаж и брак');
  await expect(page.locator('#i18nInput')).toHaveAttribute('placeholder','Monthly Result');
  assert.deepEqual(await page.locator('#i18nOptions').evaluate(select=>[...select.options].map(option=>option.value)),['Месечен резултат','stable-id']);
  await expect(page.locator('#i18nFileConnText')).toContainText('Тонаж и брак.json');
  // Both subtree insertion and edits to an existing text node must translate.
  await page.evaluate(()=>{
    document.getElementById('i18nDynamic').innerHTML='<p id="i18nAdded">Месечен резултат</p><select><option id="i18nAddedOption">Тонаж и брак</option></select>';
    document.getElementById('i18nLabel').firstChild.nodeValue='Месечен резултат';
    document.getElementById('i18nLabel').title='Тонаж и брак';
    document.getElementById('i18nPrivate').textContent='Месечен резултат';
    document.getElementById('i18nIgnored').textContent='Тонаж и брак';
    document.getElementById('i18nRegression').lastChild.nodeValue='Месечен резултат';
  });
  await expect(page.locator('#i18nAdded')).toHaveText('Monthly Result');
  await expect(page.locator('#i18nAddedOption')).toHaveText('Production & Scrap');
  await expect(page.locator('#i18nAddedOption')).toHaveAttribute('value','Тонаж и брак');
  await expect(page.locator('#i18nLabel')).toHaveText('Monthly Result');
  await expect(page.locator('#i18nLabel')).toHaveAttribute('title','Production & Scrap');
  await expect(page.locator('#i18nPrivate')).toHaveText('Месечен резултат');
  await expect(page.locator('#i18nIgnored')).toHaveText('Тонаж и брак');
  assert.equal(await page.locator('#i18nRegression').evaluate(host=>host.lastChild.nodeValue),'Месечен резултат','DOM comments are not presentation text');
  await page.evaluate(()=>HubI18n.setLanguage('bg'));
  await expect(page.locator('#i18nLabel')).toHaveText('Месечен резултат');
  await expect(page.locator('#i18nLabel')).toHaveAttribute('title','Тонаж и брак');
  await expect(page.locator('#i18nAddedOption')).toHaveText('Тонаж и брак');
  await page.evaluate(()=>{
    // A queued update followed by a language change retains the new source text.
    document.getElementById('i18nLabel').firstChild.nodeValue='Тонаж и брак';
    HubI18n.setLanguage('en');
  });
  await expect(page.locator('#i18nLabel')).toHaveText('Production & Scrap');
  // Changing one text/attribute must leave unrelated existing subtrees unvisited.
  const visits = await page.evaluate(async()=>{
    const unrelated=document.createElement('div'); unrelated.id='i18nUnrelated';
    unrelated.innerHTML='<span>Месечен резултат</span>'.repeat(1000); document.body.append(unrelated);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    let visits=0; const original=Element.prototype.matches;
    Element.prototype.matches=function(...args){if(this===unrelated||unrelated.contains(this))visits++;return original.apply(this,args);};
    try {
      document.getElementById('i18nAdded').firstChild.nodeValue='Тонаж и брак';
      document.getElementById('i18nLabel').title='Месечен резултат';
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return visits;
    } finally {Element.prototype.matches=original; unrelated.remove();}
  });
  assert.equal(visits,0,'A small translation update must not traverse unrelated DOM');
  await expect(page.locator('#i18nAdded')).toHaveText('Production & Scrap');
  await expect(page.locator('#i18nLabel')).toHaveAttribute('title','Monthly Result');
  await page.evaluate(()=>{document.getElementById('i18nRegression').remove();HubI18n.setLanguage('bg');});
  console.log('PASS incremental translations, language roundtrips, excluded data, stable option/form values and unrelated DOM');
}
module.exports={exerciseI18n};
