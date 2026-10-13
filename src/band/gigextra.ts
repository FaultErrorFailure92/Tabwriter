// Crew & helpers, gig documents / photo links, band calendar with availability, .ics export.
import { t } from '../i18n';
import { icon, type IconName } from '../icons';
import { dbGet, dbPut, dbDelete } from '../library';
import { saveFile } from '../io';
import { el, esc, input, select, iconBtn, save } from './dom';
import { card, hint, popMenu, wizard, wizField, wizInput, type MenuItem } from './kit';
import { type Band, type Gig, type Crew, type DocKind, type GigDoc, CREW_ROLES, CREW_TASKS, newCrew, uid } from './model';
import { audioKey } from './ideas';

type Ctx = { b: Band; rerender: () => void; confirm: (m: string) => Promise<boolean>; flash: (m: string) => void };

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?';
const linkBtn = (href: string, ic: IconName, tip: string) => {
  const a = el('a', 'tb lk', icon(ic, 13));
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.dataset.tip = tip;
  return a;
};
const webUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

// ---------------- crew pool (band page) ----------------

export async function crewWizard(c: Ctx, role = ''): Promise<Crew | null> {
  const r = await wizard({
    title: t('Crew & Helfer'),
    state: { ...newCrew(), role },
    finish: t('Hinzufügen'),
    steps: [{
      title: t('Wer hilft mit?'),
      text: t('Z.B. Fotograf:in, Helfer:innen beim Aufbau, Tontechnik, Fahrer:in. Für alle Gigs wiederverwendbar.'),
      ok: (s) => !!s.name.trim(),
      body: (box, s, redraw) => {
        wizField(box, t('Name'), wizInput(s.name, t('Name'), (v) => { s.name = v; redraw(); }));
        const ro = wizInput(s.role, t('z.B. Fotograf:in'), (v) => (s.role = v));
        ro.setAttribute('list', 'crewRoles');
        wizField(box, t('Rolle'), ro);
        wizField(box, t('Telefon'), wizInput(s.phone, '+43 …', (v) => (s.phone = v)));
        wizField(box, t('E-Mail'), wizInput(s.email, 'name@…', (v) => (s.email = v), 'email'));
        wizField(box, t('Link'), wizInput(s.link, t('Website, Portfolio, Instagram'), (v) => (s.link = v)));
        wizField(box, t('Adresse'), wizInput(s.address, t('Straße, Ort'), (v) => (s.address = v)));
        box.appendChild(roleList());
      },
    }],
  });
  if (!r) return null;
  const p = { ...r, name: r.name.trim() };
  c.b.crew.push(p);
  save();
  return p;
}

function roleList() {
  const dl = el('datalist');
  dl.id = 'crewRoles';
  for (const x of CREW_ROLES) dl.appendChild(Object.assign(el('option'), { value: t(x) }));
  return dl;
}

export function crewCard(parent: HTMLElement, c: Ctx) {
  const cc = card(parent, t('Crew & Helfer'), { addTip: t('Person hinzufügen'), add: async () => { if (await crewWizard(c)) c.rerender(); } });
  if (!c.b.crew.length) hint(cc, t('Fotograf:innen, Helfer:innen, Tontechnik … – einmal anlegen, bei jedem Gig auswählen.'));
  for (const p of c.b.crew) {
    const r = el('div', 'crewRow');
    r.appendChild(el('span', 'av', esc(initials(p.name))));
    const body = el('div', 'crewBody');
    const l1 = el('div', 'crewL1');
    l1.appendChild(input(p, 'name', t('Name'), undefined, 'pInput name'));
    const ro = input(p, 'role', t('Rolle'), undefined, 'pInput role');
    ro.setAttribute('list', 'crewRoles');
    l1.appendChild(ro);
    body.appendChild(l1);
    const l2 = el('div', 'crewL2');
    l2.append(input(p, 'phone', t('Telefon')), input(p, 'email', t('E-Mail')), input(p, 'link', t('Link')), input(p, 'address', t('Adresse')));
    body.appendChild(l2);
    r.appendChild(body);
    const tools = el('span', 'crewTools');
    if (p.link) tools.appendChild(linkBtn(webUrl(p.link), 'external', t('Link öffnen')));
    if (p.address) tools.appendChild(linkBtn(`https://maps.apple.com/?q=${encodeURIComponent(p.address)}`, 'stagePlan', t('Adresse in Karten')));
    tools.appendChild(iconBtn('xmark', t('Entfernen'), async () => {
      if (!(await c.confirm(t('{x} entfernen?', { x: p.name || t('Person') })))) return;
      c.b.crew = c.b.crew.filter((x) => x !== p);
      for (const g of c.b.gigs) g.crew = g.crew.filter((x) => x.person !== p.id);
      save();
      c.rerender();
    }, 'tb'));
    r.appendChild(tools);
    cc.appendChild(r);
  }
  cc.appendChild(roleList());
}

