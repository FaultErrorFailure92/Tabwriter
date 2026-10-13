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
  type Song, type Phase, PHASES, newTodo, newSound,
  newBand, normalize, newMember, newSong, newSetlist, newGig, newContact, newCost, uid, settle, fmtMoney,
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
  home(): void;
  editor(): void;
  hasSong(): boolean;
  songTitle(): string;
  newSong(): void;
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

export type BandTab = Tab;

/** process order: band -> songs -> stage -> setlists -> gigs */
export const STEPS: { tab: Tab; icon: IconName; label: string }[] = [
  { tab: 'members', icon: 'people', label: 'Band' },
  { tab: 'songs', icon: 'music', label: 'Songs' },
  { tab: 'stage', icon: 'stagePlan', label: 'Bühne & Technik' },
  { tab: 'setlists', icon: 'list', label: 'Setlists' },
  { tab: 'gigs', icon: 'calendar', label: 'Gigs' },
];

/** one status line per step for the home screen */
export function stepStatus(tb: Tab): { text: string; done: boolean } {
  const b = band;
  switch (tb) {
    case 'members':
      return b.members.length ? { text: t('{n} Mitglieder', { n: b.members.length }), done: true } : { text: t('Mitglieder anlegen'), done: false };
    case 'songs': {
      const linked = b.songs.filter((s) => s.file).length;
      if (!b.songs.length) return { text: t('Songs schreiben und sammeln'), done: false };
      const per = PHASES.map((p) => [p, b.songs.filter((s) => s.phase === p.id).length] as const).filter(([, n]) => n);
      return { text: t('{n} Songs', { n: b.songs.length }) + ' · ' + per.map(([p, n]) => `${n} ${t(p.label)}`).join(', ') + (linked < b.songs.length ? ' · ' + t('{n} ohne Datei', { n: b.songs.length - linked }) : ''), done: true };
    }
    case 'stage':
      return b.gear.items.length ? { text: t('{g} Geräte · {c} Kanäle · {k} Kabel', { g: b.gear.items.length, c: b.gear.inputs.length, k: b.gear.cables.length }), done: b.gear.inputs.length > 0 } : { text: t('Equipment, Bühnenplan, Kanäle'), done: false };
    case 'setlists':
      return b.setlists.length ? { text: b.setlists.map((l) => `${l.name} (${fmtDur(setlistDuration(b, l))})`).slice(0, 2).join(' · ') + (b.setlists.length > 2 ? ' …' : ''), done: true } : { text: t('Songs zu Sets zusammenstellen'), done: false };
    case 'gigs': {
      const now = new Date().toISOString().slice(0, 10);
      const next = b.gigs.filter((g) => g.date >= now).sort((a, z) => a.date.localeCompare(z.date))[0];
      if (next) return { text: t('Nächster: {x}', { x: `${fmtDate(next.date)} · ${next.title || next.venue || t('Gig')}` }), done: true };
      return b.gigs.length ? { text: t('{n} Gigs, keiner geplant', { n: b.gigs.length }), done: true } : { text: t('Termine, Zeitplan, Rider'), done: false };
    }
  }
}

export function bandName() {
  return band.name;
}

