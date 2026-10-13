// Equipment helpers shared by the band page (instruments per member) and the stage page.
import { t } from '../i18n';
import { icon } from '../icons';
import { el, esc, save } from './dom';
import type { MenuItem } from './kit';
import { type Band, type GearItem, type GearKind, GEAR_KINDS, newGearItem } from './model';
import { INSTRUMENTS, GEAR_CATALOG, instrumentOf, gearIcon, modelsFor, thomannSearch } from './catalog';

export const INSTRUMENT_KINDS: GearKind[] = ['guitar', 'bass', 'keys', 'drums', 'vocals', 'instrument'];

export function gearLabel(g: GearItem): string {
  const ins = instrumentOf(g.preset);
  if (ins) return t(ins.label);
  return t(GEAR_CATALOG.find((x) => x.kind === g.kind)?.label ?? GEAR_KINDS.find(([k]) => k === g.kind)?.[1] ?? g.kind);
}

export function chainOf(b: Band, member: string): GearItem[] {
  return b.gear.items.filter((g) => g.member === member).sort((a, c) => a.chain - c.chain);
}

export function memberInstruments(b: Band, member: string): GearItem[] {
  return chainOf(b, member).filter((g) => !!g.preset || INSTRUMENT_KINDS.includes(g.kind));
}

/** keep the free role text in step with the instruments (used for suggestions) */
export function syncRole(b: Band, member: string) {
  const m = b.members.find((x) => x.id === member);
  if (!m) return;
  const ins = memberInstruments(b, member);
  if (ins.length) m.role = [...new Set(ins.map(gearLabel))].join(', ');
}

/** add an item; instruments go to the start of the member's signal chain */
export function addGear(b: Band, member: string, kind: GearKind, preset?: string): GearItem {
  const g = newGearItem(kind, member);
  if (preset) g.preset = preset;
  const chain = chainOf(b, member);
  if (preset && member) {
    const lastIns = chain.filter((x) => x.preset).length;
    chain.splice(lastIns, 0, g);
  } else chain.push(g);
  b.gear.items.push(g);
  chain.forEach((x, i) => (x.chain = i));
  syncRole(b, member);
  save();
  return g;
}

/** "+" menu: instruments (for members) and equipment categories, with icons */
export function gearAddItems(b: Band, member: string, done: (g: GearItem) => void): MenuItem[] {
  const items: MenuItem[] = [];
  if (member) {
    for (const ins of INSTRUMENTS) items.push({ icon: ins.icon, label: t(ins.label), fn: () => done(addGear(b, member, ins.gear, ins.id)) });
    items.push('sep');
  }
  for (const c of GEAR_CATALOG) items.push({ icon: c.icon, label: t(c.label), fn: () => done(addGear(b, member, c.kind)) });
  return items;
}

/** menu to change what an item is */
export function gearKindItems(b: Band, g: GearItem, done: () => void): MenuItem[] {
  const pick = (kind: GearKind, preset?: string) => () => {
    g.kind = kind;
    g.preset = preset;
    syncRole(b, g.member);
    save();
    done();
  };
  return [
    ...INSTRUMENTS.map((ins): MenuItem => ({ icon: ins.icon, label: t(ins.label), fn: pick(ins.gear, ins.id) })),
    'sep',
    ...GEAR_CATALOG.map((c): MenuItem => ({ icon: c.icon, label: t(c.label), fn: pick(c.kind) })),
  ];
}

/** model field with common models + search at Thomann */
export function modelField(g: GearItem, onChange?: () => void): HTMLElement {
  const wrap = el('span', 'modelField');
  const i = el('input', 'pInput');
  i.placeholder = t('Modell, z.B. {x}', { x: modelsFor(g.kind, g.preset)[0] ?? 'Helix LT' });
  i.value = g.name;
  const id = `models-${g.id}`;
  i.setAttribute('list', id);
  i.oninput = () => {
    g.name = i.value;
    save();
    onChange?.();
  };
  i.onkeydown = (e) => {
    if (e.key === 'Enter') i.blur();
  };
  const dl = el('datalist');
  dl.id = id;
  for (const m of modelsFor(g.kind, g.preset)) dl.appendChild(Object.assign(el('option'), { value: m }));
  const shop = el('a', 'tb shop', icon('external', 13));
  shop.dataset.tip = t('Bei Thomann suchen');
  shop.target = '_blank';
  shop.rel = 'noopener';
  const upd = () => (shop.href = thomannSearch(g.name.trim() || gearLabel(g)));
  upd();
  i.addEventListener('input', upd);
  wrap.append(i, dl, shop);
  return wrap;
}

/** small icon + label button showing the kind */
export function kindButton(g: GearItem, onClick: (a: HTMLElement) => void): HTMLButtonElement {
  const b = el('button', 'kindBtn', `${icon(gearIcon(g.kind, g.preset), 14)}<span>${esc(gearLabel(g))}</span>`);
  b.onclick = (e) => {
    e.stopPropagation();
    onClick(b);
  };
  return b;
}
