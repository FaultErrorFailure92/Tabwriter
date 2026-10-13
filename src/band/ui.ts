// Stagecraft band area: one shell (sidebar + pages) for overview, band, songs, stage, setlists, gigs.
// Every page uses the same building blocks from kit.ts.
import { t } from '../i18n';
import { icon, type IconName } from '../icons';
import { dbGet, dbPut } from '../library';
import { saveFile, type FileType } from '../io';
import { openPrintDialog } from '../print';
import { renderStage, printRider } from './stage';
import { renderTickets, printDoorList, importExcel } from './tickets';
import { renderIdeas, ideaAddItems, collectAudio, restoreAudio } from './ideas';
import type { Clip } from '../editor';
import { el, iconBtn, input, durInput, select, moveItem, esc, setSaver } from './dom';
import {
  pageHead, detailHead, card, row, hint, emptyState, toggle, columns, tabs, searchField, popMenu,
  wizard, wizInput, wizField, choices, type MenuItem,
} from './kit';
import {
  type Band, type Gig, type Setlist, type SetItem, type Member,
  type Song, type Phase, PHASES, newTodo, newSound,
  newBand, normalize, newMember, newSong, newSetlist, newGig, newContact, newCost, uid, settle, fmtMoney,
  setlistDuration, fmtDur, ticketTotals,
} from './model';

export const STAGECRAFT: FileType = { desc: 'Stagecraft', ext: 'stagecraft', mime: 'application/json' };
const DB_KEY = '__band';

type Tab = 'home' | 'gigs' | 'setlists' | 'songs' | 'members' | 'stage';
export type BandTab = Tab;

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
  /** back to the start: band overview or the Tabwriter start screen */
  home(): void;
  editor(): void;
  hasSong(): boolean;
  songTitle(): string;
  newSong(title?: string): void;
  snippet(): Clip | null;
  useClip(c: Clip): void;
  confirm(msg: string): Promise<boolean>;
  /** songs from the library: file = path (desktop) or file name (browser) */
  recentFiles(): { label: string; file: string }[];
  /** choose a file on disk and keep it in the library; returns its file key */
  pickFile(): Promise<{ label: string; file: string } | null>;
  /** open the score in the editor; false if not found */
  openFile(file: string): Promise<boolean>;
  /** put the Tabwriter part of the start screen (new/open/demo, recent songs) into the container */
  mountTabwriter(box: HTMLElement): void;
}

const baseName = (f: string) => f.split(/[\\/]/).pop() ?? f;

let band: Band = newBand();
let host: BandHost;
let tab: Tab = 'home';
let selGig = '';
let selList = '';
let selMember = '';
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

/** a band exists -> the app runs as Stagecraft; otherwise only Tabwriter */
export function bandReady(): boolean {
  return !!band.setup;
}

export function bandOpen() {
  return !!root && !root.classList.contains('hidden');
}

/** process order: band -> songs -> stage -> setlists -> gigs */
export const STEPS: { tab: Exclude<Tab, 'home'>; icon: IconName; label: string }[] = [
  { tab: 'members', icon: 'people', label: 'Band' },
  { tab: 'songs', icon: 'music', label: 'Songs' },
  { tab: 'stage', icon: 'stagePlan', label: 'Bühne & Technik' },
  { tab: 'setlists', icon: 'list', label: 'Setlists' },
  { tab: 'gigs', icon: 'calendar', label: 'Gigs' },
];

export function bandName() {
  return band.name;
}

export function openBand(to?: Tab) {
  if (!bandReady()) {
    void bandWizard();
    return;
  }
  if (to) tab = to;
  render();
  root.classList.remove('hidden');
}

export function closeBand() {
  root.classList.add('hidden');
}

/** after the editor saved a file: link it to the band song with the same title */
export function songSaved(title: string, file: string) {
  if (!bandReady() || !file) return;
  const s = band.songs.find((x) => !x.file && x.title.trim().toLowerCase() === title.trim().toLowerCase());
  if (!s) return;
  s.file = file;
  save();
}

function fmtDate(d: string, long = true): string {
  if (!d) return t('Ohne Datum');
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, long ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const today = () => new Date().toISOString().slice(0, 10);
const memberName = (id: string) => band.members.find((m) => m.id === id)?.name || '?';

async function openSongFile(file: string) {
  if (!(await host.openFile(file))) host.flash(t('Datei nicht gefunden: {x}', { x: baseName(file) }));
  else closeBand();
}

function go(to: Tab) {
  tab = to;
  render();
}

// ---------------- shell ----------------

function render() {
  document.getElementById('kitPop')?.remove();
  // the Tabwriter start block is borrowed from #library: give it back before clearing
  const lw = root.querySelector('.libWrap');
  if (lw) document.getElementById('library')?.appendChild(lw);
  root.innerHTML = '';
  root.appendChild(sidebar());
  const main = el('main', 'bandMain');
  root.appendChild(main);
  if (tab === 'home') renderHome(main);
  else if (tab === 'gigs') renderGigs(main);
  else if (tab === 'setlists') renderSetlists(main);
  else if (tab === 'songs') renderSongs(main);
  else if (tab === 'stage') renderStage(main, band, render, (m) => host.confirm(m));
  else renderMembers(main);
}

function initials(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? w[0]?.[1] ?? '')).toUpperCase() || '♪';
}

