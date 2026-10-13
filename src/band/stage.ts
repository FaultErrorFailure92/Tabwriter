// Stage area: equipment & signal chains, stage plan, input list, monitors, cables, bill of materials, rider.
import { t } from '../i18n';
import { icon } from '../icons';
import { el, iconBtn, input, select, moveItem, esc, save } from './dom';
import { openPrintDialog } from '../print';
import {
  type Band, type Gig, type GearItem, type GearKind, type OwnerType, type Cable,
  GEAR_KINDS, CABLE_TYPES, OWNERS, STAGE_KINDS,
  newGearItem, newInput, newMonitor, newCable, fmtDur, setlistDuration,
} from './model';

export type StageTab = 'gear' | 'plan' | 'inputs' | 'cables' | 'bom';
let sub: StageTab = 'gear';
let selected = ''; // stage plan selection: 'm:<memberId>' or gear id
let ask: (msg: string) => Promise<boolean> = async () => true;

const kindLabel = (k: GearKind) => t(GEAR_KINDS.find(([x]) => x === k)?.[1] ?? k);
const cableLabel = (k: string) => t(CABLE_TYPES.find(([x]) => x === k)?.[1] ?? k);

function memberName(b: Band, id: string) {
  return b.members.find((m) => m.id === id)?.name || '?';
}

function ownerText(b: Band, o: OwnerType, m: string) {
  return o === 'member' ? memberName(b, m) : t(OWNERS.find(([x]) => x === o)?.[1] ?? o);
}

/** owner popup: Band, every member, Venue, Verleih */
function ownerSelect(b: Band, obj: { owner: OwnerType; ownerMember: string }, done: () => void) {
  const opts: [string, string][] = [['band', t('Band')], ...b.members.map((m) => [`m:${m.id}`, m.name || '?'] as [string, string]), ['venue', t('Venue')], ['rental', t('Verleih')]];
  const v = obj.owner === 'member' ? `m:${obj.ownerMember}` : obj.owner;
  const s = select(opts, v, (nv) => {
    if (nv.startsWith('m:')) {
      obj.owner = 'member';
      obj.ownerMember = nv.slice(2);
    } else {
      obj.owner = nv as OwnerType;
      obj.ownerMember = '';
    }
    save();
    done();
  });
  s.classList.add('owner');
  return s;
}

function gearName(b: Band, id: string): string {
  const g = b.gear.items.find((x) => x.id === id);
  if (!g) return id; // free text
  return g.name || kindLabel(g.kind);
}

function chainOf(b: Band, member: string): GearItem[] {
  return b.gear.items.filter((g) => g.member === member).sort((a, c) => a.chain - c.chain);
}

function renumber(b: Band, member: string) {
  chainOf(b, member).forEach((g, i) => (g.chain = i));
}

// ---------------- entry ----------------

export function renderStage(main: HTMLElement, b: Band, rerender: () => void, confirmFn: (msg: string) => Promise<boolean>) {
  ask = confirmFn;
  const top = el('div', 'bandTop');
  top.appendChild(el('h2', '', esc(t('Bühne & Technik'))));
  const seg = el('div', 'seg stageSeg');
  const tabs: [StageTab, string][] = [['gear', t('Equipment')], ['plan', t('Bühnenplan')], ['inputs', t('Kanäle')], ['cables', t('Kabel')], ['bom', t('Stückliste')]];
  for (const [k, l] of tabs) {
    const btn = el('button', sub === k ? 'on' : '', esc(l));
    btn.onclick = () => {
      sub = k;
      rerender();
    };
    seg.appendChild(btn);
  }
  top.appendChild(el('span', 'spacer'));
  top.appendChild(seg);
  top.appendChild(el('span', 'spacer'));
  top.appendChild(iconBtn('printer', t('Rider drucken (Bühnenplan, Kanäle, Monitore, Backline)'), () => printRider(b, null), 'tbtn'));
  main.appendChild(top);
  if (sub === 'gear') renderGear(main, b, rerender);
  else if (sub === 'plan') renderPlan(main, b, rerender);
  else if (sub === 'inputs') renderInputs(main, b, rerender);
  else if (sub === 'cables') renderCables(main, b, rerender);
  else renderBom(main, b);
}

// ---------------- equipment ----------------

function defaultKind(b: Band, member: string): GearKind {
  const role = (b.members.find((m) => m.id === member)?.role ?? '').toLowerCase();
  if (/bass/.test(role)) return 'bass';
  if (/drum|schlag/.test(role)) return 'drums';
  if (/key|piano|synth/.test(role)) return 'keys';
  if (/git|guit/.test(role)) return 'guitar';
  if (/gesang|vocal|voc/.test(role)) return 'vocals';
  return member ? 'instrument' : 'other';
}