// ---------------- crew per gig ----------------

export function gigCrewCard(parent: HTMLElement, g: Gig, c: Ctx) {
  const add = (a: HTMLElement) => {
    const free = c.b.crew.filter((p) => !g.crew.some((x) => x.person === p.id));
    const items: MenuItem[] = free.map((p) => ({ icon: 'people', label: `${p.name}${p.role ? ` · ${p.role}` : ''}`, fn: () => { g.crew.push({ id: uid('w'), person: p.id, task: defaultTask(p.role), time: '' }); save(); c.rerender(); } }));
    if (items.length) items.push('sep');
    items.push({ icon: 'plus', label: t('Neue Person …'), fn: async () => {
      const p = await crewWizard(c);
      if (p) g.crew.push({ id: uid('w'), person: p.id, task: defaultTask(p.role), time: '' });
      save();
      c.rerender();
    } });
    popMenu(a, items, 'scroll');
  };
  const cc = card(parent, t('Crew & Helfer'), { addTip: t('Person dazuholen'), add });
  if (!g.crew.length) hint(cc, t('Wer hilft bei diesem Gig? Z.B. Fotos, Aufbau, Fahren.'));
  for (const w of g.crew) {
    const p = c.b.crew.find((x) => x.id === w.person);
    if (!p) continue;
    const r = el('div', 'gcRow');
    r.appendChild(el('span', 'nm', `<b>${esc(p.name)}</b><small>${esc(p.role)}</small>`));
    const task = input(w, 'task', t('Aufgabe'));
    task.setAttribute('list', 'crewTasks');
    r.appendChild(task);
    r.appendChild(input(w, 'time', '', undefined, 'pInput time', 'time'));
    const tools = el('span', 'crewTools');
    if (p.phone) tools.appendChild(linkBtn(`tel:${p.phone.replace(/\s/g, '')}`, 'mic', p.phone));
    if (p.email) tools.appendChild(linkBtn(`mailto:${p.email}`, 'doc', p.email));
    if (p.link) tools.appendChild(linkBtn(webUrl(p.link), 'external', p.link));
    tools.appendChild(iconBtn('xmark', t('Entfernen'), () => { g.crew = g.crew.filter((x) => x !== w); save(); c.rerender(); }, 'tb'));
    r.appendChild(tools);
    cc.appendChild(r);
  }
  const dl = el('datalist');
  dl.id = 'crewTasks';
  for (const x of CREW_TASKS) dl.appendChild(Object.assign(el('option'), { value: t(x) }));
  cc.appendChild(dl);
}

function defaultTask(role: string) {
  if (/foto|photo/i.test(role)) return t('Fotos');
  if (/video/i.test(role)) return t('Video');
  if (/helf|stage/i.test(role)) return t('Aufbau');
  if (/ton|sound/i.test(role)) return t('Ton');
  if (/fahr|driv/i.test(role)) return t('Fahren');
  if (/merch/i.test(role)) return t('Merch-Stand');
  return '';
}

// ---------------- documents & photos ----------------

const DOC_KINDS: [DocKind, string, IconName][] = [['contract', 'Vertrag', 'pencil'], ['invoice', 'Rechnung', 'euro'], ['receipt', 'Beleg', 'cashbox'], ['rider', 'Rider', 'doc'], ['other', 'Sonstiges', 'doc']];