export function openBand(to?: Tab) {
  if (to) tab = to;
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
  side.appendChild(head);

  const home = el('button', 'bandNav home', `${icon('house', 16)}<span>${esc(t('Übersicht'))}</span><kbd>⇧⌘L</kbd>`);
  home.onclick = () => host.home();
  side.appendChild(home);
  side.appendChild(el('div', 'bandNavSep'));
  const counts: Record<Tab, number> = { members: band.members.length, songs: band.songs.length, stage: band.gear.items.length, setlists: band.setlists.length, gigs: band.gigs.length };
  STEPS.forEach((st, i) => {
    const b = el('button', 'bandNav' + (tab === st.tab ? ' on' : ''), `<span class="step">${i + 1}</span>${icon(st.icon, 16)}<span>${esc(t(st.label))}</span><span class="cnt">${counts[st.tab] || ''}</span>`);
    b.dataset.tip = stepStatus(st.tab).text;
    b.onclick = () => {
      tab = st.tab;
      render();
    };
    side.appendChild(b);
    if (st.tab === 'songs' && host.hasSong()) {
      const ed = el('button', 'bandNav sub', `${icon('pencil', 14)}<span>${esc(t('Editor & Arrangement'))}</span>`);
      ed.dataset.tip = host.songTitle();
      ed.onclick = () => host.editor();
      side.appendChild(ed);
    }
  });
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
  pageHead(main, t('Band'), t('Mitglied hinzufügen'), () => {
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

let selSong = '';
let songFilter: Phase | '' = '';
let songQuery = '';

const phaseOf = (p: Phase) => PHASES.find((x) => x.id === p) ?? PHASES[0];

function phaseBadge(p: Phase): string {
  const ph = phaseOf(p);
  return `<span class="phase" style="--c:${ph.color}">${esc(t(ph.label))}</span>`;
}

function renderSongs(main: HTMLElement) {
  const cur = el('button', 'btn', `${icon('music', 14)}<span>${esc(t('Aktuellen Song übernehmen'))}</span>`);
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
    selSong = s.id;
    save();
    render();
    host.flash(ex ? t('„{x}“ aktualisiert', { x: c.title }) : t('„{x}“ hinzugefügt', { x: c.title }));
  };
  const extra = el('span', 'btnGroup');
  const nw = el('button', 'btn', `${icon('docPlus', 14)}<span>${esc(t('Neuer Song im Editor'))}</span>`);
  nw.onclick = () => host.newSong();
  extra.append(nw, cur);
  pageHead(main, t('Songs'), t('Song zur Liste hinzufügen (ohne Datei)'), () => {
    const s = newSong(t('Neuer Song'));
    band.songs.push(s);
    selSong = s.id;
    songFilter = '';
    save();
    render();
    (root.querySelector('.bandDetail .bandTitle') as HTMLInputElement | null)?.select();
  }, extra);
  if (!band.songs.length) return empty(main, t('Noch keine Songs. Übernimm den offenen Song oder lege einen mit + an.'));

  // filter by phase + search
  const bar = el('div', 'phaseBar');
  const chip = (id: Phase | '', label: string, n: number, color = '') => {
    const c = el('button', 'phaseChip' + (songFilter === id ? ' on' : ''), `${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}<span>${n}</span>`);
    c.onclick = () => {
      songFilter = id;
      render();
    };
    bar.appendChild(c);
  };
  chip('', t('Alle'), band.songs.length);
  for (const ph of PHASES) {
    const n = band.songs.filter((s) => s.phase === ph.id).length;
    if (n) chip(ph.id, t(ph.label), n, ph.color);
  }
  bar.appendChild(el('span', 'spacer'));
  const q = el('input', 'pInput search');
  q.type = 'search';
  q.placeholder = t('Suchen …');
  q.value = songQuery;
  q.oninput = () => {
    songQuery = q.value;
    const pos = q.selectionStart;
    render();
    const nq = root.querySelector('.phaseBar .search') as HTMLInputElement;
    nq.focus();
    nq.setSelectionRange(pos, pos);
  };
  bar.appendChild(q);
  main.appendChild(bar);

  const ql = songQuery.trim().toLowerCase();
  const shown = band.songs.filter((s) => (!songFilter || s.phase === songFilter) && (!ql || [s.title, s.album, s.key, s.notes].join(' ').toLowerCase().includes(ql)));
  if (!shown.some((s) => s.id === selSong)) selSong = shown[0]?.id ?? '';
  const split = el('div', 'bandSplit');
  const list = el('div', 'bandList');
  let lastAlbum: string | null = null;
  const sorted = [...shown].sort((a, z) => (a.album || '\uffff').localeCompare(z.album || '\uffff'));
  for (const s of sorted) {
    if (s.album !== lastAlbum && band.songs.some((x) => x.album)) {
      list.appendChild(el('div', 'bandGroup', esc(s.album || t('Ohne Album'))));
      lastAlbum = s.album;
    }
    const open = s.todos.filter((x) => !x.done).length;
    const r = el('div', 'bandItem' + (s.id === selSong ? ' on' : ''), `<span class="t">${esc(s.title || t('Ohne Titel'))}${s.file ? `<span class="fileDot" data-tip="${esc(baseName(s.file))}">${icon('doc', 11)}</span>` : ''}</span><span class="s">${phaseBadge(s.phase)} ${s.duration ? fmtDur(s.duration) : ''}${open ? ` · ${esc(t('{n} offen', { n: open }))}` : ''}</span>`);
    r.onclick = () => {
      selSong = s.id;
      render();
    };
    list.appendChild(r);
  }
  if (!shown.length) list.appendChild(el('div', 'bandEmpty small', esc(t('Nichts gefunden.'))));
  const total = shown.reduce((a, s) => a + s.duration, 0);
  list.appendChild(el('div', 'bandSum', esc(t('{n} Songs · {d} gesamt', { n: shown.length, d: fmtDur(total) }))));
  split.appendChild(list);
  const s = band.songs.find((x) => x.id === selSong);
  if (s) split.appendChild(songDetail(s));
  main.appendChild(split);
}

function songDetail(s: Song): HTMLElement {
  const d = el('div', 'bandDetail');
  const refreshItem = () => {
    const it = root.querySelector('.bandItem.on .t');
    if (it) it.firstChild!.textContent = s.title || t('Ohne Titel');
  };
  const top = el('div', 'detailTop');
  top.appendChild(input(s, 'title', t('Titel'), refreshItem, 'bandTitle'));
  if (s.file) {
    const open = el('button', 'btn', `${icon('pencil', 13)}<span>${esc(t('Im Editor öffnen'))}</span>`);
    open.onclick = () => void openSongFile(s.file);
    top.appendChild(open);
  }
  top.appendChild(iconBtn('trash', t('Song entfernen'), async () => {
    const used = band.setlists.some((l) => l.items.some((it) => it.type === 'song' && it.song === s.id));
    if (!(await host.confirm(used ? t('„{x}“ steht in Setlists. Trotzdem entfernen?', { x: s.title }) : t('{x} entfernen?', { x: s.title || t('Song') })))) return;
    band.songs = band.songs.filter((x) => x !== s);
    for (const l of band.setlists) l.items = l.items.filter((it) => !(it.type === 'song' && it.song === s.id));
    save();
    render();
  }));
  d.appendChild(top);

  // phase stepper
  const steps = el('div', 'phaseSteps');
  const pi = PHASES.findIndex((p) => p.id === s.phase);
  PHASES.forEach((ph, i) => {
    const b = el('button', 'phaseStep' + (i < pi ? ' past' : i === pi ? ' on' : ''), esc(t(ph.label)));
    b.style.setProperty('--c', ph.color);
    b.onclick = () => {
      s.phase = ph.id;
      save();
      render();
    };
    steps.appendChild(b);
  });
  d.appendChild(steps);

  const cols = el('div', 'gigCols');
  const left = el('div');
  const right = el('div');
  cols.append(left, right);
  d.appendChild(cols);

  const s1 = section(left, t('Steckbrief'));
  field(s1, t('Album'), (() => {
    const i = input(s, 'album', t('z.B. EP 2027'));
    i.setAttribute('list', 'albumList');
    return i;
  })());
  const dl = el('datalist');
  dl.id = 'albumList';
  for (const a of [...new Set(band.songs.map((x) => x.album).filter(Boolean))]) dl.appendChild(Object.assign(el('option'), { value: a }));
  s1.appendChild(dl);
  field(s1, t('Länge'), durInput(s));
  const bpm = input(s, 'bpm', '–', undefined, 'pInput num', 'number');
  if (!s.bpm) bpm.value = '';
  field(s1, t('BPM'), bpm);
  field(s1, t('Tonart'), input(s, 'key', 'z.B. Em'));
  const fileCell = el('span', 'fileCell');
  if (s.file) fileCell.appendChild(el('span', 'fileName', esc(baseName(s.file))));
  const lk = iconBtn('link', s.file ? t('Andere Datei verknüpfen') : t('Mit Datei verknüpfen'), () => linkMenu(lk, s), 'tb');
  fileCell.appendChild(lk);
  field(s1, t('Datei'), fileCell);
  const s2 = section(left, t('Notizen'));
  const ta = el('textarea', 'pInput notes');
  ta.placeholder = t('z.B. Capo 2, Fade-Out, Idee für die Bridge …');
  ta.value = s.notes;
  ta.oninput = () => {
    s.notes = ta.value;
    save();
  };
  s2.appendChild(ta);

  // to-dos
  const addTodo = iconBtn('plus', t('To-do hinzufügen'), () => {
    s.todos.push(newTodo());
    save();
    render();
    const all = root.querySelectorAll<HTMLInputElement>('.todoRow input[type=text]');
    all[all.length - 1]?.focus();
  }, 'tb');
  const s3 = section(right, t('To-dos'), addTodo);
  if (!s.todos.length) s3.appendChild(el('div', 'hint', esc(t('z.B. Text Strophe 2, Bass einspielen, Klick prüfen'))));
  for (const td of s.todos) {
    const r = el('div', 'todoRow' + (td.done ? ' done' : ''));
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = td.done;
    cb.onchange = () => {
      td.done = cb.checked;
      r.classList.toggle('done', td.done);
      save();
    };
    const tx = input(td, 'text', t('Was ist zu tun?'));
    tx.onkeydown = (e) => {
      if (e.key === 'Enter') {
        s.todos.splice(s.todos.indexOf(td) + 1, 0, newTodo());
        save();
        render();
        const all = root.querySelectorAll<HTMLInputElement>('.todoRow input[type=text]');
        all[s.todos.indexOf(td) + 1]?.focus();
      }
    };
    r.append(cb, tx, iconBtn('xmark', t('Entfernen'), () => { s.todos = s.todos.filter((x) => x !== td); save(); render(); }, 'tb'));
    s3.appendChild(r);
  }

  // sounds / patches
  const addSnd = iconBtn('plus', t('Sound hinzufügen'), () => {
    s.sounds.push(newSound());
    save();
    render();
  }, 'tb');
  const s4 = section(right, t('Sounds & Patches'), addSnd);
  if (!s.sounds.length) s4.appendChild(el('div', 'hint', esc(t('Welcher Helix-/Amp-Sound in welchem Teil, z.B. Refrain → 02B Crunch'))));
  for (const c of s.sounds) {
    const r = el('div', 'soundRow');
    const part = input(c, 'part', t('Teil'));
    part.setAttribute('list', 'partList');
    r.appendChild(part);
    r.appendChild(select([['', '–'], ...band.members.map((m) => [m.id, m.name || '?'] as [string, string])], c.member, (v) => { c.member = v; save(); }));
    r.appendChild(input(c, 'patch', t('Patch, z.B. 02B Crunch')));
    r.appendChild(iconBtn('xmark', t('Entfernen'), () => { s.sounds = s.sounds.filter((x) => x !== c); save(); render(); }, 'tb'));
    s4.appendChild(r);
  }
  const pl = el('datalist');
  pl.id = 'partList';
  for (const p of ['Intro', 'Strophe', 'Pre-Chorus', 'Refrain', 'Bridge', 'Solo', 'Outro', t('ganzer Song')]) pl.appendChild(Object.assign(el('option'), { value: p }));
  s4.appendChild(pl);
  return d;
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
      const r = el('div', 'bandItem' + (g.id === selGig ? ' on' : '') + (g.date && g.date < now ? ' past' : ''), `<span class="t">${esc(g.title || g.venue || t('Gig'))}${moneyBadge(g)}</span><span class="s">${esc(fmtDate(g.date))}${g.venue && g.title ? ' · ' + esc(g.venue) : ''}</span>`);
      r.onclick = () => {
        selGig = g.id;
        render();
      };
      list.appendChild(r);
    }
  };
  group(t('Kommend'), upcoming);
  group(t('Vergangen'), past);
  // fees per year
  const years = new Map<string, { fee: number; open: number }>();
  for (const g of band.gigs) {
    if (!g.money.fee || !g.date) continue;
    const y = g.date.slice(0, 4);
    const v = years.get(y) ?? { fee: 0, open: 0 };
    v.fee += g.money.fee;
    if (!g.money.paid) v.open += g.money.fee;
    years.set(y, v);
  }
  for (const [y, v] of [...years].sort().reverse()) {
    list.appendChild(el('div', 'bandSum', esc(t('Gagen {y}: {a}', { y, a: fmtMoney(v.fee) }) + (v.open ? ' · ' + t('offen {a}', { a: fmtMoney(v.open) }) : ''))));
  }
  split.appendChild(list);
  split.appendChild(gigDetail(band.gigs.find((g) => g.id === selGig)!));
  main.appendChild(split);
}

