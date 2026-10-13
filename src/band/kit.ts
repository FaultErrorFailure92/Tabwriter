// One set of building blocks for every Stagecraft view, so all pages behave the same:
// page head (title, tabs below, actions + one primary button), detail head (title, meta, … menu),
// cards with "+" in the head, label/control rows, switches, empty states, pop menus, wizards.
import { t } from '../i18n';
import { icon, type IconName } from '../icons';
import { el, esc, iconBtn } from './dom';

// ---------------- tabs ----------------

export type TabItem<K extends string> = [K, string, number?];

export function tabs<K extends string>(items: TabItem<K>[], value: K, onChange: (k: K) => void, cls = ''): HTMLElement {
  const seg = el('div', 'seg tabs' + (cls ? ' ' + cls : ''));
  for (const [k, label, n] of items) {
    const b = el('button', k === value ? 'on' : '', esc(label) + (n ? ` <span class="segCnt">${n}</span>` : ''));
    b.onclick = () => onChange(k);
    seg.appendChild(b);
  }
  return seg;
}

// ---------------- page head ----------------

export interface Primary {
  label: string;
  tip?: string;
  fn: (anchor: HTMLElement) => void;
}

export function primaryBtn(p: Primary): HTMLButtonElement {
  const b = el('button', 'btn primary', `${icon('plus', 12)}<span>${esc(p.label)}</span>`);
  if (p.tip) b.dataset.tip = p.tip;
  b.onclick = () => p.fn(b);
  return b;
}

/** title left, actions + one primary button right, tabs underneath */
export function pageHead(main: HTMLElement, o: { title: string | HTMLElement; sub?: string; tabs?: HTMLElement; actions?: HTMLElement[]; primary?: Primary }) {
  const h = el('header', 'pageHead');
  const row = el('div', 'pageRow');
  if (typeof o.title === 'string') row.appendChild(el('h2', '', esc(o.title)));
  else row.appendChild(o.title);
  if (o.sub) row.appendChild(el('span', 'pageSub', esc(o.sub)));
  row.appendChild(el('span', 'spacer'));
  for (const a of o.actions ?? []) row.appendChild(a);
  if (o.primary) row.appendChild(primaryBtn(o.primary));
  h.appendChild(row);
  if (o.tabs) h.appendChild(o.tabs);
  main.appendChild(h);
}

// ---------------- menus ----------------

export type MenuItem = { icon: IconName; label: string; fn: () => void; danger?: boolean; hint?: string } | 'sep';