function sidebar(): HTMLElement {
  const side = el('aside', 'bandSide');
  // band switcher: file actions now, several bands once there are accounts
  const sw = el('button', 'bandSw', `<span class="bandLogo">${esc(initials(band.name))}</span><b>${esc(band.name || t('Band'))}</b>${icon('chevronDown', 12)}`);
  sw.dataset.tip = t('Band-Datei, neue Band');
  sw.onclick = () => popMenu(sw, [
    { icon: 'folder', label: t('Band-Datei öffnen …'), fn: () => void importBand() },
    { icon: 'save', label: t('Band-Datei speichern …'), fn: () => void exportBand() },
    'sep',
    { icon: 'plus', label: t('Neue Band einrichten …'), fn: () => void bandWizard(true) },
  ]);
  side.appendChild(sw);

  const nav = (cls: string, html: string, fn: () => void, tip = '') => {
    const b = el('button', 'bandNav ' + cls, html);
    if (tip) b.dataset.tip = tip;
    b.onclick = fn;
    side.appendChild(b);
    return b;
  };
  nav('home' + (tab === 'home' ? ' on' : ''), `${icon('house', 16)}<span>${esc(t('Übersicht'))}</span><kbd>⇧⌘L</kbd>`, () => go('home'));
  side.appendChild(el('div', 'bandNavSep'));
  const counts: Record<string, number> = { members: band.members.length, songs: band.songs.length, stage: band.gear.items.length, setlists: band.setlists.length, gigs: band.gigs.length };
  STEPS.forEach((st, i) => {
    nav(tab === st.tab ? 'on' : '', `<span class="step">${i + 1}</span>${icon(st.icon, 16)}<span>${esc(t(st.label))}</span><span class="cnt">${counts[st.tab] || ''}</span>`, () => go(st.tab), `⌘${i + 1}`);
    if (st.tab === 'songs' && host.hasSong()) {
      nav('sub', `${icon('pencil', 14)}<span>${esc(host.songTitle() || t('Editor'))}</span>`, () => host.editor(), t('Zurück in den Editor (Esc)'));
    }
  });
  side.appendChild(el('span', 'spacer'));
  // account: reserved for the coming account system
  const acct = el('button', 'acct', `<span class="av">${icon('people', 14)}</span><span><b>${esc(t('Lokal'))}</b><small>${esc(t('Anmelden – bald verfügbar'))}</small></span>`);
  acct.onclick = () => host.flash(t('Accounts kommen bald. Bis dahin bleiben alle Daten auf diesem Gerät.'));
  side.appendChild(acct);
  return side;
}

/** list | detail */
function split(main: HTMLElement): [HTMLElement, HTMLElement] {
  const s = el('div', 'bandSplit');
  const l = el('div', 'bandList');
  s.appendChild(l);
  main.appendChild(s);
  return [l, s];
}

function listItem(list: HTMLElement, on: boolean, title: string, sub: string, fn: () => void, cls = '') {
  const r = el('div', 'bandItem' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), `<span class="t">${title}</span><span class="s">${sub}</span>`);
  r.onclick = fn;
  list.appendChild(r);
  return r;
}

function detail(): HTMLElement {
  return el('div', 'bandDetail');
}

function titleInput<T extends object>(obj: T, key: keyof T, ph: string, onChange?: () => void) {
  return input(obj, key, ph, onChange, 'bandTitle');
}

const phaseOf = (p: Phase) => PHASES.find((x) => x.id === p) ?? PHASES[0];
function phaseBadge(p: Phase): string {
  const ph = phaseOf(p);
  return `<span class="phase" style="--c:${ph.color}">${esc(t(ph.label))}</span>`;
}

// ---------------- overview ----------------

function renderHome(main: HTMLElement) {
  pageHead(main, { title: t('Übersicht') });
  const grid = el('div', 'homeGrid');
  main.appendChild(grid);

  // next gig
  const now = today();
  const next = band.gigs.filter((g) => g.date >= now).sort((a, z) => a.date.localeCompare(z.date))[0];
  const c1 = card(grid, t('Nächster Gig'));
  if (next) {
    const tk = ticketTotals(next.tickets);
    const r = el('div', 'linkRow', `<b>${esc(next.title || next.venue || t('Gig'))}</b><span>${esc(fmtDate(next.date))}${next.venue ? ' · ' + esc(next.venue) : ''}</span>${tk.sold ? `<span>${esc(t('{n} Karten verkauft', { n: tk.sold }))}</span>` : ''}`);
    r.onclick = () => {
      selGig = next.id;
      go('gigs');
    };
    c1.appendChild(r);
  } else hint(c1, t('Kein Gig geplant.'));

  // songs in progress
  const busy = band.songs.filter((s) => ['idea', 'writing', 'arrangement', 'production'].includes(s.phase));
  const c2 = card(grid, t('Songs in Arbeit'));
  if (!busy.length) hint(c2, band.songs.length ? t('Alle Songs sind fertig.') : t('Noch keine Songs.'));
  for (const s of busy.slice(0, 6)) {
    const open = s.todos.filter((x) => !x.done).length;
    const r = el('div', 'linkRow', `<b>${esc(s.title || t('Ohne Titel'))}</b><span>${phaseBadge(s.phase)}${open ? ' ' + esc(t('{n} offen', { n: open })) : ''}</span>`);
    r.onclick = () => {
      selSong = s.id;
      songSub = 'songs';
      go('songs');
    };
    c2.appendChild(r);
  }

  // open to-dos
  const todos = band.songs.flatMap((s) => s.todos.filter((x) => !x.done && x.text.trim()).map((x) => ({ s, x })));
  const c3 = card(grid, t('Offene To-dos'));
  if (!todos.length) hint(c3, t('Nichts offen.'));
  for (const { s, x } of todos.slice(0, 6)) {
    const r = el('div', 'linkRow', `<b>${esc(x.text)}</b><span>${esc(s.title)}</span>`);
    r.onclick = () => {
      selSong = s.id;
      songSub = 'songs';
      go('songs');
    };
    c3.appendChild(r);
  }

  const tw = el('div', 'homeTabwriter');
  tw.appendChild(el('h3', 'homeSec', `${esc(t('Songs schreiben'))} <span>Tabwriter</span>`));
  main.appendChild(tw);
  host.mountTabwriter(tw);
}

// ---------------- band (members) ----------------

