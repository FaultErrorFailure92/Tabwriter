// Stagecraft band area: gigs, setlists, songs, members.
import { t } from '../i18n';
import { icon, type IconName } from '../icons';
import { dbGet, dbPut } from '../library';
import { saveFile, type FileType } from '../io';
import { openPrintDialog } from '../print';
import { renderStage, printRider } from './stage';
import { el, iconBtn, input, durInput, select, moveItem, esc, setSaver } from './dom';
import {
  type Band, type Gig, type Setlist, type SetItem,
  newBand, normalize, newMember, newSong, newSetlist, newGig, newContact, uid,
  setlistDuration, fmtDur, parseDur,
} from './model';

export const STAGECRAFT: FileType = { desc: 'Stagecraft', ext: 'stagecraft', mime: 'application/json' };
const DB_KEY = '__band';

type Tab = 'gigs' | 'setlists' | 'songs' | 'members' | 'stage';

export interface CurrentSong {
  title: string;
  bpm: number;
  duration: number;
  key: string;
  file: string;
}

export interface BandHost {
  currentSong(): CurrentSong | null;
  flash(msg: string): void;
  confirm(msg: string): Promise<boolean>;
  /** songs from the library: file = path (desktop) or file name (browser) */
  recentFiles(): { label: string; file: string }[];
  /** choose a file on disk and keep it in the library; returns its file key */
  pickFile(): Promise<{ label: string; file: string } | null>;
  /** open the score in the editor; false if not found */
  openFile(file: string): Promise<boolean>;
}

const baseName = (f: string) => f.split(/[\\/]/).pop() ?? f;

async function openSongFile(file: string) {
  if (!(await host.openFile(file))) host.flash(t('Datei nicht gefunden: {x}', { x: baseName(file) }));
  else closeBand();
}

function linkMenu(anchor: HTMLElement, s: { file: string; title: string }) {
  document.getElementById('linkPop')?.remove();
  const pop = el('div', 'pop menuPop');
  pop.id = 'linkPop';
  const item = (ic: Parameters<typeof icon>[0], label: string, fn: () => void, cls = '') => {
    const btn = el('button', cls, `<i>${icon(ic)}</i><span>${esc(label)}</span>`);
    btn.onclick = () => {
      pop.remove();
      fn();
    };
    pop.appendChild(btn);
  };
  item('folder', t('Datei wählen …'), async () => {
    const f = await host.pickFile();
    if (!f) return;
    s.file = f.file;
    if (!s.title) s.title = f.label;
    save();
    render();
  });
  const recent = host.recentFiles();
  if (recent.length) pop.appendChild(el('hr'));
  for (const r of recent.slice(0, 12)) {
    item(r.file === s.file ? 'checkmark' : 'doc', r.label, () => {
      s.file = r.file;
      if (!s.title) s.title = r.label;
      save();
      render();
    });
  }
  if (s.file) {
    pop.appendChild(el('hr'));
    item('unlink', t('Verknüpfung lösen'), () => {
      s.file = '';
      save();
      render();
    }, 'danger');
  }
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  pop.style.left = `${Math.min(window.innerWidth - pr.width - 8, r.left)}px`;
  pop.style.top = `${Math.min(window.innerHeight - pr.height - 8, r.bottom + 4)}px`;
  setTimeout(() => document.addEventListener('mousedown', function off(e) {
    if (!pop.contains(e.target as Node)) {
      pop.remove();
      document.removeEventListener('mousedown', off);
    }
  }), 0);
}

let band: Band = newBand();
let host: BandHost;
let tab: Tab = 'gigs';
let selGig = '';
let selList = '';
let root: HTMLElement;
let saveTimer = 0;


function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void dbPut(DB_KEY, JSON.stringify(band)), 300);
}
setSaver(save);