function pickFiles(accept = ''): Promise<File[]> {
  return new Promise((res) => {
    const i = el('input');
    i.type = 'file';
    i.multiple = true;
    if (accept) i.accept = accept;
    i.onchange = () => res(Array.from(i.files ?? []));
    i.click();
  });
}

function guessKind(name: string): DocKind {
  if (/vertrag|contract|vereinbarung/i.test(name)) return 'contract';
  if (/rechnung|invoice|honorar/i.test(name)) return 'invoice';
  if (/beleg|quittung|receipt|bon|tank/i.test(name)) return 'receipt';
  if (/rider|stage.?plo?t/i.test(name)) return 'rider';
  return 'other';
}

async function addFiles(g: Gig, files: File[], c: Ctx, kind?: DocKind) {
  for (const f of files) {
    const d: GigDoc = { id: uid('f'), kind: kind ?? guessKind(f.name), name: f.name.replace(/\.[^.]+$/, ''), file: { name: f.name, type: f.type, size: f.size }, url: '', date: new Date().toISOString().slice(0, 10), amount: 0, cost: '', note: '' };
    await dbPut(audioKey(d.id), f);
    g.docs.push(d);
  }
  if (files.length) {
    save();
    c.rerender();
    c.flash(t('{n} Datei(en) hinzugefügt', { n: files.length }));
  }
}

