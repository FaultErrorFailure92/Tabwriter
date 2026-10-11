// Minimal i18n: German source strings are the keys, English is looked up.
import { EN } from './i18n.en';
import type { LangPref } from './prefs';

export type Lang = 'de' | 'en';
let lang: Lang = 'de';

export function initLang(pref: LangPref) {
  if (pref === 'auto') {
    const nav = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase();
    lang = nav.startsWith('de') ? 'de' : 'en';
  } else {
    lang = pref;
  }
  document.documentElement.lang = lang;
}

export function currentLang(): Lang {
  return lang;
}

/** translate; {name} placeholders are filled from vars */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = lang === 'en' ? EN[s] ?? s : s;
  if (vars) for (const k in vars) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}

/** translate static markup: text nodes and title/placeholder attributes */
export function translateDom(root: ParentNode = document.body) {
  if (lang === 'de') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const n of nodes) {
    const raw = n.nodeValue ?? '';
    const key = raw.trim();
    if (!key || !(key in EN)) continue;
    n.nodeValue = raw.replace(key, EN[key]);
  }
  root.querySelectorAll?.('[title],[placeholder],[aria-label]').forEach((el) => {
    for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v && v in EN) el.setAttribute(a, EN[v]);
    }
  });
}