function renderMembers(main: HTMLElement) {
  const name = input(band, 'name', t('Name der Band'), () => {
    const b = root.querySelector('.bandSw b');
    if (b) b.textContent = band.name || t('Band');
  }, 'bandTitle pageTitle');
  pageHead(main, { title: name, primary: { label: t('Mitglied'), tip: t('Mitglied hinzufügen'), fn: () => void memberWizard() } });
  if (!band.members.length) return emptyState(main, t('Noch keine Mitglieder.'));
  if (!band.members.some((m) => m.id === selMember)) selMember = band.members[0].id;
  const [list, sp] = split(main);
  for (const m of band.members) {
    listItem(list, m.id === selMember, esc(m.name || t('Ohne Namen')), esc(m.role || '–'), () => {
      selMember = m.id;
      render();
    });
  }
  sp.appendChild(memberDetail(band.members.find((m) => m.id === selMember)!));
}

function memberDetail(m: Member): HTMLElement {
  const d = detail();
  const refresh = () => {
    const it = root.querySelector('.bandItem.on');
    if (!it) return;
    it.querySelector('.t')!.textContent = m.name || t('Ohne Namen');
    it.querySelector('.s')!.textContent = m.role || '–';
  };
  detailHead(d, {
    title: titleInput(m, 'name', t('Name'), refresh),
    menu: () => [{ icon: 'trash', label: t('Mitglied entfernen'), danger: true, fn: () => void removeMember(m) }],
  });
  const [l, r] = columns(d);
  const c = card(l, t('Kontakt'));
  row(c, t('Instrument / Rolle'), input(m, 'role', t('z.B. Gitarre, Gesang'), refresh));
  row(c, t('Telefon'), input(m, 'phone', '+43 …'));
  row(c, t('E-Mail'), input(m, 'email', 'name@…', undefined, 'pInput', 'email'));
  const g = card(r, t('Equipment'));
  const chain = band.gear.items.filter((x) => x.member === m.id).sort((a, z) => a.chain - z.chain);
  if (!chain.length) hint(g, t('Noch kein Equipment. Die Signalkette legst du unter „Bühne & Technik“ an.'));
  chain.forEach((x, i) => g.appendChild(el('div', 'plainRow', `<span class="num">${i + 1}</span><span>${esc(x.name || t(x.kind))}</span>`)));
  return d;
}

async function removeMember(m: Member) {
  if (!(await host.confirm(t('{x} entfernen?', { x: m.name || t('Mitglied') })))) return;
  band.members = band.members.filter((x) => x !== m);
  for (const g of band.gigs) g.lineup = g.lineup.filter((id) => id !== m.id);
  save();
  render();
}

// ---------------- songs ----------------

let selSong = '';
let songSub: 'songs' | 'ideas' = 'songs';
let songFilter: Phase | '' = '';
let songQuery = '';

const ideaHost = () => ({
  snippet: () => host.snippet(),
  useClip: (c: Clip) => host.useClip(c),
  flash: (m: string) => host.flash(m),
  confirm: (m: string) => host.confirm(m),
  openSongs: (id: string) => {
    songSub = 'songs';
    selSong = id;
    render();
  },
});

function renderSongs(main: HTMLElement) {
  const tb = tabs<'songs' | 'ideas'>([['songs', t('Songs'), band.songs.length], ['ideas', t('Ideen'), band.ideas.length]], songSub, (k) => {
    songSub = k;
    render();
  });
  if (songSub === 'ideas') {
    pageHead(main, { title: t('Songs'), tabs: tb, primary: { label: t('Idee'), tip: t('Riff, Sprachmemo, Audio oder Text'), fn: (a) => popMenu(a, ideaAddItems(band, ideaHost(), render)) } });
    renderIdeas(main, band, ideaHost(), render);
    return;
  }
  pageHead(main, { title: t('Songs'), tabs: tb, primary: { label: t('Song'), tip: t('Song anlegen'), fn: () => void songWizard() } });
  if (!band.songs.length) return emptyState(main, t('Noch keine Songs.'));

  const ql = songQuery.trim().toLowerCase();
  const shown = band.songs.filter((s) => (!songFilter || s.phase === songFilter) && (!ql || [s.title, s.album, s.key, s.notes].join(' ').toLowerCase().includes(ql)));
  if (!shown.some((s) => s.id === selSong)) selSong = shown[0]?.id ?? '';
  const [list, sp] = split(main);
  list.appendChild(searchField(songQuery, (v) => {
    songQuery = v;
    render();
  }, 'songSearch'));
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
  list.appendChild(bar);
  let lastAlbum: string | null = null;
  const sorted = [...shown].sort((a, z) => (a.album || '￿').localeCompare(z.album || '￿'));
  for (const s of sorted) {
    if (s.album !== lastAlbum && band.songs.some((x) => x.album)) {
      list.appendChild(el('div', 'bandGroup', esc(s.album || t('Ohne Album'))));
      lastAlbum = s.album;
    }
    const open = s.todos.filter((x) => !x.done).length;
    listItem(list, s.id === selSong,
      `${esc(s.title || t('Ohne Titel'))}${s.file ? `<span class="fileDot" data-tip="${esc(baseName(s.file))}">${icon('doc', 11)}</span>` : ''}`,
      `${phaseBadge(s.phase)} ${s.duration ? fmtDur(s.duration) : ''}${open ? ` · ${esc(t('{n} offen', { n: open }))}` : ''}`,
      () => {
        selSong = s.id;
        render();
      });
  }
  if (!shown.length) list.appendChild(el('div', 'bandEmpty small', esc(t('Nichts gefunden.'))));
  list.appendChild(el('div', 'bandSum', esc(t('{n} Songs · {d} gesamt', { n: shown.length, d: fmtDur(shown.reduce((a, s) => a + s.duration, 0)) }))));
  const s = band.songs.find((x) => x.id === selSong);
  if (s) sp.appendChild(songDetail(s));
}

function linkMenu(anchor: HTMLElement, s: Song) {
  const items: MenuItem[] = [{
    icon: 'folder', label: t('Datei wählen …'), fn: async () => {
      const f = await host.pickFile();
      if (!f) return;
      s.file = f.file;
      if (!s.title) s.title = f.label;
      save();
      render();
    },
  }];
  const recent = host.recentFiles();
  if (recent.length) items.push('sep');
  for (const r of recent.slice(0, 12)) {
    items.push({ icon: r.file === s.file ? 'checkmark' : 'doc', label: r.label, fn: () => { s.file = r.file; if (!s.title) s.title = r.label; save(); render(); } });
  }
  if (s.file) items.push('sep', { icon: 'unlink', label: t('Verknüpfung lösen'), danger: true, fn: () => { s.file = ''; save(); render(); } });
  popMenu(anchor, items);
}