async function openDoc(d: GigDoc, c: Ctx) {
  if (d.url) return window.open(webUrl(d.url), '_blank', 'noopener');
  const blob = await dbGet<Blob>(audioKey(d.id));
  if (!blob) return c.flash(t('Datei nicht gefunden (nur auf dem Gerät gespeichert, wo sie hinzugefügt wurde)'));
  const u = URL.createObjectURL(blob);
  const w = window.open(u, '_blank');
  if (!w) {
    const a = el('a');
    a.href = u;
    a.download = d.file?.name ?? d.name;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}

const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

export function renderDocs(d: HTMLElement, g: Gig, c: Ctx) {
  const dc = card(d, t('Verträge & Dokumente'), {
    addTip: t('Dokument hinzufügen'),
    add: (a) => popMenu(a, [
      ...DOC_KINDS.map(([k, l, ic]): MenuItem => ({ icon: ic, label: t('{x} hinzufügen …', { x: t(l) }), fn: async () => addFiles(g, await pickFiles(), c, k) })),
      'sep',
      { icon: 'link', label: t('Link zu einem Dokument'), fn: () => { g.docs.push({ id: uid('f'), kind: 'other', name: '', url: 'https://', date: new Date().toISOString().slice(0, 10), amount: 0, cost: '', note: '' }); save(); c.rerender(); } },
    ]),
  });
  const zone = el('div', 'dropZone small', `${icon('upload', 18)}<b>${esc(t('Dateien hierher ziehen'))}</b><small>${esc(t('Vertrag, Rechnung, Belege, Rider … (PDF, Bilder, Office)'))}</small>`);
  dropFiles(zone, (files) => void addFiles(g, files, c));
  dropFiles(dc, (files) => void addFiles(g, files, c));
  if (!g.docs.length) dc.appendChild(zone);
  const costs: [string, string][] = [['', t('kein Kosten-Posten')], ...g.money.costs.map((x) => [x.id, `${x.label || t('Kosten')} · ${x.amount} €`] as [string, string])];
  for (const doc of g.docs) {
    const r = el('div', 'docRow');
    const kind = DOC_KINDS.find(([k]) => k === doc.kind) ?? DOC_KINDS[4];
    const kbtn = el('button', 'kindBtn', `${icon(kind[2], 14)}<span>${esc(t(kind[1]))}</span>`);
    kbtn.onclick = () => popMenu(kbtn, DOC_KINDS.map(([k, l, ic]): MenuItem => ({ icon: ic, label: t(l), fn: () => { doc.kind = k; save(); c.rerender(); } })));
    r.appendChild(kbtn);
    const main = el('div', 'docMain');
    main.appendChild(input(doc, 'name', t('Name'), undefined, 'pInput name'));
    if (doc.url || !doc.file) main.appendChild(input(doc, 'url', 'https://…', undefined, 'pInput url'));
    else main.appendChild(el('small', '', esc(`${doc.file.name} · ${kb(doc.file.size)}`)));
    r.appendChild(main);
    r.appendChild(input(doc, 'date', '', undefined, 'pInput date', 'date'));
    if (doc.kind === 'invoice' || doc.kind === 'receipt') {
      const am = input(doc, 'amount', '0 €', undefined, 'pInput num', 'number');
      if (!doc.amount) am.value = '';
      r.appendChild(am);
    } else r.appendChild(el('span'));
    const open = iconBtn('external', t('Öffnen'), () => void openDoc(doc, c), 'tb');
    r.appendChild(open);
    r.appendChild(iconBtn('xmark', t('Entfernen'), async () => {
      if (!(await c.confirm(t('{x} entfernen?', { x: doc.name || t('Dokument') })))) return;
      if (doc.file) await dbDelete(audioKey(doc.id));
      g.docs = g.docs.filter((x) => x !== doc);
      save();
      c.rerender();
    }, 'tb'));
    dc.appendChild(r);
    if (doc.kind === 'receipt' && g.money.costs.length) {
      const sub = el('div', 'docSub');
      sub.appendChild(el('span', '', esc(t('gehört zu'))));
      sub.appendChild(select(costs, doc.cost, (v) => { doc.cost = v; save(); }));
      dc.appendChild(sub);
    }
  }
  const sum = g.docs.filter((x) => x.kind === 'receipt').reduce((a, x) => a + (x.amount || 0), 0);
  if (sum) dc.appendChild(el('div', 'bandSum', esc(t('Belege gesamt: {a}', { a: `${sum.toFixed(2).replace('.', ',')} €` }))));

  // photos & videos
  const people: [string, string][] = [['', t('von …')], ...c.b.crew.map((p) => [p.id, `${p.name}${p.role ? ` (${p.role})` : ''}`] as [string, string]), ...c.b.members.map((m) => [m.id, m.name] as [string, string])];
  const pc = card(d, t('Fotos & Videos'), { addTip: t('Link hinzufügen'), add: () => {
    const ph = c.b.crew.find((p) => /foto|photo/i.test(p.role) && g.crew.some((w) => w.person === p.id));
    g.photos.push({ id: uid('o'), url: '', label: '', by: ph?.id ?? '' });
    save();
    c.rerender();
    const all = document.querySelectorAll<HTMLInputElement>('#band .photoRow input.url');
    all[all.length - 1]?.focus();
  } });
  if (!g.photos.length) hint(pc, t('Links zu Alben (Google Fotos, iCloud, Dropbox, WeTransfer, Instagram …).'));
  for (const ph of g.photos) {
    const r = el('div', 'photoRow');
    const top = el('div', 'mediaTop');
    top.appendChild(el('span', 'mIc', icon('image', 14)));
    const u = input(ph, 'url', 'https://…', undefined, 'pInput url');
    u.onchange = () => c.rerender();
    top.appendChild(u);
    if (ph.url) top.appendChild(linkBtn(webUrl(ph.url), 'external', t('Öffnen')));
    top.appendChild(iconBtn('xmark', t('Entfernen'), () => { g.photos = g.photos.filter((x) => x !== ph); save(); c.rerender(); }, 'tb'));
    r.appendChild(top);
    const l2 = el('div', 'photoL2');
    l2.append(input(ph, 'label', t('z.B. Live-Fotos, Aftermovie')), select(people, ph.by, (v) => { ph.by = v; save(); }));
    r.appendChild(l2);
    pc.appendChild(r);
  }
}

function dropFiles(box: HTMLElement, fn: (f: File[]) => void) {
  box.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); box.classList.add('over'); });
  box.addEventListener('dragleave', () => box.classList.remove('over'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    box.classList.remove('over');
    const f = Array.from(e.dataTransfer?.files ?? []);
    if (f.length) fn(f);
  });
}

// ---------------- calendar ----------------

