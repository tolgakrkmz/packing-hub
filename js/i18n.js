/* Translate presentation text only. Form values, file contents and identifiers stay unchanged. */
const HubI18n = (() => {
  const messages = typeof HUB_EN_MESSAGES === 'object' ? HUB_EN_MESSAGES : {};
  const storageKey = typeof document === 'object' ? document.currentScript?.dataset.storageKey || 'hub-language' : 'hub-language';
  let language = 'bg';
  try { if (localStorage.getItem(storageKey) === 'en') language = 'en'; } catch (error) {}
  const normalize = value => String(value).trim().replace(/\s+/g, ' ');
  const keys = Object.keys(messages).sort((a, b) => b.length - a.length);
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('(?<![\\p{L}_])(?:' + keys.map(key => (/^\d/.test(key) ? '(?<!\\d)' : '') + escape(key).replace(/ /g, '\\s+')).join('|') + ')(?![\\p{L}_])', 'gu');
  function t(value, exact = false) {
    const text = String(value ?? '');
    if (language === 'bg') return text;
    if (exact) return Object.hasOwn(messages, normalize(text)) ? messages[normalize(text)] : text;
    return text.replace(pattern, match => {
      return Object.hasOwn(messages, normalize(match)) ? messages[normalize(match)] : match;
    });
  }
  function dialogText(value) {
    const quoted = [];
    const masked = String(value).replace(/"([^"]*)"/g, match => { quoted.push(match); return '\u0001' + (quoted.length - 1) + '\u0002'; });
    return t(masked).replace(/\u0001(\d+)\u0002/g, (_, index) => quoted[Number(index)]);
  }
  let apply = () => {};
  function setLanguage(value) {
    if (!['bg', 'en'].includes(value)) return;
    language = value;
    try { localStorage.setItem(storageKey, language); } catch (error) {}
    apply();
  }
  if (typeof document === 'object') {
    const textState = new WeakMap(), attributeState = new WeakMap();
    const excluded = 'script,style,textarea,code,pre,[translate="no"],[data-i18n="no"]';
    const attributes = ['title', 'placeholder', 'aria-label', 'alt'];
    let observer;
    function localizedText(value, element) {
      if (language === 'bg') return value;
      // File and folder names are user data, even when they contain familiar UI words.
      if (/ConnText$|^connText$/.test(element.id)) {
        const connected = value.match(/^(Свързан с(?: папка)?:\s*)([\s\S]*)$/);
        if (connected) return t(connected[1]) + connected[2];
        return dialogText(value);
      }
      return t(value, !!element.closest('[data-i18n-exact]'));
    }
    function translateAttribute(element, name) {
      if (!element.hasAttribute(name)) return;
      const remembered = attributeState.get(element) || {};
      const current = element.getAttribute(name), state = remembered[name];
      const original = state && state.last === current ? state.original : current;
      const translated = language === 'bg' ? original : t(original, !!element.closest('[data-i18n-exact]'));
      if (current !== translated) element.setAttribute(name, translated);
      remembered[name] = {original, last:translated};
      attributeState.set(element, remembered);
    }
    function translateText(node) {
      const current = node.nodeValue, state = textState.get(node);
      const original = state && state.last === current ? state.original : current;
      const translated = localizedText(original, node.parentElement);
      if (current !== translated) node.nodeValue = translated;
      textState.set(node, {original, last:translated});
    }
    function visit(element) {
      if (element.matches(excluded)) return;
      // Options without an explicit value otherwise inherit their translated label.
      if (element.tagName === 'OPTION' && !element.hasAttribute('value')) element.setAttribute('value', element.value);
      for (const name of attributes) translateAttribute(element, name);
      for (const child of element.childNodes) {
        if (child.nodeType === 1) visit(child);
        else if (child.nodeType === 3) translateText(child);
      }
    }
    const observe = () => observer?.observe(document.documentElement, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:attributes});
    function update(records) {
      const added = new Set(), texts = new Set(), changedAttributes = new Map();
      for (const record of records) {
        if (record.type === 'childList') for (const node of record.addedNodes) added.add(node);
        else if (record.type === 'characterData') texts.add(record.target);
        else if (record.type === 'attributes') {
          if (!changedAttributes.has(record.target)) changedAttributes.set(record.target, new Set());
          changedAttributes.get(record.target).add(record.attributeName);
        }
      }
      const eligible = node => node.isConnected && !(node.nodeType === 1 ? node : node.parentElement)?.closest(excluded);
      const covered = node => {
        for (let parent = node.parentNode; parent; parent = parent.parentNode) if (added.has(parent)) return true;
        return false;
      };
      // Translate the final DOM once per affected subtree; our own writes must not trigger another pass.
      observer.disconnect();
      try {
        for (const node of added) if (eligible(node) && !covered(node)) {
          if (node.nodeType === 1) visit(node);
          else if (node.nodeType === 3) translateText(node);
        }
        for (const node of texts) if (eligible(node) && !added.has(node) && !covered(node)) translateText(node);
        for (const [element,names] of changedAttributes) if (eligible(element) && !added.has(element) && !covered(element)) {
          for (const name of names) translateAttribute(element, name);
        }
      } finally { observe(); }
    }
    apply = () => {
      observer?.disconnect();
      try {
        document.documentElement.lang = language;
        visit(document.documentElement);
        document.querySelectorAll('[data-hub-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.hubLanguage === language)));
      } finally { observe(); }
    };
    function init() {
      const bar = document.createElement('div');
      bar.className = 'hub-language';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Език');
      bar.innerHTML = '<button type="button" lang="bg" data-hub-language="bg" aria-label="Български">BG</button><button type="button" lang="en" data-hub-language="en" aria-label="English">EN</button>';
      bar.addEventListener('click', event => {
        const button = event.target.closest('[data-hub-language]');
        if (button) setLanguage(button.dataset.hubLanguage);
      });
      (document.querySelector('.wrap, .account-wrap') || document.body).prepend(bar);
      observer = new MutationObserver(update);
      apply();
    }
    for (const name of ['alert', 'confirm', 'prompt']) {
      const native = window[name].bind(window);
      window[name] = (message, ...args) => native(dialogText(message), ...args);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
    else init();
  }
  return {t, setLanguage, get language() { return language; }};
})();