function songDetail(s: Song): HTMLElement {
  const d = detail();
  const refreshItem = () => {
    const it = root.querySelector('.bandItem.on .t');
    if (it) it.firstChild!.textContent = s.title || t('Ohne Titel');
  };
  let action: HTMLElement | undefined;
  if (s.file) {
    action = el('button', 'btn', `${icon('pencil', 13)}<span>${esc(t('Im Editor öffnen'))}</span>`);
    action.onclick = () => void openSongFile(s.file);
  }
  const cur = host.currentSong();
  detailHead(d, {
    title: titleInput(s, 'title', t('Titel'), refreshItem),
    action,
    menu: () => [
      ...(cur && cur.file && cur.file === s.file ? [{ icon: 'restore' as IconName, label: t('Tempo & Länge aus dem Editor übernehmen'), fn: () => { s.bpm = cur.bpm; s.duration = cur.duration; save(); render(); } }, 'sep' as const] : []),
      { icon: 'trash', label: t('Song entfernen'), danger: true, fn: () => void removeSong(s) },
    ],
  });

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

  const [left, right] = columns(d);
  const s1 = card(left, t('Steckbrief'));
  const album = input(s, 'album', t('z.B. EP 2027'));
  album.setAttribute('list', 'albumList');
  row(s1, t('Album'), album);
  const dl = el('datalist');
  dl.id = 'albumList';
  for (const a of [...new Set(band.songs.map((x) => x.album).filter(Boolean))]) dl.appendChild(Object.assign(el('option'), { value: a }));
  s1.appendChild(dl);
  row(s1, t('Länge'), durInput(s));
  const bpm = input(s, 'bpm', '–', undefined, 'pInput num', 'number');
  if (!s.bpm) bpm.value = '';
  row(s1, t('BPM'), bpm);
  row(s1, t('Tonart'), input(s, 'key', 'z.B. Em'));
  const fileCell = el('span', 'fileCell');
  fileCell.appendChild(el('span', 'fileName' + (s.file ? '' : ' dim'), esc(s.file ? baseName(s.file) : t('keine'))));
  const lk = iconBtn('link', s.file ? t('Andere Datei verknüpfen') : t('Mit Datei verknüpfen'), () => linkMenu(lk, s), 'tb');
  fileCell.appendChild(lk);
  row(s1, t('Datei'), fileCell);
  const s2 = card(left, t('Notizen'));
  const ta = el('textarea', 'pInput notes');
  ta.placeholder = t('z.B. Capo 2, Fade-Out, Idee für die Bridge …');
  ta.value = s.notes;
  ta.oninput = () => {
    s.notes = ta.value;
    save();
  };
  s2.appendChild(ta);

  const s3 = card(right, t('To-dos'), {
    addTip: t('To-do hinzufügen'),
    add: () => {
      s.todos.push(newTodo());
      save();
      render();
      const all = root.querySelectorAll<HTMLInputElement>('.todoRow input[type=text]');
      all[all.length - 1]?.focus();
    },
  });
  if (!s.todos.length) hint(s3, t('z.B. Text Strophe 2, Bass einspielen, Klick prüfen'));
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

  const s4 = card(right, t('Sounds & Patches'), { addTip: t('Sound hinzufügen'), add: () => { s.sounds.push(newSound()); save(); render(); } });
  if (!s.sounds.length) hint(s4, t('Welcher Helix-/Amp-Sound in welchem Teil, z.B. Refrain → 02B Crunch'));
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

async function removeSong(s: Song) {
  const used = band.setlists.some((l) => l.items.some((it) => it.type === 'song' && it.song === s.id));
  if (!(await host.confirm(used ? t('„{x}“ steht in Setlists. Trotzdem entfernen?', { x: s.title }) : t('{x} entfernen?', { x: s.title || t('Song') })))) return;
  band.songs = band.songs.filter((x) => x !== s);
  for (const l of band.setlists) l.items = l.items.filter((it) => !(it.type === 'song' && it.song === s.id));
  save();
  render();
}

// ---------------- setlists ----------------

function renderSetlists(main: HTMLElement) {
  pageHead(main, { title: t('Setlists'), primary: { label: t('Setlist'), tip: t('Setlist anlegen'), fn: () => void setlistWizard() } });
  if (!band.setlists.length) return emptyState(main, t('Noch keine Setlists.'));
  if (!band.setlists.some((l) => l.id === selList)) selList = band.setlists[0].id;
  const [list, sp] = split(main);
  for (const l of band.setlists) {
    listItem(list, l.id === selList, esc(l.name || t('Ohne Namen')), esc(t('{n} Einträge · {d}', { n: l.items.length, d: fmtDur(setlistDuration(band, l)) })), () => {
      selList = l.id;
      render();
    });
  }
  sp.appendChild(setlistDetail(band.setlists.find((x) => x.id === selList)!));
}

function setlistDetail(l: Setlist): HTMLElement {
  const d = detail();
  detailHead(d, {
    title: titleInput(l, 'name', t('Name der Setlist'), () => {
      const it = root.querySelector('.bandItem.on .t');
      if (it) it.textContent = l.name || t('Ohne Namen');
    }),
    meta: fmtDur(setlistDuration(band, l)),
    menu: () => [
      { icon: 'duplicate', label: t('Duplizieren (z.B. kurze Variante)'), fn: () => {
        const c: Setlist = JSON.parse(JSON.stringify(l));
        c.id = uid('l');
        c.name = `${l.name} (${t('Kopie')})`;
        c.items.forEach((it) => (it.id = uid('i')));
        band.setlists.push(c);
        selList = c.id;
        save();
        render();
      } },
      'sep',
      { icon: 'trash', label: t('Setlist löschen'), danger: true, fn: async () => {
        if (!(await host.confirm(t('{x} löschen?', { x: l.name || t('Setlist') })))) return;
        band.setlists = band.setlists.filter((x) => x !== l);
        for (const g of band.gigs) if (g.setlist === l.id) g.setlist = '';
        save();
        render();
      } },
    ],
  });

  const used = new Set(l.items.map((it) => (it.type === 'song' ? it.song : '')));
  const c = card(d, t('Ablauf'), {
    addTip: t('Song oder Pause hinzufügen'),
    add: (a) => popMenu(a, [
      { icon: 'pause', label: t('Pause / Ansage'), fn: () => { l.items.push({ id: uid('i'), type: 'break', label: t('Pause'), duration: 0 }); save(); render(); } },
      'sep',
      ...band.songs.map((s): MenuItem => ({ icon: used.has(s.id) ? 'checkmark' : 'music', label: s.title || t('Ohne Titel'), fn: () => { l.items.push({ id: uid('i'), type: 'song', song: s.id, note: '' } as SetItem); save(); render(); } })),
    ], 'scroll'),
  });
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
      r.appendChild(el('span', 'meta', esc([s?.key, s?.bpm ? `${s.bpm} bpm` : ''].filter(Boolean).join(' · '))));
      r.appendChild(input(it, 'note', t('Notiz, z.B. Fade-Out'), undefined, 'pInput note'));
      r.appendChild(el('span', 'dur', s?.duration ? fmtDur(s.duration) : '–'));
    } else {
      r.appendChild(el('span', 'num', icon('pause', 12)));
      r.appendChild(input(it, 'label', t('Pause / Ansage'), undefined, 'pInput name'));
      r.appendChild(el('span', 'meta'));
      r.appendChild(el('span', 'note'));
      r.appendChild(durInput(it, () => {
        const m = root.querySelector('.dHead .dMeta');
        if (m) m.textContent = fmtDur(setlistDuration(band, l));
      }));
    }
    const tools = el('span', 'tools');
    tools.appendChild(iconBtn('chevronUp', t('Nach oben'), () => { moveItem(l.items, i, -1); save(); render(); }, 'tb'));
    tools.appendChild(iconBtn('chevronDown', t('Nach unten'), () => { moveItem(l.items, i, 1); save(); render(); }, 'tb'));
    tools.appendChild(iconBtn('xmark', t('Entfernen'), () => { l.items.splice(i, 1); save(); render(); }, 'tb'));
    r.appendChild(tools);
    items.appendChild(r);
  });
  if (!l.items.length) hint(c, band.songs.length ? t('Noch leer. Songs und Pausen fügst du mit + hinzu.') : t('Noch keine Songs in der Band. Lege sie unter „Songs“ an.'));
  c.appendChild(items);
  dragRows(items, (from, to) => {
    const [it] = l.items.splice(from, 1);
    l.items.splice(to, 0, it);
    save();
    render();
  });
  return d;
}