export async function initBand(h: BandHost) {
  host = h;
  root = document.createElement('div');
  root.id = 'band';
  root.className = 'hidden';
  document.body.appendChild(root);
  const raw = await dbGet<string>(DB_KEY);
  if (raw) {
    try {
      band = normalize(JSON.parse(raw));
    } catch {
      band = newBand(t('Meine Band'));
    }
  } else band = newBand(t('Meine Band'));
}

export function bandOpen() {
  return !!root && !root.classList.contains('hidden');
}

export function openBand() {
  render();
  root.classList.remove('hidden');
}

export function closeBand() {
  root.classList.add('hidden');
}

function fmtDate(d: string): string {
  if (!d) return t('Ohne Datum');
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------------- layout ----------------

function render() {
  root.innerHTML = '';
  const side = el('aside', 'bandSide');
  const head = el('div', 'bandHead');
  const name = input(band, 'name', t('Name der Band'), undefined, 'bandName');
  head.appendChild(name);
  head.appendChild(iconBtn('xmark', t('Schließen (Esc)'), closeBand));
  side.appendChild(head);

  const nav: [Tab, IconName, string, number][] = [
    ['gigs', 'calendar', t('Gigs'), band.gigs.length],
    ['setlists', 'list', t('Setlists'), band.setlists.length],
    ['songs', 'music', t('Songs'), band.songs.length],
    ['members', 'people', t('Mitglieder'), band.members.length],
    ['stage', 'stagePlan', t('Bühne & Technik'), band.gear.items.length],
  ];
  for (const [k, ic, label, n] of nav) {
    const b = el('button', 'bandNav' + (tab === k ? ' on' : ''), `${icon(ic, 16)}<span>${esc(label)}</span><span class="cnt">${n || ''}</span>`);
    b.onclick = () => {
      tab = k;
      render();
    };
    side.appendChild(b);
  }
  side.appendChild(el('span', 'spacer'));
  const foot = el('div', 'bandFoot');
  foot.appendChild(iconBtn('folder', t('Band-Datei öffnen …'), () => void importBand()));
  foot.appendChild(iconBtn('save', t('Band-Datei speichern …'), () => void exportBand()));
  side.appendChild(foot);
  root.appendChild(side);

  const main = el('main', 'bandMain');
  root.appendChild(main);
  if (tab === 'gigs') renderGigs(main);
  else if (tab === 'setlists') renderSetlists(main);
  else if (tab === 'songs') renderSongs(main);
  else if (tab === 'stage') renderStage(main, band, render, (m) => host.confirm(m));
  else renderMembers(main);
}

function pageHead(main: HTMLElement, title: string, addTip: string, add: () => void, extra?: HTMLElement) {
  const h = el('div', 'bandTop');
  h.appendChild(el('h2', '', esc(title)));
  h.appendChild(el('span', 'spacer'));
  if (extra) h.appendChild(extra);
  h.appendChild(iconBtn('plus', addTip, add, 'tbtn'));
  main.appendChild(h);
}

function empty(main: HTMLElement, text: string) {
  main.appendChild(el('div', 'bandEmpty', esc(text)));
}

// ---------------- members ----------------

function renderMembers(main: HTMLElement) {
  pageHead(main, t('Mitglieder'), t('Mitglied hinzufügen'), () => {
    band.members.push(newMember());
    save();
    render();
    (root.querySelector('.bandTable .row:last-child input') as HTMLInputElement | null)?.focus();
  });
  if (!band.members.length) return empty(main, t('Noch keine Mitglieder. Lege sie mit + an.'));
  const tbl = el('div', 'bandTable');
  tbl.appendChild(el('div', 'row head', `<span>${t('Name')}</span><span>${t('Instrument / Rolle')}</span><span>${t('Telefon')}</span><span>${t('E-Mail')}</span><span></span>`));
  for (const m of band.members) {
    const r = el('div', 'row members');
    r.append(input(m, 'name', t('Name')), input(m, 'role', t('z.B. Gitarre, Gesang')), input(m, 'phone', '+43 …'), input(m, 'email', 'name@…'));
    r.appendChild(iconBtn('trash', t('Entfernen'), async () => {
      if (!(await host.confirm(t('{x} entfernen?', { x: m.name || t('Mitglied') })))) return;
      band.members = band.members.filter((x) => x !== m);
      for (const g of band.gigs) g.lineup = g.lineup.filter((id) => id !== m.id);
      save();
      render();
    }, 'tb'));
    tbl.appendChild(r);
  }
  main.appendChild(tbl);
}

// ---------------- songs ----------------

function renderSongs(main: HTMLElement) {
  const cur = el('button', 'btn', `${icon('docPlus', 14)}<span>${esc(t('Aktuellen Song übernehmen'))}</span>`);
  cur.dataset.tip = t('Titel, Tempo und Länge aus dem Editor');
  cur.onclick = () => {
    const c = host.currentSong();
    if (!c) return host.flash(t('Kein Song geöffnet'));
    const ex = band.songs.find((s) => s.title.trim().toLowerCase() === c.title.trim().toLowerCase());
    const s = ex ?? newSong(c.title);
    s.bpm = c.bpm;
    s.duration = c.duration;
    s.key = s.key || c.key;
    s.file = c.file;
    if (!ex) band.songs.push(s);
    save();
    render();
    host.flash(ex ? t('„{x}“ aktualisiert', { x: c.title }) : t('„{x}“ hinzugefügt', { x: c.title }));
  };
  pageHead(main, t('Songs'), t('Song hinzufügen'), () => {
    band.songs.push(newSong());
    save();
    render();
    (root.querySelector('.bandTable .row:last-child input') as HTMLInputElement | null)?.focus();
  }, cur);
  if (!band.songs.length) return empty(main, t('Noch keine Songs. Übernimm den offenen Song oder lege einen mit + an.'));
  const tbl = el('div', 'bandTable');
  tbl.appendChild(el('div', 'row head songs', `<span>${t('Titel')}</span><span>${t('Länge')}</span><span>${t('BPM')}</span><span>${t('Tonart')}</span><span>${t('Notiz')}</span><span>${t('Datei')}</span><span></span>`));
  for (const s of band.songs) {
    const r = el('div', 'row songs');
    const bpm = input(s, 'bpm', '–', undefined, 'pInput num', 'number');
    if (!s.bpm) bpm.value = '';
    r.append(input(s, 'title', t('Titel')), durInput(s), bpm, input(s, 'key', 'z.B. Em'), input(s, 'notes', t('z.B. Capo 2, Fade-Out')));
    const fileCell = el('span', 'fileCell');
    if (s.file) {
      const open = el('button', 'fileBtn', `${icon('doc', 13)}<span>${esc(baseName(s.file))}</span>`);
      open.dataset.tip = t('Im Editor öffnen');
      open.onclick = () => void openSongFile(s.file);
      fileCell.appendChild(open);
    }
    const lk = iconBtn('link', s.file ? t('Andere Datei verknüpfen') : t('Mit Datei verknüpfen'), () => linkMenu(lk, s), 'tb');
    fileCell.appendChild(lk);
    r.appendChild(fileCell);
    r.appendChild(iconBtn('trash', t('Entfernen'), async () => {
      const used = band.setlists.some((l) => l.items.some((it) => it.type === 'song' && it.song === s.id));
      if (!(await host.confirm(used ? t('„{x}“ steht in Setlists. Trotzdem entfernen?', { x: s.title }) : t('{x} entfernen?', { x: s.title || t('Song') })))) return;
      band.songs = band.songs.filter((x) => x !== s);
      for (const l of band.setlists) l.items = l.items.filter((it) => !(it.type === 'song' && it.song === s.id));
      save();
      render();
    }, 'tb'));
    tbl.appendChild(r);
  }
  const total = band.songs.reduce((a, s) => a + s.duration, 0);
  main.appendChild(tbl);
  main.appendChild(el('div', 'bandSum', esc(t('{n} Songs · {d} gesamt', { n: band.songs.length, d: fmtDur(total) }))));
}

// ---------------- setlists ----------------

function renderSetlists(main: HTMLElement) {
  pageHead(main, t('Setlists'), t('Setlist hinzufügen'), () => {
    const l = newSetlist(t('Neue Setlist'));
    band.setlists.push(l);
    selList = l.id;
    save();
    render();
    (root.querySelector('.bandDetail .bandTitle') as HTMLInputElement | null)?.select();
  });
  if (!band.setlists.length) return empty(main, t('Noch keine Setlists. Lege eine mit + an.'));
  if (!band.setlists.some((l) => l.id === selList)) selList = band.setlists[0].id;
  const split = el('div', 'bandSplit');
  const list = el('div', 'bandList');
  for (const l of band.setlists) {
    const r = el('div', 'bandItem' + (l.id === selList ? ' on' : ''), `<span class="t">${esc(l.name || t('Ohne Namen'))}</span><span class="s">${esc(t('{n} Einträge · {d}', { n: l.items.length, d: fmtDur(setlistDuration(band, l)) }))}</span>`);
    r.onclick = () => {
      selList = l.id;
      render();
    };
    list.appendChild(r);
  }
  split.appendChild(list);
  const l = band.setlists.find((x) => x.id === selList)!;
  split.appendChild(setlistDetail(l));
  main.appendChild(split);
}

function setlistDetail(l: Setlist): HTMLElement {
  const d = el('div', 'bandDetail');
  const top = el('div', 'detailTop');
  const total = el('span', 'total');
  const upd = () => (total.textContent = fmtDur(setlistDuration(band, l)));
  upd();
  top.appendChild(input(l, 'name', t('Name der Setlist'), () => {
    const it = root.querySelector('.bandItem.on .t');
    if (it) it.textContent = l.name || t('Ohne Namen');
  }, 'bandTitle'));
  top.appendChild(total);
  top.appendChild(iconBtn('duplicate', t('Setlist duplizieren (z.B. kurze Variante)'), () => {
    const c: Setlist = JSON.parse(JSON.stringify(l));
    c.id = uid('l');
    c.name = `${l.name} (${t('Kopie')})`;
    c.items.forEach((it) => (it.id = uid('i')));
    band.setlists.push(c);
    selList = c.id;
    save();
    render();
  }));
  top.appendChild(iconBtn('trash', t('Setlist löschen'), async () => {
    if (!(await host.confirm(t('{x} löschen?', { x: l.name || t('Setlist') })))) return;
    band.setlists = band.setlists.filter((x) => x !== l);
    for (const g of band.gigs) if (g.setlist === l.id) g.setlist = '';
    save();
    render();
  }));
  d.appendChild(top);

  const items = el('div', 'setItems');
  let n = 0;
  l.items.forEach((it, i) => {
    const r = el('div', 'setRow' + (it.type === 'break' ? ' brk' : ''));
    if (it.type === 'song') {
      n++;
      const s = band.songs.find((x) => x.id === it.song);
      r.appendChild(el('span', 'num', String(n)));
      const nm = el('span', 'name' + (s?.file ? ' link' : ''), esc(s?.title || t('(gelöschter Song)')));
      if (s?.file) {
        nm.dataset.tip = t('Im Editor öffnen');
        nm.onclick = () => void openSongFile(s.file);
      }
      r.appendChild(nm);
      const meta = [s?.key, s?.bpm ? `${s.bpm} bpm` : ''].filter(Boolean).join(' · ');
      r.appendChild(el('span', 'meta', esc(meta)));
      r.appendChild(input(it, 'note', t('Notiz, z.B. Fade-Out'), undefined, 'pInput note'));
      r.appendChild(el('span', 'dur', s?.duration ? fmtDur(s.duration) : '–'));
    } else {
      r.appendChild(el('span', 'num', icon('pause', 12)));
      r.appendChild(input(it, 'label', t('Pause / Ansage'), undefined, 'pInput name'));
      r.appendChild(el('span', 'meta'));
      r.appendChild(el('span', 'note'));
      r.appendChild(durInput(it, () => {
        upd();
      }));
    }
    const tools = el('span', 'tools');
    tools.appendChild(iconBtn('chevronUp', t('Nach oben'), () => { moveItem(l.items, i, -1); save(); render(); }, 'tb'));
    tools.appendChild(iconBtn('chevronDown', t('Nach unten'), () => { moveItem(l.items, i, 1); save(); render(); }, 'tb'));
    tools.appendChild(iconBtn('xmark', t('Entfernen'), () => { l.items.splice(i, 1); save(); render(); }, 'tb'));
    r.appendChild(tools);
    items.appendChild(r);
  });
  if (!l.items.length) items.appendChild(el('div', 'bandEmpty small', esc(t('Füge unten Songs oder Pausen hinzu.'))));
  d.appendChild(items);
  dragRows(items, (from, to) => {
    const [it] = l.items.splice(from, 1);
    l.items.splice(to, 0, it);
    save();
    render();
  });

  const add = el('div', 'setAdd');
  const used = new Set(l.items.map((it) => (it.type === 'song' ? it.song : '')));
  const opts: [string, string][] = [['', t('Song hinzufügen …')], ...band.songs.map((s) => [s.id, (used.has(s.id) ? '✓ ' : '') + (s.title || t('Ohne Titel'))] as [string, string])];
  add.appendChild(select(opts, '', (v) => {
    if (!v) return;
    l.items.push({ id: uid('i'), type: 'song', song: v, note: '' } as SetItem);
    save();
    render();
  }));
  const brk = el('button', 'btn', `${icon('pause', 12)}<span>${esc(t('Pause / Ansage'))}</span>`);
  brk.onclick = () => {
    l.items.push({ id: uid('i'), type: 'break', label: t('Pause'), duration: 0 });
    save();
    render();
  };
  add.appendChild(brk);
  if (!band.songs.length) add.appendChild(el('span', 'hint', esc(t('Songs legst du unter „Songs“ an.'))));
  d.appendChild(add);
  return d;
}

/** reorder rows by dragging (not from inputs or buttons) */
function dragRows(box: HTMLElement, done: (from: number, to: number) => void) {
  box.addEventListener('mousedown', (e) => {
    const t0 = e.target as HTMLElement;
    if (t0.closest('input, button, select, textarea')) return;
    const row = t0.closest('.setRow') as HTMLElement | null;
    if (!row) return;
    const rows = Array.from(box.querySelectorAll<HTMLElement>('.setRow'));
    const from = rows.indexOf(row);
    const y0 = e.clientY;
    let dragging = false;
    let gap = from;
    e.preventDefault();
    const clear = () => rows.forEach((r) => r.classList.remove('dropT', 'dropB', 'dragging'));
    const mv = (m: MouseEvent) => {
      if (!dragging && Math.abs(m.clientY - y0) < 4) return;
      dragging = true;
      document.body.classList.add('arDragging');
      clear();
      row.classList.add('dragging');
      gap = 0;
      rows.forEach((r) => {
        const rc = r.getBoundingClientRect();
        if (m.clientY > rc.top + rc.height / 2) gap++;
      });
      if (gap < rows.length) rows[gap].classList.add('dropT');
      else rows[rows.length - 1].classList.add('dropB');
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('arDragging');
      clear();
      if (!dragging) return;
      const to = gap > from ? gap - 1 : gap;
      if (to !== from) done(from, to);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  });
}

// ---------------- gigs ----------------

function renderGigs(main: HTMLElement) {
  pageHead(main, t('Gigs'), t('Gig hinzufügen'), () => {
    const g = newGig(today());
    g.schedule.forEach((s) => (s.label = t(s.label)));
    g.lineup = band.members.map((m) => m.id);
    band.gigs.push(g);
    selGig = g.id;
    save();
    render();
    (root.querySelector('.bandDetail .bandTitle') as HTMLInputElement | null)?.focus();
  });
  if (!band.gigs.length) return empty(main, t('Noch keine Gigs. Lege einen mit + an.'));
  if (!band.gigs.some((g) => g.id === selGig)) selGig = band.gigs[0].id;
  const now = today();
  const sorted = [...band.gigs].sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  const upcoming = sorted.filter((g) => !g.date || g.date >= now);
  const past = sorted.filter((g) => g.date && g.date < now).reverse();
  const split = el('div', 'bandSplit');
  const list = el('div', 'bandList');
  const group = (title: string, gigs: Gig[]) => {
    if (!gigs.length) return;
    list.appendChild(el('div', 'bandGroup', esc(title)));
    for (const g of gigs) {
      const r = el('div', 'bandItem' + (g.id === selGig ? ' on' : '') + (g.date && g.date < now ? ' past' : ''), `<span class="t">${esc(g.title || g.venue || t('Gig'))}</span><span class="s">${esc(fmtDate(g.date))}${g.venue && g.title ? ' · ' + esc(g.venue) : ''}</span>`);
      r.onclick = () => {
        selGig = g.id;
        render();
      };
      list.appendChild(r);
    }
  };
  group(t('Kommend'), upcoming);
  group(t('Vergangen'), past);
  split.appendChild(list);
  split.appendChild(gigDetail(band.gigs.find((g) => g.id === selGig)!));
  main.appendChild(split);
}

function section(parent: HTMLElement, title: string, extra?: HTMLElement): HTMLElement {
  const s = el('section', 'gigSec');
  const h = el('div', 'secTop', `<h3>${esc(title)}</h3>`);
  if (extra) h.appendChild(extra);
  s.appendChild(h);
  parent.appendChild(s);
  return s;
}

function field(parent: HTMLElement, label: string, ctl: HTMLElement) {
  const r = el('label', 'gigField', `<span>${esc(label)}</span>`);
  r.appendChild(ctl);
  parent.appendChild(r);
}

function gigDetail(g: Gig): HTMLElement {
  const d = el('div', 'bandDetail');
  const refreshItem = () => {
    const it = root.querySelector('.bandItem.on');
    if (!it) return;
    it.querySelector('.t')!.textContent = g.title || g.venue || t('Gig');
    it.querySelector('.s')!.textContent = fmtDate(g.date) + (g.venue && g.title ? ' · ' + g.venue : '');
  };
  const top = el('div', 'detailTop');
  top.appendChild(input(g, 'title', t('Titel, z.B. Release-Show'), refreshItem, 'bandTitle'));
  top.appendChild(iconBtn('printer', t('Tagesplan drucken'), () => printGig(g)));
  top.appendChild(iconBtn('stagePlan', t('Rider für diesen Gig drucken'), () => printRider(band, g)));
  top.appendChild(iconBtn('duplicate', t('Gig duplizieren'), () => {
    const c: Gig = JSON.parse(JSON.stringify(g));
    c.id = uid('g');
    c.title = g.title ? `${g.title} (${t('Kopie')})` : '';
    band.gigs.push(c);
    selGig = c.id;
    save();
    render();
  }));
  top.appendChild(iconBtn('trash', t('Gig löschen'), async () => {
    if (!(await host.confirm(t('{x} löschen?', { x: g.title || g.venue || t('Gig') })))) return;
    band.gigs = band.gigs.filter((x) => x !== g);
    save();
    render();
  }));
  d.appendChild(top);

  const cols = el('div', 'gigCols');
  const left = el('div');
  const right = el('div');
  cols.append(left, right);
  d.appendChild(cols);

  // where & when
  const s1 = section(left, t('Wann & wo'));
  field(s1, t('Datum'), input(g, 'date', '', refreshItem, 'pInput', 'date'));
  field(s1, t('Venue'), input(g, 'venue', t('Name des Clubs'), refreshItem));
  field(s1, t('Adresse'), input(g, 'address', t('Straße, Ort')));

  // schedule
  const addTime = iconBtn('plus', t('Zeitpunkt hinzufügen'), () => {
    g.schedule.push({ id: uid('t'), label: '', time: '' });
    save();
    render();
  }, 'tb');
  const s2 = section(left, t('Zeitplan'), addTime);
  for (const it of g.schedule) {
    const r = el('div', 'schedRow');
    r.appendChild(input(it, 'time', '', () => {
      g.schedule.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
      save();
    }, 'pInput time', 'time'));
    r.appendChild(input(it, 'label', t('z.B. Soundcheck')));
    r.appendChild(iconBtn('xmark', t('Entfernen'), () => { g.schedule = g.schedule.filter((x) => x !== it); save(); render(); }, 'tb'));
    s2.appendChild(r);
  }

  // setlist + lineup
  const s3 = section(right, t('Setlist & Besetzung'));
  const sl = band.setlists.find((l) => l.id === g.setlist);
  const slInfo = el('span', 'hint', sl ? esc(t('{n} Einträge · {d}', { n: sl.items.length, d: fmtDur(setlistDuration(band, sl)) })) : '');
  field(s3, t('Setlist'), select([['', t('Keine')], ...band.setlists.map((l) => [l.id, l.name || t('Ohne Namen')] as [string, string])], g.setlist, (v) => {
    g.setlist = v;
    save();
    render();
  }));
  if (sl) {
    const open = el('button', 'btn plain', esc(t('Öffnen')));
    open.onclick = () => {
      tab = 'setlists';
      selList = sl.id;
      render();
    };
    const r = el('div', 'gigField');
    r.append(el('span'), slInfo, open);
    s3.appendChild(r);
  }
  const lineup = el('div', 'lineup');
  if (!band.members.length) lineup.appendChild(el('span', 'hint', esc(t('Mitglieder legst du unter „Mitglieder“ an.'))));
  for (const m of band.members) {
    const on = g.lineup.includes(m.id);
    const c = el('button', 'chipBtn' + (on ? ' on' : ''), esc(m.name || '?'));
    c.dataset.tip = m.role;
    c.onclick = () => {
      g.lineup = on ? g.lineup.filter((x) => x !== m.id) : [...g.lineup, m.id];
      save();
      render();
    };
    lineup.appendChild(c);
  }
  field(s3, t('Besetzung'), lineup);

  // contacts
  const addC = iconBtn('plus', t('Kontakt hinzufügen'), () => {
    g.contacts.push(newContact());
    save();
    render();
  }, 'tb');
  const s4 = section(right, t('Kontakte'), addC);
  if (!g.contacts.length) s4.appendChild(el('div', 'hint', esc(t('z.B. Veranstalter, Techniker, Booking'))));
  for (const c of g.contacts) {
    const r = el('div', 'contactRow');
    r.append(input(c, 'name', t('Name')), input(c, 'role', t('Rolle')), input(c, 'phone', t('Telefon')), input(c, 'email', t('E-Mail')));
    r.appendChild(iconBtn('xmark', t('Entfernen'), () => { g.contacts = g.contacts.filter((x) => x !== c); save(); render(); }, 'tb'));
    s4.appendChild(r);
  }

  // notes
  const s5 = section(d, t('Notizen'));
  const ta = el('textarea', 'pInput notes');
  ta.placeholder = t('Parken, Catering, Backline, Gage …');
  ta.value = g.notes;
  ta.oninput = () => {
    g.notes = ta.value;
    save();
  };
  s5.appendChild(ta);
  return d;
}

// ---------------- print: day sheet ----------------

function printGig(g: Gig) {
  const sl = band.setlists.find((l) => l.id === g.setlist);
  const members = band.members.filter((m) => g.lineup.includes(m.id));
  let n = 0;
  const setRows = sl
    ? sl.items.map((it) => {
        if (it.type === 'break') return `<tr class="brk"><td></td><td>${esc(it.label)}</td><td></td><td>${it.duration ? fmtDur(it.duration) : ''}</td></tr>`;
        const s = band.songs.find((x) => x.id === it.song);
        n++;
        return `<tr><td>${n}</td><td><b>${esc(s?.title ?? '')}</b>${it.note ? ` <i>${esc(it.note)}</i>` : ''}</td><td>${esc([s?.key, s?.bpm ? s.bpm + ' bpm' : ''].filter(Boolean).join(' · '))}</td><td>${s?.duration ? fmtDur(s.duration) : ''}</td></tr>`;
      }).join('')
    : '';
  const html = `<style>
#printArea.daySheet{font:13px -apple-system,Helvetica,Arial,sans-serif;color:#111;padding:8px}
.daySheet h1{font-size:22px;margin:0 0 4px}.daySheet .sub{color:#555;margin-bottom:20px}
.daySheet h2{font-size:14px;margin:22px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
.daySheet table{border-collapse:collapse;width:100%}.daySheet td{padding:4px 6px;vertical-align:top}
.daySheet tr+tr td{border-top:0.5px solid #ddd}.daySheet .brk td{color:#777;font-style:italic}
.daySheet .set td:first-child{width:28px;color:#777}.daySheet .set td:last-child{text-align:right;width:60px}
.daySheet .cols{display:flex;gap:32px}.daySheet .cols>div{flex:1}.daySheet pre{font:inherit;white-space:pre-wrap;margin:0}
</style>
<h1>${esc(g.title || g.venue || 'Gig')}</h1>
<div class="sub">${esc(fmtDate(g.date))}${g.venue ? ' · ' + esc(g.venue) : ''}${g.address ? ' · ' + esc(g.address) : ''}</div>
<div class="cols"><div><h2>${esc(t('Zeitplan'))}</h2><table>${g.schedule.filter((s) => s.time || s.label).map((s) => `<tr><td style="width:60px"><b>${esc(s.time)}</b></td><td>${esc(s.label)}</td></tr>`).join('')}</table></div>
<div><h2>${esc(t('Besetzung'))}</h2><table>${members.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.role)}</td><td style="text-align:right">${esc(m.phone)}</td></tr>`).join('')}</table></div></div>
${g.contacts.length ? `<h2>${esc(t('Kontakte'))}</h2><table>${g.contacts.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.role)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td></tr>`).join('')}</table>` : ''}
${sl ? `<h2>${esc(t('Setlist'))}: ${esc(sl.name)} · ${fmtDur(setlistDuration(band, sl))}</h2><table class="set">${setRows}</table>` : ''}
${g.notes ? `<h2>${esc(t('Notizen'))}</h2><pre>${esc(g.notes)}</pre>` : ''}`;
  document.getElementById('printArea')?.remove();
  const area = el('div', 'daySheet', html);
  area.id = 'printArea';
  document.body.appendChild(area);
  window.addEventListener('afterprint', () => setTimeout(() => area.remove(), 500), { once: true });
  void openPrintDialog();
}

// ---------------- file ----------------

async function exportBand() {
  const bytes = new TextEncoder().encode(JSON.stringify(band, null, 1));
  const name = (band.name || 'band').replace(/[\\/:*?"<>|]/g, '_');
  const r = await saveFile(`${name}.stagecraft`, bytes, undefined, STAGECRAFT);
  if (r) host.flash(t('Gespeichert: {x}', { x: r.name }));
}

async function importBand() {
  const inp = el('input');
  inp.type = 'file';
  inp.accept = '.stagecraft,.json';
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const b = normalize(JSON.parse(await f.text()));
      if (band.members.length + band.songs.length + band.gigs.length + band.setlists.length > 0
        && !(await host.confirm(t('Aktuelle Band-Daten durch „{x}“ ersetzen?', { x: b.name })))) return;
      band = b;
      save();
      render();
      host.flash(t('{x} geöffnet', { x: f.name }));
    } catch (e: any) {
      host.flash(t('Datei konnte nicht geöffnet werden: {x}', { x: t(e?.message ?? String(e)) }));
    }
  };
  inp.click();
}