function renderGear(main: HTMLElement, b: Band, rerender: () => void) {
  if (!b.members.length) main.appendChild(el('div', 'bandEmpty small', esc(t('Tipp: Lege zuerst Mitglieder an, dann bekommt jedes seine eigene Signalkette.'))));
  const groups: [string, string][] = [...b.members.map((m) => [m.id, m.name || '?'] as [string, string]), ['', t('Gemeinsam (Band, PA, Pult …)')]];
  for (const [mid, name] of groups) {
    const items = chainOf(b, mid);
    const card = el('div', 'gearCard');
    const head = el('div', 'gearHead');
    head.appendChild(el('h3', '', esc(name)));
    const chain = items.map((g) => g.name || kindLabel(g.kind)).join(' → ');
    head.appendChild(el('span', 'chainTxt', esc(chain)));
    head.appendChild(el('span', 'spacer'));
    head.appendChild(iconBtn('plus', t('Gerät hinzufügen'), () => {
      const g = newGearItem(items.length ? 'effect' : defaultKind(b, mid), mid);
      g.chain = items.length;
      b.gear.items.push(g);
      save();
      rerender();
      (document.querySelector(`[data-gear="${g.id}"] input`) as HTMLInputElement | null)?.focus();
    }));
    card.appendChild(head);
    items.forEach((g, i) => {
      const r = el('div', 'gearRow');
      r.dataset.gear = g.id;
      r.appendChild(el('span', 'num', mid ? String(i + 1) : '•'));
      r.appendChild(select(GEAR_KINDS.map(([k, l]) => [k, t(l)] as [string, string]), g.kind, (v) => {
        g.kind = v as GearKind;
        if (STAGE_KINDS.includes(g.kind) && !g.onStage) placeOnStage(b, g);
        save();
        rerender();
      }));
      r.appendChild(input(g, 'name', t('Modell, z.B. Helix LT'), () => {
        const h = card.querySelector('.chainTxt');
        if (h) h.textContent = chainOf(b, mid).map((x) => x.name || kindLabel(x.kind)).join(' → ');
      }));
      r.appendChild(ownerSelect(b, g, () => {}));
      const st = iconBtn('stagePlan', g.onStage ? t('Auf dem Bühnenplan (Klick = entfernen)') : t('Auf den Bühnenplan setzen'), () => {
        if (g.onStage) g.onStage = false;
        else placeOnStage(b, g);
        save();
        rerender();
      }, 'tb' + (g.onStage ? ' on' : ''));
      r.appendChild(st);
      const tools = el('span', 'tools');
      if (mid) {
        tools.appendChild(iconBtn('chevronUp', t('Früher in der Kette'), () => { const c = chainOf(b, mid); moveItem(c, i, -1); c.forEach((x, k) => (x.chain = k)); save(); rerender(); }, 'tb'));
        tools.appendChild(iconBtn('chevronDown', t('Später in der Kette'), () => { const c = chainOf(b, mid); moveItem(c, i, 1); c.forEach((x, k) => (x.chain = k)); save(); rerender(); }, 'tb'));
      }
      tools.appendChild(iconBtn('xmark', t('Entfernen'), () => {
        b.gear.items = b.gear.items.filter((x) => x !== g);
        for (const c of b.gear.inputs) if (c.gear === g.id) c.gear = '';
        renumber(b, mid);
        save();
        rerender();
      }, 'tb'));
      r.appendChild(tools);
      card.appendChild(r);
    });
    if (!items.length) card.appendChild(el('div', 'hint pad', esc(mid ? t('Instrument → Effekte → Amp/DI, in Signal-Reihenfolge') : t('z.B. Mischpult, PA, Stagebox, Strom'))));
    main.appendChild(card);
  }
}

function placeOnStage(b: Band, g: GearItem) {
  const s = b.gear.stage;
  const p = g.member ? memberPos(b, g.member) : { x: s.width / 2, y: s.depth / 2 };
  const sh = KIND_SHAPE[g.kind] ?? { w: 0.6, h: 0.4 };
  // relative to the player: amp behind, keys/effects in front, DI beside, drums under the drummer
  const off: Partial<Record<GearKind, [number, number]>> = {
    amp: [0, 1], keys: [0, -0.85], effect: [0, -0.5], di: [0.6, 0], power: [-0.6, 0.6], mic: [0, -0.4], drums: [0, 0.3],
  };
  const [dx, dy] = g.kind === 'monitor' ? [0, -p.y + 0.4] : off[g.kind] ?? [0.7, 0];
  g.onStage = true;
  g.x = r1(clamp(p.x + dx, sh.w / 2, s.width - sh.w / 2));
  g.y = r1(clamp(p.y + dy, sh.h / 2, s.depth - sh.h / 2));
}