/** reorder rows by dragging (not from inputs or buttons) */
function dragRows(box: HTMLElement, done: (from: number, to: number) => void) {
  box.addEventListener('mousedown', (e) => {
    const t0 = e.target as HTMLElement;
    if (t0.closest('input, button, select, textarea')) return;
    const r0 = t0.closest('.setRow') as HTMLElement | null;
    if (!r0) return;
    const rows = Array.from(box.querySelectorAll<HTMLElement>('.setRow'));
    const from = rows.indexOf(r0);
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
      r0.classList.add('dragging');
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

let gigSub: 'plan' | 'tickets' | 'money' = 'plan';

function gigLabel(g: Gig) {
  return g.title || g.venue || t('Gig');
}

function renderGigs(main: HTMLElement) {
  pageHead(main, { title: t('Gigs'), primary: { label: t('Gig'), tip: t('Gig anlegen'), fn: () => void gigWizard() } });
  if (!band.gigs.length) return emptyState(main, t('Noch keine Gigs.'));
  if (!band.gigs.some((g) => g.id === selGig)) selGig = band.gigs[0].id;
  const now = today();
  const sorted = [...band.gigs].sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  const upcoming = sorted.filter((g) => !g.date || g.date >= now);
  const past = sorted.filter((g) => g.date && g.date < now).reverse();
  const [list, sp] = split(main);
  const group = (title: string, gigs: Gig[]) => {
    if (!gigs.length) return;
    list.appendChild(el('div', 'bandGroup', esc(title)));
    for (const g of gigs) {
      listItem(list, g.id === selGig, esc(gigLabel(g)) + moneyBadge(g), esc(fmtDate(g.date)) + (g.venue && g.title ? ' · ' + esc(g.venue) : '') + presaleInfo(g), () => {
        selGig = g.id;
        render();
      }, g.date && g.date < now ? 'past' : '');
    }
  };
  group(t('Kommend'), upcoming);
  group(t('Vergangen'), past);
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
  sp.appendChild(gigDetail(band.gigs.find((g) => g.id === selGig)!));
}

function presaleInfo(g: Gig): string {
  const n = g.tickets.buyers.reduce((a, b) => a + b.normal + b.held, 0);
  return n ? ` · ${esc(t('{n} VVK', { n }))}` : '';
}

function moneyBadge(g: Gig): string {
  if (!g.money.fee) return '';
  return g.money.paid ? `<span class="money ok" data-tip="${esc(t('Gage bezahlt'))}">€</span>` : `<span class="money" data-tip="${esc(t('Gage offen'))}">€</span>`;
}

function gigDetail(g: Gig): HTMLElement {
  const d = detail();
  const refreshItem = () => {
    const it = root.querySelector('.bandItem.on');
    if (!it) return;
    it.querySelector('.t')!.innerHTML = esc(gigLabel(g)) + moneyBadge(g);
    it.querySelector('.s')!.innerHTML = esc(fmtDate(g.date)) + (g.venue && g.title ? ' · ' + esc(g.venue) : '') + presaleInfo(g);
  };
  detailHead(d, {
    title: titleInput(g, 'title', g.venue || t('Titel, z.B. Release-Show'), refreshItem),
    meta: fmtDate(g.date, false),
    menu: () => [
      { icon: 'printer', label: t('Tagesplan drucken'), fn: () => printGig(g) },
      { icon: 'stagePlan', label: t('Rider drucken'), fn: () => printRider(band, g) },
      { icon: 'ticket', label: t('Türliste drucken'), fn: () => printDoorList(band, g) },
      'sep',
      { icon: 'folder', label: t('Vorverkauf aus Excel importieren …'), fn: () => importExcel(band, g, render, (m) => host.confirm(m), (m) => host.flash(m)) },
      { icon: 'duplicate', label: t('Gig duplizieren'), fn: () => {
        const c: Gig = JSON.parse(JSON.stringify(g));
        c.id = uid('g');
        c.title = g.title ? `${g.title} (${t('Kopie')})` : '';
        band.gigs.push(c);
        selGig = c.id;
        save();
        render();
      } },
      'sep',
      { icon: 'trash', label: t('Gig löschen'), danger: true, fn: async () => {
        if (!(await host.confirm(t('{x} löschen?', { x: gigLabel(g) })))) return;
        band.gigs = band.gigs.filter((x) => x !== g);
        save();
        render();
      } },
    ],
    tabs: tabs<'plan' | 'tickets' | 'money'>([['plan', t('Planung')], ['tickets', t('Vorverkauf')], ['money', t('Abrechnung')]], gigSub, (k) => {
      gigSub = k;
      render();
    }, 'gigSeg'),
  });
  if (gigSub === 'tickets') renderTickets(d, band, g, render, (m) => host.confirm(m));
  else if (gigSub === 'money') renderMoney(d, g, refreshItem);
  else renderPlan(d, g, refreshItem);
  return d;
}

function renderPlan(d: HTMLElement, g: Gig, refreshItem: () => void) {
  const [left, right] = columns(d);
  const s1 = card(left, t('Wann & wo'));
  row(s1, t('Datum'), input(g, 'date', '', () => {
    refreshItem();
    const m = root.querySelector('.dHead .dMeta');
    if (m) m.textContent = fmtDate(g.date, false);
  }, 'pInput', 'date'));
  row(s1, t('Venue'), input(g, 'venue', t('Name des Clubs'), refreshItem));
  row(s1, t('Adresse'), input(g, 'address', t('Straße, Ort')));

  const s2 = card(left, t('Zeitplan'), { addTip: t('Zeitpunkt hinzufügen'), add: () => { g.schedule.push({ id: uid('t'), label: '', time: '' }); save(); render(); } });
  if (!g.schedule.length) hint(s2, t('z.B. Get-in, Soundcheck, Show'));
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

  const s3 = card(right, t('Setlist & Besetzung'));
  const sl = band.setlists.find((l) => l.id === g.setlist);
  const goSl = sl ? iconBtn('arrowRight', t('Setlist öffnen'), () => { selList = sl.id; go('setlists'); }, 'tb') : undefined;
  row(s3, t('Setlist'), select([['', t('Keine')], ...band.setlists.map((l) => [l.id, `${l.name || t('Ohne Namen')} · ${fmtDur(setlistDuration(band, l))}`] as [string, string])], g.setlist, (v) => {
    g.setlist = v;
    save();
    render();
  }), goSl);
  const lineup = el('div', 'lineup');
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
  row(s3, t('Besetzung'), lineup);

  const s4 = card(right, t('Kontakte'), { addTip: t('Kontakt hinzufügen'), add: () => { g.contacts.push(newContact()); save(); render(); } });
  if (!g.contacts.length) hint(s4, t('z.B. Veranstalter, Techniker, Booking'));
  for (const c of g.contacts) {
    const r = el('div', 'contactRow');
    r.append(input(c, 'name', t('Name')), input(c, 'role', t('Rolle')), input(c, 'phone', t('Telefon')), input(c, 'email', t('E-Mail')));
    r.appendChild(iconBtn('xmark', t('Entfernen'), () => { g.contacts = g.contacts.filter((x) => x !== c); save(); render(); }, 'tb'));
    s4.appendChild(r);
  }

  const s5 = card(d, t('Notizen'));
  const ta = el('textarea', 'pInput notes');
  ta.placeholder = t('Parken, Catering, Backline …');
  ta.value = g.notes;
  ta.oninput = () => {
    g.notes = ta.value;
    save();
  };
  s5.appendChild(ta);
}

function renderMoney(d: HTMLElement, g: Gig, refreshItem: () => void) {
  const [left, right] = columns(d);
  const sumBox = el('div', 'moneySum');
  const upd = () => {
    const r = settle(band, g);
    sumBox.innerHTML =
      `<div><span>${esc(t('Gage'))}</span><b>${fmtMoney(g.money.fee)}</b></div>` +
      `<div><span>${esc(t('Kosten'))}</span><b>${fmtMoney(r.costs)}</b></div>` +
      `<div><span>${esc(t('Bleibt'))}</span><b class="${r.net < 0 ? 'neg' : ''}">${fmtMoney(r.net)}</b></div>` +
      (r.payout.length ? `<div><span>${esc(t('Pro Kopf'))}</span><b>${fmtMoney(r.share)}</b></div>` : '') +
      (r.payout.some((p) => Math.abs(p.amount - r.share) > 0.005)
        ? `<div class="payout">${r.payout.map((p) => `<span>${esc(memberName(p.member))}: ${fmtMoney(p.amount)}</span>`).join('')}</div>`
        : '');
  };
  const c1 = card(left, t('Gage'));
  const fee = input(g.money, 'fee', '0', upd, 'pInput num', 'number');
  fee.step = '10';
  if (!g.money.fee) fee.value = '';
  row(c1, t('Gage'), fee, el('span', 'unit', '€'));
  row(c1, t('bezahlt'), toggle(g.money.paid, (v) => { g.money.paid = v; save(); refreshItem(); }));
  const share = ticketTotals(g.tickets).share;
  if (share > 0 && Math.abs(share - g.money.fee) > 0.005) {
    const take = el('button', 'btn small', esc(t('Übernehmen')));
    take.onclick = () => {
      g.money.fee = Math.round(share * 100) / 100;
      save();
      render();
    };
    row(c1, t('Bandanteil VVK'), el('span', 'val', fmtMoney(share)), take);
  }

  const c2 = card(left, t('Kosten'), { addTip: t('Kosten hinzufügen'), add: () => { g.money.costs.push(newCost()); save(); render(); } });
  if (!g.money.costs.length) hint(c2, t('z.B. Sprit, Hotel, Backline-Miete'));
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
    c2.appendChild(r);
  }
  const c3 = card(right, t('Auszahlung'));
  c3.appendChild(sumBox);
  if (!g.lineup.length) hint(c3, t('Ohne Besetzung keine Aufteilung pro Kopf.'));
  upd();
}

// ---------------- wizards ----------------

interface BandDraft { name: string; members: { name: string; role: string }[]; songs: string }

/** first start (or a new band): name, members, songs */
export async function bandWizard(replace = false) {
  if (replace && bandReady() && !(await host.confirm(t('Neue Band einrichten? Die aktuelle Band wird ersetzt – speichere sie vorher als Datei.')))) return;
  let opened = false;
  const r = await wizard<BandDraft>({
    title: t('Band einrichten'),
    state: { name: '', members: [{ name: '', role: '' }], songs: '' },
    finish: t('Band anlegen'),
    extra: (foot, close) => {
      const o = el('button', 'btn plain', esc(t('Band-Datei öffnen …')));
      o.onclick = () => {
        opened = true;
        close();
        void importBand();
      };
      foot.appendChild(o);
    },
    steps: [
      {
        title: t('Wie heißt eure Band?'),
        text: t('Danach legst du Mitglieder und Songs an. Alles lässt sich später ändern.'),
        ok: (s) => !!s.name.trim(),
        body: (box, s, redraw) => wizField(box, t('Name'), wizInput(s.name, t('z.B. Riverside Crow'), (v) => { s.name = v; redraw(); })),
      },
      {
        title: t('Wer spielt mit?'),
        text: t('Das Instrument hilft später bei Kanälen, Kabeln und dem Bühnenplan.'),
        body: (box, s) => {
          const list = el('div', 'wizRows');
          const draw = () => {
            list.innerHTML = '';
            s.members.forEach((m, i) => {
              const r = el('div', 'wizRow');
              r.append(wizInput(m.name, t('Name'), (v) => (m.name = v)), wizInput(m.role, t('z.B. Gitarre, Gesang'), (v) => (m.role = v)));
              r.appendChild(iconBtn('xmark', t('Entfernen'), () => { s.members.splice(i, 1); draw(); }, 'tb'));
              list.appendChild(r);
            });
          };
          draw();
          box.appendChild(list);
          const add = el('button', 'btn plain', `${icon('plus', 12)}<span>${esc(t('Person'))}</span>`);
          add.type = 'button';
          add.onclick = () => {
            s.members.push({ name: '', role: '' });
            draw();
            (list.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.focus();
          };
          box.appendChild(add);
        },
      },
      {
        title: t('Welche Songs spielt ihr?'),
        text: t('Ein Titel pro Zeile. Kann leer bleiben.'),
        optional: true,
        body: (box, s) => {
          const ta = el('textarea', 'pInput notes');
          ta.placeholder = t('Song 1\nSong 2\n…');
          ta.value = s.songs;
          ta.oninput = () => (s.songs = ta.value);
          box.appendChild(ta);
        },
      },
    ],
  });
  if (!r || opened) return;
  const b = newBand(r.name.trim());
  for (const m of r.members.filter((x) => x.name.trim())) {
    const nm = newMember();
    nm.name = m.name.trim();
    nm.role = m.role.trim();
    b.members.push(nm);
  }
  for (const line of r.songs.split('\n').map((x) => x.trim()).filter(Boolean)) b.songs.push({ ...newSong(line), phase: 'live' });
  b.setup = true;
  band = b;
  tab = 'home';
  save();
  host.flash(t('{x} ist angelegt', { x: b.name }));
  openBand('home');
}

async function memberWizard() {
  const r = await wizard({
    title: t('Mitglied'),
    state: { name: '', role: '', phone: '', email: '' },
    finish: t('Hinzufügen'),
    steps: [{
      title: t('Wer kommt dazu?'),
      ok: (s) => !!s.name.trim(),
      body: (box, s, redraw) => {
        wizField(box, t('Name'), wizInput(s.name, t('Name'), (v) => { s.name = v; redraw(); }));
        wizField(box, t('Instrument / Rolle'), wizInput(s.role, t('z.B. Gitarre, Gesang'), (v) => (s.role = v)));
        wizField(box, t('Telefon'), wizInput(s.phone, '+43 …', (v) => (s.phone = v)));
        wizField(box, t('E-Mail'), wizInput(s.email, 'name@…', (v) => (s.email = v), 'email'));
      },
    }],
  });
  if (!r) return;
  const m = { ...newMember(), name: r.name.trim(), role: r.role.trim(), phone: r.phone.trim(), email: r.email.trim() };
  band.members.push(m);
  for (const g of band.gigs) if (g.date >= today() && g.lineup.length) g.lineup.push(m.id);
  selMember = m.id;
  save();
  render();
}

type SongSource = 'new' | 'open' | 'file' | 'none';

async function songWizard() {
  const cur = host.currentSong();
  const r = await wizard<{ src: SongSource; title: string; file: string }>({
    title: t('Song'),
    state: { src: cur ? 'open' : 'new', title: '', file: '' },
    finish: t('Anlegen'),
    steps: [
      {
        title: t('Woher kommen die Noten?'),
        body: (box, s) => choices<SongSource>(box, [
          ...(cur ? [{ k: 'open' as const, icon: 'music' as IconName, label: t('Offenen Song übernehmen'), sub: cur.title }] : []),
          { k: 'new', icon: 'docPlus', label: t('Neu im Editor schreiben'), sub: t('Öffnet einen leeren Song in Tabwriter') },
          { k: 'file', icon: 'folder', label: t('Vorhandene Datei verknüpfen'), sub: 'GP3–GP7, GPX, MusicXML, .tabw' },
          { k: 'none', icon: 'textInfo', label: t('Noch keine Noten'), sub: t('Nur Titel und Steckbrief') },
        ], s.src, (k) => (s.src = k)),
      },
      {
        title: t('Wie heißt der Song?'),
        ok: (s) => !!s.title.trim(),
        body: (box, s, redraw) => {
          if (!s.title && s.src === 'open' && cur) s.title = cur.title;
          wizField(box, t('Titel'), wizInput(s.title, t('Titel'), (v) => { s.title = v; redraw(); }));
        },
      },
    ],
  });
  if (!r) return;
  const title = r.title.trim();
  const s = newSong(title);
  if (r.src === 'open' && cur) {
    s.bpm = cur.bpm;
    s.duration = cur.duration;
    s.key = cur.key;
    s.file = cur.file;
  } else if (r.src === 'file') {
    const f = await host.pickFile();
    if (f) s.file = f.file;
  }
  band.songs.push(s);
  selSong = s.id;
  songFilter = '';
  save();
  if (r.src === 'new') {
    host.newSong(title);
    host.flash(t('Beim ersten Speichern wird die Datei mit „{x}“ verknüpft.', { x: title }));
  } else render();
}

async function setlistWizard() {
  const r = await wizard<{ name: string; songs: string[] }>({
    title: t('Setlist'),
    state: { name: '', songs: [] },
    finish: t('Anlegen'),
    steps: [
      { title: t('Wie heißt die Setlist?'), ok: (s) => !!s.name.trim(), body: (box, s, redraw) => wizField(box, t('Name'), wizInput(s.name, t('z.B. Clubshow 45 min'), (v) => { s.name = v; redraw(); })) },
      {
        title: t('Welche Songs?'),
        text: band.songs.length ? t('In der Reihenfolge anklicken. Reihenfolge und Pausen änderst du später.') : t('Noch keine Songs in der Band – du kannst sie später hinzufügen.'),
        optional: true,
        body: (box, s) => {
          const list = el('div', 'wizPick');
          const draw = () => {
            list.innerHTML = '';
            for (const so of band.songs) {
              const i = s.songs.indexOf(so.id);
              const b = el('button', 'wizPickRow' + (i >= 0 ? ' on' : ''), `<span class="n">${i >= 0 ? i + 1 : ''}</span><span>${esc(so.title || t('Ohne Titel'))}</span><span class="d">${so.duration ? fmtDur(so.duration) : ''}</span>`);
              b.type = 'button';
              b.onclick = () => {
                if (i >= 0) s.songs.splice(i, 1);
                else s.songs.push(so.id);
                draw();
              };
              list.appendChild(b);
            }
          };
          draw();
          box.appendChild(list);
        },
      },
    ],
  });
  if (!r) return;
  const l = newSetlist(r.name.trim());
  l.items = r.songs.map((id) => ({ id: uid('i'), type: 'song', song: id, note: '' } as SetItem));
  band.setlists.push(l);
  selList = l.id;
  save();
  render();
}

async function gigWizard() {
  const r = await wizard<{ date: string; title: string; venue: string; setlist: string; lineup: string[] }>({
    title: t('Gig'),
    state: { date: today(), title: '', venue: '', setlist: band.setlists[0]?.id ?? '', lineup: band.members.map((m) => m.id) },
    finish: t('Anlegen'),
    steps: [
      {
        title: t('Wann und wo?'),
        ok: (s) => !!s.date,
        body: (box, s, redraw) => {
          wizField(box, t('Datum'), wizInput(s.date, '', (v) => { s.date = v; redraw(); }, 'date'));
          wizField(box, t('Venue'), wizInput(s.venue, t('Name des Clubs'), (v) => (s.venue = v)));
          wizField(box, t('Titel'), wizInput(s.title, t('optional, z.B. Release-Show'), (v) => (s.title = v)));
        },
      },
      {
        title: t('Wer spielt, was wird gespielt?'),
        optional: true,
        body: (box, s) => {
          if (band.setlists.length) {
            const sel = select([['', t('Keine')], ...band.setlists.map((l) => [l.id, l.name || t('Ohne Namen')] as [string, string])], s.setlist, (v) => (s.setlist = v));
            wizField(box, t('Setlist'), sel);
          }
          const lineup = el('div', 'lineup');
          for (const m of band.members) {
            const c = el('button', 'chipBtn' + (s.lineup.includes(m.id) ? ' on' : ''), esc(m.name || '?'));
            c.type = 'button';
            c.onclick = () => {
              s.lineup = s.lineup.includes(m.id) ? s.lineup.filter((x) => x !== m.id) : [...s.lineup, m.id];
              c.classList.toggle('on');
            };
            lineup.appendChild(c);
          }
          wizField(box, t('Besetzung'), lineup);
        },
      },
    ],
  });
  if (!r) return;
  const g = newGig(r.date);
  g.schedule.forEach((s) => (s.label = t(s.label)));
  g.title = r.title.trim();
  g.venue = r.venue.trim();
  g.setlist = r.setlist;
  g.lineup = r.lineup;
  band.gigs.push(g);
  selGig = g.id;
  gigSub = 'plan';
  save();
  render();
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
<h1>${esc(gigLabel(g))}</h1>
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
  const audio = await collectAudio(band);
  const bytes = new TextEncoder().encode(JSON.stringify({ ...band, audio }, null, 1));
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
      const raw = JSON.parse(await f.text());
      const b = normalize(raw);
      if (bandReady() && !(await host.confirm(t('Aktuelle Band-Daten durch „{x}“ ersetzen?', { x: b.name })))) return;
      b.setup = true;
      band = b;
      await restoreAudio(raw.audio);
      save();
      host.flash(t('{x} geöffnet', { x: f.name }));
      openBand('home');
    } catch (e: any) {
      host.flash(t('Datei konnte nicht geöffnet werden: {x}', { x: t(e?.message ?? String(e)) }));
    }
  };
  inp.click();
}

