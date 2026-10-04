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
      // File and folder names are user data, even when they contain familiar UI words.
      if (/ConnText$|^connText$/.test(element.id)) {
        const connected = value.match(/^(Свързан с(?: папка)?:\s*)([\s\S]*)$/);
        if (connected) return t(connected[1]) + connected[2];
        return dialogText(value);
      }
      return t(value, !!element.closest('[data-i18n-exact]'));
    }
    function visit(element) {
      if (element.matches(excluded)) return;
      // Options without an explicit value otherwise inherit their translated label.
      if (element.tagName === 'OPTION' && !element.hasAttribute('value')) element.setAttribute('value', element.value);
      const remembered = attributeState.get(element) || {};
      for (const name of attributes) {
        if (!element.hasAttribute(name)) continue;
        const current = element.getAttribute(name), state = remembered[name];
        const original = state && state.last === current ? state.original : current;
        const translated = t(original, !!element.closest('[data-i18n-exact]'));
        if (current !== translated) element.setAttribute(name, translated);
        remembered[name] = {original, last:translated};
      }
      attributeState.set(element, remembered);
      for (const child of element.childNodes) {
        if (child.nodeType === 1) visit(child);
        else if (child.nodeType === 3) {
          const current = child.nodeValue, state = textState.get(child);
          const original = state && state.last === current ? state.original : current;
          const translated = localizedText(original, element);
          if (current !== translated) child.nodeValue = translated;
          textState.set(child, {original, last:translated});
        }
      }
    }
    apply = () => {
      observer?.disconnect();
      document.documentElement.lang = language;
      visit(document.documentElement);
      document.querySelectorAll('[data-hub-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.hubLanguage === language)));
      observer?.observe(document.documentElement, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:attributes});
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
      (document.querySelector('.wrap') || document.body).prepend(bar);
      observer = new MutationObserver(apply);
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