export function popMenu(anchor: HTMLElement, items: MenuItem[], cls = '') {
  document.getElementById('kitPop')?.remove();
  const pop = el('div', 'pop menuPop' + (cls ? ' ' + cls : ''));
  pop.id = 'kitPop';
  for (const it of items) {
    if (it === 'sep') {
      if (pop.lastElementChild && pop.lastElementChild.tagName !== 'HR') pop.appendChild(el('hr'));
      continue;
    }
    const b = el('button', it.danger ? 'danger' : '', `<i>${icon(it.icon)}</i><span>${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}`);
    b.onclick = () => {
      pop.remove();
      it.fn();
    };
    pop.appendChild(b);
  }
  if (pop.lastElementChild?.tagName === 'HR') pop.lastElementChild.remove();
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  const left = r.right - pr.width > 8 && r.left + pr.width > window.innerWidth - 8 ? r.right - pr.width : r.left;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pr.width - 8, left))}px`;
  pop.style.top = `${Math.min(window.innerHeight - pr.height - 8, r.bottom + 4)}px`;
  setTimeout(() => document.addEventListener('mousedown', function off(e) {
    if (!pop.contains(e.target as Node)) {
      pop.remove();
      document.removeEventListener('mousedown', off);
    }
  }), 0);
}

/** the "…" button with all actions of an object */
export function moreBtn(items: () => MenuItem[], tip = t('Mehr')): HTMLButtonElement {
  const b = iconBtn('ellipsis', tip, () => popMenu(b, items()), 'tbtn');
  return b;
}

// ---------------- detail head ----------------

/** title (editable), meta text, optional primary action, "…" menu; tabs go underneath */
export function detailHead(d: HTMLElement, o: { title: HTMLElement; meta?: string; lead?: HTMLElement; action?: HTMLElement; menu?: () => MenuItem[]; tabs?: HTMLElement }) {
  const h = el('div', 'dHead');
  const row = el('div', 'dRow');
  if (o.lead) row.appendChild(o.lead);
  row.appendChild(o.title);
  if (o.meta) row.appendChild(el('span', 'dMeta', esc(o.meta)));
  if (o.action) row.appendChild(o.action);
  if (o.menu) row.appendChild(moreBtn(o.menu));
  h.appendChild(row);
  if (o.tabs) h.appendChild(o.tabs);
  d.appendChild(h);
}

// ---------------- cards ----------------

export interface CardOpts {
  add?: (anchor: HTMLElement) => void;
  addTip?: string;
  extra?: HTMLElement[];
  cls?: string;
}

/** white card with title; "+" (and other small icons) in the head */
export function card(parent: HTMLElement, title: string, o: CardOpts = {}): HTMLElement {
  const s = el('section', 'gigSec' + (o.cls ? ' ' + o.cls : ''));
  const h = el('div', 'secTop', `<h3>${esc(title)}</h3>`);
  const tools = el('span', 'secTools');
  for (const x of o.extra ?? []) tools.appendChild(x);
  if (o.add) {
    const b: HTMLButtonElement = iconBtn('plus', o.addTip ?? t('Hinzufügen'), () => o.add!(b), 'tb add');
    tools.appendChild(b);
  }
  h.appendChild(tools);
  s.appendChild(h);
  parent.appendChild(s);
  return s;
}

/** label | control row */
export function row(parent: HTMLElement, label: string, ctl: HTMLElement, after?: HTMLElement): HTMLElement {
  const r = el('label', 'gigField', `<span>${esc(label)}</span>`);
  r.appendChild(ctl);
  if (after) r.appendChild(after);
  parent.appendChild(r);
  return r;
}

export function hint(parent: HTMLElement, text: string) {
  parent.appendChild(el('div', 'hint pad', esc(text)));
}

/** page-level empty state: one sentence, the way to fill it is the primary button */
export function emptyState(parent: HTMLElement, text: string) {
  parent.appendChild(el('div', 'bandEmpty', esc(text)));
}

export function toggle(value: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const i = el('input', 'switch');
  i.type = 'checkbox';
  i.checked = value;
  i.onchange = () => onChange(i.checked);
  return i;
}

export function columns(parent: HTMLElement): [HTMLElement, HTMLElement] {
  const cols = el('div', 'gigCols');
  const l = el('div');
  const r = el('div');
  cols.append(l, r);
  parent.appendChild(cols);
  return [l, r];
}

/** search field that keeps focus across re-renders */
export function searchField(value: string, onInput: (v: string) => void, cls = ''): HTMLInputElement {
  const q = el('input', 'pInput search' + (cls ? ' ' + cls : ''));
  q.type = 'search';
  q.placeholder = t('Suchen …');
  q.value = value;
  q.oninput = () => {
    const pos = q.selectionStart;
    const sel = '.' + (cls || 'search').split(' ')[0];
    onInput(q.value);
    const nq = document.querySelector(`#band input${sel}`) as HTMLInputElement | null;
    nq?.focus();
    nq?.setSelectionRange(pos, pos);
  };
  return q;
}

// ---------------- wizard ----------------

export interface WizardStep<S> {
  title: string;
  text?: string;
  body: (box: HTMLElement, s: S, redraw: () => void) => void;
  /** false = "Weiter" disabled */
  ok?: (s: S) => boolean;
  optional?: boolean;
  /** step is left out when true */
  skip?: (s: S) => boolean;
}