let month = new Date().toISOString().slice(0, 7); // "YYYY-MM"
let who = ''; // member whose "no time" days are toggled by a click

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function awayOn(b: Band, day: string): string[] {
  return b.away.filter((a) => a.from <= day && day <= (a.to || a.from)).map((a) => a.member);
}

export function renderCalendar(main: HTMLElement, c: Ctx, openGig: (id: string) => void) {
  const b = c.b;
  if (!who || !b.members.some((m) => m.id === who)) who = b.members[0]?.id ?? '';
  const [y, mo] = month.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const bar = el('div', 'calBar');
  bar.appendChild(iconBtn('chevronLeft', t('Voriger Monat'), () => { month = iso(new Date(y, mo - 2, 1)).slice(0, 7); c.rerender(); }, 'tbtn'));
  bar.appendChild(el('h3', 'calTitle', esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))));
  bar.appendChild(iconBtn('chevronRight', t('Nächster Monat'), () => { month = iso(new Date(y, mo, 1)).slice(0, 7); c.rerender(); }, 'tbtn'));
  const todayBtn = el('button', 'btn small', esc(t('Heute')));
  todayBtn.onclick = () => { month = iso(new Date()).slice(0, 7); c.rerender(); };
  bar.appendChild(todayBtn);
  bar.appendChild(el('span', 'spacer'));
  if (b.members.length) {
    bar.appendChild(el('span', 'calWhoL', esc(t('Keine Zeit eintragen für'))));
    const ws = el('div', 'calWho');
    for (const m of b.members) {
      const bt = el('button', 'chipBtn' + (m.id === who ? ' on' : ''), esc(m.name || '?'));
      bt.onclick = () => { who = m.id; c.rerender(); };
      ws.appendChild(bt);
    }
    bar.appendChild(ws);
  }
  main.appendChild(bar);

  const grid = el('div', 'calGrid');
  const wd = [1, 2, 3, 4, 5, 6, 0].map((i) => new Date(2024, 0, i === 0 ? 7 : i).toLocaleDateString(undefined, { weekday: 'short' }));
  for (const w of wd) grid.appendChild(el('div', 'calWd', esc(w)));
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const today = iso(new Date());
  for (let i = 0; i < 42; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const ds = iso(day);
    const out = day.getMonth() !== mo - 1;
    if (i === 35 && out) break;
    const away = awayOn(b, ds);
    const gigs = b.gigs.filter((g) => g.date === ds);
    const cell = el('div', 'calDay' + (out ? ' out' : '') + (ds === today ? ' today' : '') + (away.includes(who) ? ' mine' : ''));
    cell.appendChild(el('span', 'num', String(day.getDate())));
    for (const g of gigs) {
      const clash = g.lineup.filter((m) => away.includes(m));
      const gb = el('button', 'calGig' + (clash.length ? ' clash' : ''), `${icon('calendar', 11)}<span>${esc(g.title || g.venue || t('Gig'))}</span>`);
      gb.dataset.tip = clash.length ? t('Keine Zeit: {x}', { x: clash.map((id) => b.members.find((m) => m.id === id)?.name ?? '?').join(', ') }) : t('Gig öffnen');
      gb.onclick = (e) => { e.stopPropagation(); openGig(g.id); };
      cell.appendChild(gb);
    }
    if (away.length) {
      const aw = el('div', 'calAway');
      for (const id of away) {
        const m = b.members.find((x) => x.id === id);
        if (!m) continue;
        const a = b.away.find((x) => x.member === id && x.from <= ds && ds <= (x.to || x.from));
        const s = el('span', 'awayTag', esc(m.name || '?'));
        if (a?.note) s.dataset.tip = a.note;
        aw.appendChild(s);
      }
      cell.appendChild(aw);
    }
    cell.dataset.tip = who ? (away.includes(who) ? t('Klick: {x} hat doch Zeit', { x: b.members.find((m) => m.id === who)?.name ?? '' }) : t('Klick: {x} hat keine Zeit', { x: b.members.find((m) => m.id === who)?.name ?? '' })) : '';
    cell.onclick = () => {
      if (!who) return;
      toggleAway(b, who, ds);
      save();
      c.rerender();
    };
    grid.appendChild(cell);
  }
  main.appendChild(grid);
  main.appendChild(el('p', 'hint pad', esc(t('Mitglied oben wählen, dann Tage anklicken. Rote Gigs: jemand aus der Besetzung hat keine Zeit.'))));
}