const clamp = (v: number, a: number, z: number) => Math.max(a, Math.min(z, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

function memberPos(b: Band, id: string): { x: number; y: number } {
  const s = b.gear.stage;
  let p = s.members[id];
  if (!p) {
    const i = Math.max(0, b.members.findIndex((m) => m.id === id));
    const n = Math.max(1, b.members.length);
    const role = (b.members[i]?.role ?? '').toLowerCase();
    p = /drum|schlag/.test(role) ? { x: s.width / 2, y: s.depth * 0.75 } : { x: r1((s.width * (i + 0.5)) / n), y: r1(s.depth * 0.35) };
    s.members[id] = p;
  }
  return p;
}

// ---------------- stage plan ----------------

const KIND_SHAPE: Partial<Record<GearKind, { w: number; h: number }>> = {
  drums: { w: 2, h: 2 }, amp: { w: 0.8, h: 0.4 }, monitor: { w: 0.7, h: 0.45 }, keys: { w: 1.4, h: 0.5 },
  di: { w: 0.3, h: 0.25 }, power: { w: 0.35, h: 0.2 }, pa: { w: 0.7, h: 0.6 }, mic: { w: 0.3, h: 0.3 },
  effect: { w: 0.8, h: 0.35 }, mixer: { w: 1, h: 0.6 },
};

const PLAN_PX = 70;

export function stageSvg(b: Band, sel = '', print = false): string {
  const s = b.gear.stage;
  const PX = print ? 60 : PLAN_PX; // px per m
  const pad = 30;
  const W = s.width * PX;
  const H = s.depth * PX;
  const X = (m: number) => pad + m * PX;
  const Y = (m: number) => pad + H - m * PX; // y measured from the front edge
  let svg = `<svg class="stageSvg" viewBox="0 0 ${W + pad * 2} ${H + pad * 2 + 18}" width="${W + pad * 2}" height="${H + pad * 2 + 18}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect class="stageFloor" x="${pad}" y="${pad}" width="${W}" height="${H}" rx="6"/>`;
  // 1 m grid
  for (let x = 1; x < s.width; x++) svg += `<line class="grid" x1="${X(x)}" y1="${pad}" x2="${X(x)}" y2="${pad + H}"/>`;
  for (let y = 1; y < s.depth; y++) svg += `<line class="grid" x1="${pad}" y1="${Y(y)}" x2="${pad + W}" y2="${Y(y)}"/>`;
  svg += `<text class="audience" x="${pad + W / 2}" y="${pad + H + 26}" text-anchor="middle">${esc(t('Publikum'))} · ${s.width} × ${s.depth} m</text>`;
  // gear
  for (const g of b.gear.items.filter((x) => x.onStage)) {
    const sh = KIND_SHAPE[g.kind] ?? { w: 0.6, h: 0.4 };
    const w = sh.w * PX;
    const h = sh.h * PX;
    const cx = X(g.x);
    const cy = Y(g.y);
    const label = g.name || kindLabel(g.kind);
    const on = sel === g.id ? ' sel' : '';
    if (g.kind === 'monitor') {
      svg += `<g class="it gear k-${g.kind}${on}" data-id="${g.id}"><path d="M${cx - w / 2} ${cy + h / 2} L${cx + w / 2} ${cy + h / 2} L${cx + w * 0.35} ${cy - h / 2} L${cx - w * 0.35} ${cy - h / 2} Z"/><text x="${cx}" y="${cy + 4}" text-anchor="middle">${esc(label)}</text></g>`;
    } else {
      const ty = g.kind === 'drums' ? cy - h / 2 + 16 : w < label.length * 6.2 + 8 ? cy + h / 2 + 12 : cy + 4; // label below small boxes, drums at the top
      svg += `<g class="it gear k-${g.kind}${on}" data-id="${g.id}"><rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${g.kind === 'drums' ? w / 2 : 4}"/><text x="${cx}" y="${ty}" text-anchor="middle">${esc(label)}</text></g>`;
    }
  }
  // members on top
  for (const m of b.members) {
    const p = memberPos(b, m.id);
    const on = sel === `m:${m.id}` ? ' sel' : '';
    svg += `<g class="it member${on}" data-id="m:${m.id}"><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="17"/><text x="${X(p.x)}" y="${Y(p.y) + 4}" text-anchor="middle">${esc((m.name || '?').slice(0, 3))}</text><text class="sub" x="${X(p.x)}" y="${Y(p.y) + 31}" text-anchor="middle">${esc(m.role)}</text></g>`;
  }
  svg += '</svg>';
  return svg;
}

function renderPlan(main: HTMLElement, b: Band, rerender: () => void) {
  const s = b.gear.stage;
  const wrap = el('div', 'planWrap');
  const canvas = el('div', 'planCanvas', stageSvg(b, selected));
  wrap.appendChild(canvas);
  const side = el('div', 'planSide');
  // stage size
  const sz = el('div', 'gigSec', `<h3>${esc(t('Bühne'))}</h3>`);
  const row = el('div', 'xyRow');
  const w = input(s, 'width', '', () => {}, 'pInput num', 'number');
  const d = input(s, 'depth', '', () => {}, 'pInput num', 'number');
  w.step = d.step = '0.5';
  w.onchange = d.onchange = () => {
    s.width = clamp(Number(w.value) || 8, 2, 30);
    s.depth = clamp(Number(d.value) || 5, 2, 20);
    save();
    rerender();
  };
  row.append(el('span', '', esc(t('Breite'))), w, el('span', '', esc(t('Tiefe'))), d, el('span', 'unit', 'm'));
  sz.appendChild(row);
  side.appendChild(sz);
  // selection: exact position
  const sec = el('div', 'gigSec');
  const isMember = selected.startsWith('m:');
  const g = isMember ? null : b.gear.items.find((x) => x.id === selected && x.onStage);
  const pos = isMember ? memberPos(b, selected.slice(2)) : g;
  if (pos) {
    sec.innerHTML = `<h3>${esc(isMember ? memberName(b, selected.slice(2)) : g!.name || kindLabel(g!.kind))}</h3>`;
    const xy = el('div', 'xyRow');
    const xi = input(pos, 'x', '', undefined, 'pInput num', 'number');
    const yi = input(pos, 'y', '', undefined, 'pInput num', 'number');
    xi.step = yi.step = '0.1';
    xi.onchange = yi.onchange = () => {
      pos.x = r1(clamp(Number(xi.value) || 0, 0, s.width));
      pos.y = r1(clamp(Number(yi.value) || 0, 0, s.depth));
      save();
      rerender();
    };
    xy.append(el('span', '', 'X'), xi, el('span', '', 'Y'), yi, el('span', 'unit', 'm'));
    sec.appendChild(xy);
    sec.appendChild(el('p', 'hint', esc(t('X von links, Y von der Bühnenkante (Sicht Publikum).'))));
    if (g) {
      const rm = el('button', 'btn', esc(t('Vom Plan nehmen')));
      rm.onclick = () => {
        g.onStage = false;
        selected = '';
        save();
        rerender();
      };
      sec.appendChild(rm);
    }
  } else sec.innerHTML = `<h3>${esc(t('Auswahl'))}</h3><p class="hint">${esc(t('Element anklicken oder ziehen. Position auch exakt in Metern eingeben.'))}</p>`;
  side.appendChild(sec);
  // add
  const add = el('div', 'gigSec', `<h3>${esc(t('Hinzufügen'))}</h3>`);
  const chips = el('div', 'lineup');
  for (const k of ['monitor', 'amp', 'di', 'power', 'keys', 'drums', 'mic', 'pa'] as GearKind[]) {
    const c = el('button', 'chipBtn', esc(kindLabel(k)));
    c.onclick = () => {
      const ng = newGearItem(k);
      ng.name = k === 'monitor' ? `Mon ${b.gear.items.filter((x) => x.kind === 'monitor').length + 1}` : '';
      ng.onStage = true;
      ng.x = r1(s.width / 2);
      ng.y = r1(s.depth / 2);
      b.gear.items.push(ng);
      selected = ng.id;
      save();
      rerender();
    };
    chips.appendChild(c);
  }
  add.appendChild(chips);
  add.appendChild(el('p', 'hint', esc(t('Geräte aus „Equipment“ setzt du dort mit dem Bühnen-Symbol auf den Plan.'))));
  side.appendChild(add);
  wrap.appendChild(side);
  main.appendChild(wrap);

  // drag & drop (positions in m, 0.1 m steps)
  canvas.addEventListener('mousedown', (e) => {
    const svg = canvas.querySelector('svg') as SVGSVGElement;
    const it = (e.target as Element).closest('.it') as SVGGElement | null;
    if (!it) {
      if (selected) {
        selected = '';
        rerender();
      }
      return;
    }
    e.preventDefault();
    const id = it.dataset.id!;
    const p = id.startsWith('m:') ? memberPos(b, id.slice(2)) : b.gear.items.find((x) => x.id === id);
    if (!p) return;
    const scale = svg.getScreenCTM()?.a || 1;
    const sx = e.clientX;
    const sy = e.clientY;
    const x0 = p.x;
    const y0 = p.y;
    let moved = false;
    const mv = (m: MouseEvent) => {
      if (!moved && Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) < 3) return;
      moved = true;
      p.x = r1(clamp(x0 + (m.clientX - sx) / scale / PLAN_PX, 0, s.width));
      p.y = r1(clamp(y0 - (m.clientY - sy) / scale / PLAN_PX, 0, s.depth));
      canvas.innerHTML = stageSvg(b, id);
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      selected = id;
      if (moved) save();
      rerender();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  });
}

// ---------------- inputs & monitors ----------------

const DRUM_INPUTS: [string, string, string][] = [
  ['Kick', 'Beta 91 / D112', 'klein'], ['Snare', 'SM57', 'klein'], ['Hi-Hat', 'Kondensator', 'klein'],
  ['Tom 1', 'e604', 'Clip'], ['Tom 2', 'e604', 'Clip'], ['OH L', 'Kondensator', 'groß'], ['OH R', 'Kondensator', 'groß'],
];

/** suggest an input list from members + gear */
function generateInputs(b: Band) {
  const list: { source: string; gear: string; mic: string; stand: string; phantom: boolean }[] = [];
  for (const m of b.members) {
    const chain = chainOf(b, m.id);
    const role = (m.role ?? '').toLowerCase();
    if (chain.some((g) => g.kind === 'drums') || /drum|schlag/.test(role)) {
      for (const [src, mic, stand] of DRUM_INPUTS) list.push({ source: src, gear: chain.find((g) => g.kind === 'drums')?.id ?? '', mic, stand, phantom: mic === 'Kondensator' });
    }
    const end = [...chain].reverse().find((g) => ['amp', 'di', 'effect', 'guitar', 'bass', 'keys', 'instrument', 'wireless'].includes(g.kind));
    if (end) {
      const amp = end.kind === 'amp';
      const short = `${kindLabel(chain[0]?.kind ?? end.kind)} ${m.name}`.trim();
      if (chain.some((g) => g.kind === 'keys')) {
        list.push({ source: `${short} L`, gear: end.id, mic: 'DI', stand: '', phantom: false });
        list.push({ source: `${short} R`, gear: end.id, mic: 'DI', stand: '', phantom: false });
      } else list.push({ source: short, gear: end.id, mic: amp ? 'SM57' : 'DI', stand: amp ? 'klein' : '', phantom: false });
    }
    if (chain.some((g) => g.kind === 'vocals' || g.kind === 'mic') || /gesang|vocal|voc|voice/.test(role)) {
      list.push({ source: `Vox ${m.name}`, gear: chain.find((g) => g.kind === 'mic' || g.kind === 'vocals')?.id ?? '', mic: 'SM58', stand: 'groß', phantom: false });
    }
  }
  b.gear.inputs = list.map((x, i) => ({ ...newInput(i + 1), ...x }));
}

function renderInputs(main: HTMLElement, b: Band, rerender: () => void) {
  const bar = el('div', 'subBar');
  const gen = el('button', 'btn', `${icon('sparkles', 14)}<span>${esc(t('Aus Mitgliedern & Equipment vorschlagen'))}</span>`);
  gen.onclick = async () => {
    if (b.gear.inputs.length && !(await ask(t('Bestehende Kanalliste ersetzen?')))) return;
    generateInputs(b);
    save();
    rerender();
  };
  bar.appendChild(gen);
  bar.appendChild(el('span', 'spacer'));
  bar.appendChild(iconBtn('plus', t('Kanal hinzufügen'), () => {
    b.gear.inputs.push(newInput((b.gear.inputs[b.gear.inputs.length - 1]?.ch ?? 0) + 1));
    save();
    rerender();
  }, 'tbtn'));
  main.appendChild(bar);
  if (!b.gear.inputs.length) main.appendChild(el('div', 'bandEmpty small', esc(t('Noch keine Kanäle. Lass dir eine Liste vorschlagen oder lege Kanäle mit + an.'))));
  else {
    const tbl = el('div', 'bandTable');
    tbl.appendChild(el('div', 'row head inputs', `<span>${t('Kanal')}</span><span>${t('Quelle')}</span><span>${t('Gerät')}</span><span>${t('Mikro / DI')}</span><span>${t('Stativ')}</span><span>48V</span><span>${t('Notiz')}</span><span></span>`));
    b.gear.inputs.forEach((c, i) => {
      const r = el('div', 'row inputs');
      const ch = input(c, 'ch', '', undefined, 'pInput num', 'number');
      r.appendChild(ch);
      r.appendChild(input(c, 'source', t('z.B. Kick')));
      r.appendChild(select([['', '–'], ...b.gear.items.map((g) => [g.id, `${g.name || kindLabel(g.kind)}${g.member ? ' · ' + memberName(b, g.member) : ''}`] as [string, string])], c.gear, (v) => { c.gear = v; save(); }));
      const mic = input(c, 'mic', 'SM58');
      mic.setAttribute('list', 'micList');
      r.appendChild(mic);
      r.appendChild(select([['', '–'], ['groß', t('groß')], ['klein', t('klein')], ['Clip', 'Clip']], c.stand, (v) => { c.stand = v; save(); }));
      const ph = el('input');
      ph.type = 'checkbox';
      ph.checked = c.phantom;
      ph.onchange = () => { c.phantom = ph.checked; save(); };
      r.appendChild(ph);
      r.appendChild(input(c, 'note', t('z.B. Insert Comp')));
      const tools = el('span', 'tools');
      tools.appendChild(iconBtn('chevronUp', t('Nach oben'), () => { moveItem(b.gear.inputs, i, -1); renumberInputs(b); save(); rerender(); }, 'tb'));
      tools.appendChild(iconBtn('xmark', t('Entfernen'), () => { b.gear.inputs.splice(i, 1); save(); rerender(); }, 'tb'));
      r.appendChild(tools);
      tbl.appendChild(r);
    });
    main.appendChild(tbl);
    const dl = el('datalist');
    dl.id = 'micList';
    for (const m of ['SM58', 'SM57', 'Beta 52', 'Beta 91', 'D112', 'e604', 'e906', 'MD421', 'Kondensator', 'DI', 'DI (aktiv)', 'Line']) dl.appendChild(Object.assign(el('option'), { value: m }));
    main.appendChild(dl);
  }

  // monitors
  const mh = el('div', 'subBar', `<h3>${esc(t('Monitore'))}</h3>`);
  mh.appendChild(el('span', 'spacer'));
  mh.appendChild(iconBtn('plus', t('Monitorweg hinzufügen'), () => {
    b.gear.monitors.push(newMonitor(b.gear.monitors.length + 1));
    save();
    rerender();
  }, 'tbtn'));
  main.appendChild(mh);
  if (!b.gear.monitors.length) main.appendChild(el('div', 'hint pad', esc(t('Wedges oder In-Ear-Wege und wer sie hört.'))));
  for (const mo of b.gear.monitors) {
    const r = el('div', 'monRow');
    r.appendChild(input(mo, 'name', 'Mon 1'));
    r.appendChild(select([['wedge', t('Wedge')], ['iem', t('In-Ear')]], mo.kind, (v) => { mo.kind = v as 'wedge' | 'iem'; save(); }));
    const ch = el('div', 'lineup');
    for (const m of b.members) {
      const on = mo.members.includes(m.id);
      const c = el('button', 'chipBtn' + (on ? ' on' : ''), esc(m.name || '?'));
      c.onclick = () => { mo.members = on ? mo.members.filter((x) => x !== m.id) : [...mo.members, m.id]; save(); rerender(); };
      ch.appendChild(c);
    }
    r.appendChild(ch);
    r.appendChild(input(mo, 'note', t('Mix-Wunsch, z.B. viel Vox')));
    r.appendChild(iconBtn('xmark', t('Entfernen'), () => { b.gear.monitors = b.gear.monitors.filter((x) => x !== mo); save(); rerender(); }, 'tb'));
    main.appendChild(r);
  }
}

function renumberInputs(b: Band) {
  b.gear.inputs.forEach((c, i) => (c.ch = i + 1));
}

// ---------------- cables ----------------

function endpointOptions(b: Band): string[] {
  const o = b.gear.items.map((g) => `${g.name || kindLabel(g.kind)}${g.member ? ' (' + memberName(b, g.member) + ')' : ''}`);
  for (const c of b.gear.inputs) o.push(`${t('Stagebox')} ${c.ch}`);
  for (const m of b.gear.monitors) o.push(m.name);
  return [...new Set(o)];
}

/** suggest cables: chain links per member, inputs to stagebox, monitors, power */
function generateCables(b: Band) {
  const list: Cable[] = [];
  const nm = (g: GearItem) => `${g.name || kindLabel(g.kind)}${g.member ? ' (' + memberName(b, g.member) + ')' : ''}`;
  for (const m of b.members) {
    const chain = chainOf(b, m.id).filter((g) => !['vocals', 'drums', 'mic', 'iem', 'monitor'].includes(g.kind));
    for (let i = 0; i + 1 < chain.length; i++) {
      const c = newCable();
      c.from = nm(chain[i]);
      c.to = nm(chain[i + 1]);
      c.type = 'jack';
      c.length = chain[i + 1].kind === 'amp' ? 6 : 3;
      c.owner = 'member';
      c.ownerMember = m.id;
      list.push(c);
    }
  }
  for (const ch of b.gear.inputs) {
    if (!ch.source.trim() && !ch.mic.trim()) continue;
    const c = newCable();
    const g = b.gear.items.find((x) => x.id === ch.gear);
    c.from = ch.mic && ch.mic !== 'DI' && ch.mic !== 'Line' ? `${ch.mic} (${ch.source})` : g ? `DI (${ch.source})` : ch.source;
    c.to = `${t('Stagebox')} ${ch.ch}`;
    c.type = 'xlr';
    c.length = 10;
    list.push(c);
  }
  for (const mo of b.gear.monitors.filter((x) => x.kind === 'wedge')) {
    const c = newCable();
    c.from = `${t('Stagebox')} Out`;
    c.to = mo.name;
    c.type = 'xlr';
    c.length = 10;
    list.push(c);
  }
  const powered = b.gear.items.filter((g) => ['amp', 'keys', 'effect', 'mixer', 'monitor'].includes(g.kind));
  if (powered.length) {
    const c = newCable();
    c.from = t('Strom');
    c.to = t('Mehrfachstecker');
    c.type = 'power';
    c.length = 5;
    c.count = Math.ceil(powered.length / 3);
    list.push(c);
  }
  // merge identical
  const merged: Cable[] = [];
  for (const c of list) {
    const same = merged.find((x) => x.from === c.from && x.to === c.to && x.type === c.type && x.length === c.length);
    if (same) same.count += c.count;
    else merged.push(c);
  }
  b.gear.cables = merged;
}

function renderCables(main: HTMLElement, b: Band, rerender: () => void) {
  const bar = el('div', 'subBar');
  const gen = el('button', 'btn', `${icon('sparkles', 14)}<span>${esc(t('Aus Signalketten & Kanälen vorschlagen'))}</span>`);
  gen.onclick = async () => {
    if (b.gear.cables.length && !(await ask(t('Bestehende Kabelliste ersetzen?')))) return;
    generateCables(b);
    save();
    rerender();
  };
  bar.appendChild(gen);
  bar.appendChild(el('span', 'spacer'));
  bar.appendChild(iconBtn('plus', t('Kabel hinzufügen'), () => { b.gear.cables.push(newCable()); save(); rerender(); }, 'tbtn'));
  main.appendChild(bar);
  if (!b.gear.cables.length) return main.appendChild(el('div', 'bandEmpty small', esc(t('Noch keine Kabel. Lass dir eine Liste vorschlagen oder lege Kabel mit + an.'))));
  const dl = el('datalist');
  dl.id = 'endpoints';
  for (const o of endpointOptions(b)) dl.appendChild(Object.assign(el('option'), { value: o }));
  main.appendChild(dl);
  const tbl = el('div', 'bandTable');
  tbl.appendChild(el('div', 'row head cables', `<span>${t('Von')}</span><span>${t('Nach')}</span><span>${t('Typ')}</span><span>${t('Länge (m)')}</span><span>${t('Anzahl')}</span><span>${t('Besitzer')}</span><span></span>`));
  b.gear.cables.forEach((c) => {
    const r = el('div', 'row cables');
    const f = input(c, 'from', t('Von'));
    const to = input(c, 'to', t('Nach'));
    f.setAttribute('list', 'endpoints');
    to.setAttribute('list', 'endpoints');
    r.append(f, to);
    r.appendChild(select(CABLE_TYPES.map(([k, l]) => [k, t(l)] as [string, string]), c.type, (v) => { c.type = v as Cable['type']; save(); }));
    const len = input(c, 'length', '–', undefined, 'pInput num', 'number');
    if (!c.length) len.value = '';
    r.appendChild(len);
    r.appendChild(input(c, 'count', '1', undefined, 'pInput num', 'number'));
    r.appendChild(ownerSelect(b, c, () => {}));
    r.appendChild(iconBtn('xmark', t('Entfernen'), () => { b.gear.cables = b.gear.cables.filter((x) => x !== c); save(); rerender(); }, 'tb'));
    tbl.appendChild(r);
  });
  main.appendChild(tbl);
}

// ---------------- bill of materials ----------------

interface BomRow { what: string; detail: string; count: number; owner: string }

export function bom(b: Band): BomRow[] {
  const rows = new Map<string, BomRow>();
  const add = (what: string, detail: string, owner: string, n = 1) => {
    const k = `${what}|${detail}|${owner}`;
    const r = rows.get(k);
    if (r) r.count += n;
    else rows.set(k, { what, detail, count: n, owner });
  };
  for (const g of b.gear.items) add(kindLabel(g.kind), g.name, ownerText(b, g.owner, g.ownerMember));
  for (const c of b.gear.inputs) {
    if (c.mic && !/^(di|line)$/i.test(c.mic.trim())) add(t('Mikrofon'), c.mic, t('Band'));
    if (/^di/i.test(c.mic.trim()) && !b.gear.items.some((g) => g.id === c.gear && g.kind === 'di')) add(t('DI-Box'), c.mic, t('Band'));
    if (c.stand) add(t('Stativ'), t(c.stand), t('Band'));
  }
  for (const c of b.gear.cables) add(t('Kabel'), `${cableLabel(c.type)}${c.length ? ` ${c.length} m` : ''}`, ownerText(b, c.owner, c.ownerMember), Math.max(1, c.count));
  return [...rows.values()].sort((a, z) => a.owner.localeCompare(z.owner) || a.what.localeCompare(z.what) || a.detail.localeCompare(z.detail));
}

function renderBom(main: HTMLElement, b: Band) {
  const rows = bom(b);
  if (!rows.length) return main.appendChild(el('div', 'bandEmpty small', esc(t('Die Stückliste entsteht aus Equipment, Kanälen und Kabeln.'))));
  const tbl = el('div', 'bandTable');
  tbl.appendChild(el('div', 'row head bom', `<span>${t('Anzahl')}</span><span>${t('Was')}</span><span>${t('Details')}</span>`));
  let last = '';
  for (const r of rows) {
    if (r.owner !== last) {
      tbl.appendChild(el('div', 'row group', esc(r.owner)));
      last = r.owner;
    }
    tbl.appendChild(el('div', 'row bom', `<span class="num">${r.count}×</span><span>${esc(r.what)}</span><span>${esc(r.detail)}</span>`));
  }
  main.appendChild(tbl);
  const pr = el('button', 'btn', `${icon('printer', 14)}<span>${esc(t('Packliste drucken'))}</span>`);
  pr.style.marginTop = '12px';
  pr.onclick = () => printHtml(`<h1>${esc(t('Packliste'))} – ${esc(b.name)}</h1><table>${rows.map((r) => `<tr><td style="width:50px">☐ ${r.count}×</td><td>${esc(r.what)}</td><td>${esc(r.detail)}</td><td>${esc(r.owner)}</td></tr>`).join('')}</table>`);
  main.appendChild(pr);
}

// ---------------- rider / printing ----------------


const PRINT_CSS = `<style>
#printArea.sheet{font:12.5px -apple-system,Helvetica,Arial,sans-serif;color:#111;padding:6px}
.sheet h1{font-size:22px;margin:0 0 4px}.sheet .sub{color:#555;margin-bottom:14px}
.sheet h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
.sheet table{border-collapse:collapse;width:100%}.sheet td,.sheet th{padding:3px 6px;text-align:left;vertical-align:top}
.sheet th{font-size:11px;color:#555;font-weight:600}.sheet tr+tr td{border-top:0.5px solid #ddd}
.sheet .stageSvg{max-width:100%;height:auto}
.sheet .stageFloor{fill:#f4f4f4;stroke:#999}.sheet .grid{stroke:#e2e2e2}.sheet .audience{font-size:12px;fill:#555}
.sheet .it rect,.sheet .it path{fill:#fff;stroke:#333}.sheet .it circle{fill:#333}.sheet .member text{fill:#fff;font-weight:600;font-size:11px}
.sheet .member text.sub{fill:#333;font-weight:400;font-size:10px}.sheet .gear text{font-size:10px;fill:#111}
.sheet .need{font-weight:600}
</style>`;

function printHtml(body: string) {
  document.getElementById('printArea')?.remove();
  const area = el('div', 'sheet', PRINT_CSS + body);
  area.id = 'printArea';
  document.body.appendChild(area);
  window.addEventListener('afterprint', () => setTimeout(() => area.remove(), 500), { once: true });
  void openPrintDialog();
}

export function riderHtml(b: Band, g: Gig | null): string {
  const inputs = [...b.gear.inputs].sort((a, z) => a.ch - z.ch);
  const members = g ? b.members.filter((m) => g.lineup.includes(m.id)) : b.members;
  const backline = b.gear.items.filter((x) => x.owner === 'venue' || x.owner === 'rental');
  const sl = g ? b.setlists.find((l) => l.id === g.setlist) : null;
  let h = `<h1>${esc(t('Technical Rider'))} – ${esc(b.name)}</h1>`;
  if (g) h += `<div class="sub">${esc(g.title || g.venue)} · ${esc(g.date)}${g.venue ? ' · ' + esc(g.venue) : ''}${sl ? ' · ' + esc(t('Spielzeit')) + ' ' + fmtDur(setlistDuration(b, sl)) : ''}</div>`;
  h += `<h2>${esc(t('Besetzung'))}</h2><table>${members.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.role)}</td></tr>`).join('')}</table>`;
  h += `<h2>${esc(t('Bühnenplan'))}</h2>${stageSvg(b, '', true)}`;
  if (inputs.length) h += `<h2>${esc(t('Kanalliste'))}</h2><table><tr><th>${esc(t('Kanal'))}</th><th>${esc(t('Quelle'))}</th><th>${esc(t('Mikro / DI'))}</th><th>${esc(t('Stativ'))}</th><th>48V</th><th>${esc(t('Notiz'))}</th></tr>${inputs.map((c) => `<tr><td>${c.ch}</td><td>${esc(c.source)}</td><td>${esc(c.mic)}</td><td>${esc(t(c.stand))}</td><td>${c.phantom ? '✓' : ''}</td><td>${esc(c.note)}</td></tr>`).join('')}</table>`;
  if (b.gear.monitors.length) h += `<h2>${esc(t('Monitore'))}</h2><table>${b.gear.monitors.map((m) => `<tr><td>${esc(m.name)}</td><td>${m.kind === 'iem' ? 'In-Ear' : 'Wedge'}</td><td>${esc(m.members.map((x) => memberName(b, x)).join(', '))}</td><td>${esc(m.note)}</td></tr>`).join('')}</table>`;
  if (backline.length) h += `<h2>${esc(t('Bitte vor Ort bereitstellen'))}</h2><table>${backline.map((x) => `<tr><td class="need">${esc(kindLabel(x.kind))}</td><td>${esc(x.name)}</td><td>${esc(x.note)}</td></tr>`).join('')}</table>`;
  if (g?.contacts.length) h += `<h2>${esc(t('Kontakte'))}</h2><table>${g.contacts.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.role)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td></tr>`).join('')}</table>`;
  return h;
}

export function printRider(b: Band, g: Gig | null) {
  printHtml(riderHtml(b, g));
}