/** modal step-by-step dialog; resolves with the state on finish, null on cancel */
export function wizard<S>(o: { title: string; state: S; steps: WizardStep<S>[]; finish?: string; extra?: (foot: HTMLElement, close: () => void) => void }): Promise<S | null> {
  return new Promise((resolve) => {
    const ov = el('div', 'overlay wizOverlay');
    const box = el('div', 'card wizard');
    ov.appendChild(box);
    document.body.appendChild(ov);
    let i = 0;
    const close = (v: S | null) => {
      ov.remove();
      document.removeEventListener('keydown', key, true);
      resolve(v);
    };
    const next = () => {
      const st = o.steps[i];
      if (st.ok && !st.ok(o.state)) return;
      let n = i + 1;
      while (n < o.steps.length && o.steps[n].skip?.(o.state)) n++;
      if (n < o.steps.length) {
        i = n;
        draw();
      } else close(o.state);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(null);
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        e.stopPropagation();
        next();
      }
    };
    document.addEventListener('keydown', key, true);
    const draw = () => {
      const st = o.steps[i];
      box.innerHTML = '';
      const head = el('div', 'wizHead');
      head.appendChild(el('span', 'wizKicker', esc(o.title)));
      if (o.steps.length > 1) {
        const dots = el('span', 'wizDots');
        o.steps.forEach((_, k) => dots.appendChild(el('i', k === i ? 'on' : k < i ? 'done' : '')));
        head.appendChild(dots);
      }
      box.appendChild(head);
      box.appendChild(el('h2', '', esc(st.title)));
      if (st.text) box.appendChild(el('p', 'wizText', esc(st.text)));
      const body = el('div', 'wizBody');
      box.appendChild(body);
      const foot = el('div', 'row wizFoot');
      const last = o.steps.slice(i + 1).every((x) => x.skip?.(o.state));
      const okBtn = el('button', 'btn primary', esc(last ? o.finish ?? t('Fertig') : t('Weiter')));
      const redraw = () => {
        okBtn.disabled = !!st.ok && !st.ok(o.state);
        okBtn.textContent = o.steps.slice(i + 1).every((x) => x.skip?.(o.state)) ? o.finish ?? t('Fertig') : t('Weiter');
      };
      st.body(body, o.state, redraw);
      if (i === 0) o.extra?.(foot, () => close(null));
      foot.appendChild(el('span', 'spacer'));
      const cancel = el('button', 'btn', esc(i === 0 ? t('Abbrechen') : t('Zurück')));
      cancel.onclick = () => {
        if (i === 0) close(null);
        else {
          i--;
          while (i > 0 && o.steps[i].skip?.(o.state)) i--;
          draw();
        }
      };
      okBtn.onclick = next;
      foot.append(cancel, okBtn);
      box.appendChild(foot);
      redraw();
      (body.querySelector('input, textarea, select') as HTMLElement | null)?.focus();
    };
    draw();
  });
}

/** plain text field for wizards (not bound to an object) */
export function wizInput(value: string, ph: string, onInput: (v: string) => void, type = 'text'): HTMLInputElement {
  const i = el('input', 'pInput');
  i.type = type;
  i.placeholder = ph;
  i.value = value;
  i.oninput = () => onInput(i.value);
  return i;
}

export function wizField(parent: HTMLElement, label: string, ctl: HTMLElement) {
  const r = el('label', 'wizField', `<span>${esc(label)}</span>`);
  r.appendChild(ctl);
  parent.appendChild(r);
}

/** choice list (radio-like big buttons) */
export function choices<K extends string>(parent: HTMLElement, items: { k: K; icon: IconName; label: string; sub?: string }[], value: K, onChange: (k: K) => void) {
  const box = el('div', 'wizChoices');
  for (const it of items) {
    const b = el('button', 'wizChoice' + (it.k === value ? ' on' : ''), `<i>${icon(it.icon, 18)}</i><span><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>`);
    b.type = 'button';
    b.onclick = () => {
      box.querySelectorAll('.wizChoice').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onChange(it.k);
    };
    box.appendChild(b);
  }
  parent.appendChild(box);
}