/** small marker in the gig list: unpaid fee */
function moneyBadge(g: Gig): string {
  if (!g.money.fee) return '';
  return g.money.paid ? `<span class="money ok" data-tip="${esc(t('Gage bezahlt'))}">€</span>` : `<span class="money" data-tip="${esc(t('Gage offen'))}">€</span>`;
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
    it.querySelector('.t')!.innerHTML = esc(g.title || g.venue || t('Gig')) + moneyBadge(g);
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

  // money
  const sm = section(right, t('Gage & Kosten'));
  const sumBox = el('div', 'moneySum');
  const upd = () => {
    const r = settle(band, g);
    sumBox.innerHTML =
      `<div><span>${esc(t('Kosten'))}</span><b>${fmtMoney(r.costs)}</b></div>` +
      `<div><span>${esc(t('Bleibt'))}</span><b class="${r.net < 0 ? 'neg' : ''}">${fmtMoney(r.net)}</b></div>` +
      (r.payout.length ? `<div><span>${esc(t('Pro Kopf'))}</span><b>${fmtMoney(r.share)}</b></div>` : '') +
      (r.payout.some((p) => Math.abs(p.amount - r.share) > 0.005)
        ? `<div class="payout">${r.payout.map((p) => `<span>${esc(band.members.find((m) => m.id === p.member)?.name ?? '?')}: ${fmtMoney(p.amount)}</span>`).join('')}</div>`
        : '');
  };
  const feeRow = el('div', 'gigField');
  feeRow.appendChild(el('span', '', esc(t('Gage'))));
  const fee = input(g.money, 'fee', '0', upd, 'pInput num', 'number');
  fee.step = '10';
  if (!g.money.fee) fee.value = '';
  feeRow.appendChild(fee);
  const paid = el('label', 'paid');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = g.money.paid;
  cb.onchange = () => {
    g.money.paid = cb.checked;
    save();
    refreshItem();
  };
  paid.append(cb, document.createTextNode(t('bezahlt')));
  feeRow.appendChild(paid);
  sm.appendChild(feeRow);
  for (const c of g.money.costs) {
    const r = el('div', 'costRow');
    r.appendChild(input(c, 'label', t('z.B. Sprit, Hotel')));
    const amt = input(c, 'amount', '0', upd, 'pInput num', 'number');
    if (!c.amount) amt.value = '';
    r.appendChild(amt);
    r.appendChild(select([['', t('Bandkasse')], ...band.members.map((m) => [m.id, t('ausgelegt: {x}', { x: m.name || '?' })] as [string, string])], c.paidBy, (v) => {
      c.paidBy = v;
      save();
      upd();
    }));
    r.appendChild(iconBtn('xmark', t('Entfernen'), () => { g.money.costs = g.money.costs.filter((x) => x !== c); save(); render(); }, 'tb'));
    sm.appendChild(r);
  }
  const addCost = el('button', 'btn plain', `${icon('plus', 12)}<span>${esc(t('Kosten hinzufügen'))}</span>`);
  addCost.onclick = () => {
    g.money.costs.push(newCost());
    save();
    render();
  };
  sm.appendChild(addCost);
  sm.appendChild(sumBox);
  upd();

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
