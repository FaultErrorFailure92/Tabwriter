// Small DOM helpers shared by the band views.
import { icon, type IconName } from '../icons';
import { fmtDur, parseDur } from './model';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let saver = () => {};
export function setSaver(fn: () => void) {
  saver = fn;
}
const save = () => saver();
export { save };


export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function iconBtn(ic: IconName, tip: string, fn: () => void, cls = 'tbtn small'): HTMLButtonElement {
  const b = el('button', cls, icon(ic, 14));
  b.dataset.tip = tip;
  b.onclick = (e) => {
    e.stopPropagation();
    fn();
  };
  return b;
}

/** text input bound to obj[key]; onChange runs after every edit */
export function input<T extends object>(obj: T, key: keyof T, ph: string, onChange?: () => void, cls = 'pInput', type = 'text'): HTMLInputElement {
  const i = el('input', cls);
  i.type = type;
  i.placeholder = ph;
  i.value = String(obj[key] ?? '');
  i.oninput = () => {
    (obj as any)[key] = typeof obj[key] === 'number' ? Number(i.value) || 0 : i.value;
    save();
    onChange?.();
  };
  i.onkeydown = (e) => {
    if (e.key === 'Enter') i.blur();
  };
  return i;
}

/** duration field "m:ss" */
export function durInput(obj: { duration: number }, onChange?: () => void): HTMLInputElement {
  const i = el('input', 'pInput dur');
  i.placeholder = '0:00';
  i.value = obj.duration ? fmtDur(obj.duration) : '';
  i.onchange = () => {
    const v = parseDur(i.value);
    if (v === null) {
      i.value = obj.duration ? fmtDur(obj.duration) : '';
      return;
    }
    obj.duration = v;
    i.value = v ? fmtDur(v) : '';
    save();
    onChange?.();
  };
  i.onkeydown = (e) => {
    if (e.key === 'Enter') i.blur();
  };
  return i;
}

export function select(options: [string, string][], value: string, fn: (v: string) => void): HTMLSelectElement {
  const s = el('select', 'pInput');
  for (const [v, l] of options) {
    const o = el('option');
    o.value = v;
    o.textContent = l;
    s.appendChild(o);
  }
  s.value = value;
  s.onchange = () => fn(s.value);
  return s;
}

export function moveItem<T>(arr: T[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