function toggleAway(b: Band, member: string, day: string) {
  const hit = b.away.find((a) => a.member === member && a.from <= day && day <= (a.to || a.from));
  if (!hit) {
    b.away.push({ id: uid('a'), member, from: day, to: day, note: '' });
    return;
  }
  // remove one day from a range (split if needed)
  const prev = (d: string) => { const x = new Date(d + 'T12:00'); x.setDate(x.getDate() - 1); return iso(x); };
  const next = (d: string) => { const x = new Date(d + 'T12:00'); x.setDate(x.getDate() + 1); return iso(x); };
  const to = hit.to || hit.from;
  b.away = b.away.filter((a) => a !== hit);
  if (hit.from < day) b.away.push({ ...hit, id: uid('a'), to: prev(day) });
  if (day < to) b.away.push({ ...hit, id: uid('a'), from: next(day), to });
}

// ---------------- iCalendar ----------------

const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const fold = (line: string) => line.match(/.{1,73}/g)!.join('\r\n ');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function gigEvent(b: Band, g: Gig): string[] {
  const d = g.date.replace(/-/g, '');
  const timed = g.schedule.filter((s) => /^\d\d:\d\d$/.test(s.time)).sort((a, z) => a.time.localeCompare(z.time));
  const lines = ['BEGIN:VEVENT', `UID:${g.id}@stagecraft`, `DTSTAMP:${stamp()}`];
  if (timed.length) {
    const st = timed[0].time.replace(':', '');
    const last = timed[timed.length - 1].time;
    const endH = `${String(Math.min(23, Number(last.slice(0, 2)) + 2)).padStart(2, '0')}${last.slice(3)}`;
    lines.push(`DTSTART:${d}T${st}00`, `DTEND:${d}T${endH}00`);
  } else {
    const n = new Date(g.date + 'T12:00');
    n.setDate(n.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${iso(n).replace(/-/g, '')}`);
  }
  const title = `${b.name}: ${g.title || g.venue || 'Gig'}`;
  const desc = [
    ...g.schedule.filter((s) => s.time || s.label).map((s) => `${s.time} ${s.label}`.trim()),
    g.lineup.length ? `${t('Besetzung')}: ${g.lineup.map((id) => b.members.find((m) => m.id === id)?.name ?? '').join(', ')}` : '',
    g.crew.length ? `${t('Crew')}: ${g.crew.map((w) => { const p = b.crew.find((x) => x.id === w.person); return p ? `${p.name}${w.task ? ` (${w.task})` : ''}` : ''; }).join(', ')}` : '',
    g.notes,
  ].filter(Boolean).join('\n');
  lines.push(fold(`SUMMARY:${icsEsc(title)}`));
  if (g.venue || g.address) lines.push(fold(`LOCATION:${icsEsc([g.venue, g.address].filter(Boolean).join(', '))}`));
  if (desc) lines.push(fold(`DESCRIPTION:${icsEsc(desc)}`));
  lines.push('END:VEVENT');
  return lines;
}

export function icsFor(b: Band, gigs: Gig[], name: string): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stagecraft//Band//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', fold(`X-WR-CALNAME:${icsEsc(name)}`), ...gigs.filter((g) => g.date).flatMap((g) => gigEvent(b, g)), 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

const ICS = { desc: 'iCalendar', ext: 'ics', mime: 'text/calendar' };

export async function downloadIcs(b: Band, gigs: Gig[], file: string, flash: (m: string) => void) {
  const bytes = new TextEncoder().encode(icsFor(b, gigs, b.name));
  const r = await saveFile(`${file.replace(/[\\/:*?"<>|]/g, '_')}.ics`, bytes, undefined, ICS);
  if (r) flash(t('Gespeichert: {x}', { x: r.name }));
}
