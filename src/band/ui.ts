// Stagecraft band area: one shell (sidebar + pages) for overview, band, songs, stage, setlists, gigs.
// Every page uses the same building blocks from kit.ts.
import { t } from '../i18n';
import { icon, type IconName } from '../icons';
import { dbGet, dbPut, dbDelete } from '../library';
import { saveFile, type FileType } from '../io';
import { openPrintDialog } from '../print';
import { renderStage } from './stage';
import { riderPrintItems } from './rider';
import { crewCard, gigCrewCard, renderDocs, renderCalendar, downloadIcs, awayOn } from './gigextra';
import { rehearsalWizard, nextRehearsal } from './rehearsal';
import { accountButton, acctSub, accessCard, catchInviteHash, hasPendingInvite, handleInvite, type AccountCtx } from './account';
import { initCloud, onAccount, renameCloudBand, currentAccount, type CloudBand } from '../cloud/cloud';
import { BandSync, type SyncStatus } from '../cloud/sync';
import { tourWizard, tourOptions, tourSummary, tourOf, NEW_TOUR } from './tour';
import { renderTickets, printDoorList, importExcel } from './tickets';
import { renderSongIdeas, collectAudio, restoreAudio, syllables, audioKey, audioDuration } from './ideas';
import { INSTRUMENTS, instrumentOf, gearIcon, guessInstruments, type InstrumentPreset } from './catalog';
import { addGear, memberInstruments, gearLabel, modelField, syncRole, INSTRUMENT_KINDS } from './gear';
import type { Clip } from '../editor';
import { el, iconBtn, input, durInput, select, esc, setSaver } from './dom';
import {
  pageHead, detailHead, card, row, hint, emptyState, toggle, columns, tabs, searchField, popMenu,
  wizard, wizInput, wizField, choices, type MenuItem,
} from './kit';
import {
  type Band, type Gig, type Setlist, type SetItem, type Member, type GearItem, type Todo, type TodoStatus,
  type Song, type SetCol, SET_COLS, TUNINGS, LINK_KINDS, newTodo, newSound, todoStatus,
  newBand, normalize, newMember, newSong, newSetlist, newGig, newContact, newCost, uid, settle, fmtMoney,
  setlistDuration, fmtDur, ticketTotals, targetState, parseDur,
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
  recentFiles(): { label: string; file: string; time?: number }[];
  /** choose a file on disk and keep it in the library; returns its file key */
  pickFile(): Promise<{ label: string; file: string } | null>;
  /** open the score in the editor; false if not found */
  openFile(file: string): Promise<boolean>;
  /** show the "restore unsaved changes" box (if any) in the container */
  mountRecovery(box: HTMLElement): void;
  /** the normal "open file" dialog of the editor */
  openDialog(): void;
  /** feedback dialog (GitHub issue) */
  feedback(area: string): void;
  /** read score files (picker when files = null), keep them in the library; title, tempo and length */
  importScores(files: File[] | null, multiple: boolean): Promise<ScoreInfo[]>;
}

export interface ScoreInfo {
  title: string;
  file: string;
  bpm: number;
  duration: number;
  tuning?: string;
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
  saveTimer = window.setTimeout(() => {
    void dbPut(DB_KEY, JSON.stringify(band));
    sync?.soon();
  }, 300);
}

// ---------------- cloud sync ----------------

let sync: BandSync | null = null;
let syncId = '';
let syncState: SyncStatus = 'off';

/** start / stop the sync so it matches the current band and account */
function restartSync(fresh = false) {
  const id = band.cloud && currentAccount() ? band.cloud.id : '';
  if (id === syncId && !fresh) return;
  sync?.stop();
  sync = null;
  syncId = id;
  if (!id) return;
  const s = new BandSync(id, {
    band: () => band,
    changed: () => {
      void dbPut(DB_KEY, JSON.stringify(band));
      if (bandOpen()) render();
    },
    status: (st) => {
      syncState = st;
      const small = root?.querySelector('.sideFoot .acct small');
      if (small) small.textContent = acctSub(actx());
    },
    canWrite: () => band.cloud?.role !== 'guest',
  });
  sync = s;
  void (fresh ? s.reset() : Promise.resolve()).then(() => s.start()).catch(() => {});
}

export const syncLabel = (): string => ({ off: '', syncing: t('gleicht ab …'), ok: t('abgeglichen'), offline: t('offline'), error: t('Abgleich fehlgeschlagen') })[syncState];

/** switch the device to another cloud band (data comes from the cloud) */
async function switchToCloud(cb: CloudBand) {
  if (band.cloud?.id === cb.id) return;
  if (band.setup && !band.cloud) {
    if (!(await host.confirm(t('„{x}“ ist nur auf diesem Gerät gespeichert und wird durch „{y}“ ersetzt. Weiter?', { x: band.name, y: cb.name })))) return;
    if (await host.confirm(t('Vorher „{x}“ als Datei sichern?', { x: band.name }))) await exportBand();
  } else if (sync) {
    await sync.now();
  }
  const nb = newBand(cb.name);
  nb.setup = true;
  nb.cloud = { id: cb.id, role: cb.role };
  band = nb;
  await dbPut(DB_KEY, JSON.stringify(band));
  restartSync(true);
  if (!bandOpen()) openBand('home');
  else render();
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
      migrate(band);
    } catch {
      band = newBand(t('Meine Band'));
    }
  } else band = newBand(t('Meine Band'));
  void startCloud();
}

const actx = (): AccountCtx => ({
  band: () => band,
  replaceBand: (b) => { band = b; save(); restartSync(true); },
  switchTo: (cb) => switchToCloud(cb),
  cloudChanged: () => restartSync(),
  syncNow: () => sync?.now() ?? Promise.resolve(),
  syncLabel: () => syncLabel(),
  rerender: () => { if (bandOpen()) render(); },
  confirm: (m) => host.confirm(m),
  flash: (m) => host.flash(m),
});

/** restore the session, react to sign-in/out, run a pending invite (#invite=… in the address) */
async function startCloud() {
  catchInviteHash();
  try {
    await initCloud();
  } catch {
    /* offline: stay local */
  }
  onAccount(() => {
    restartSync();
    if (bandOpen()) render();
  });
  restartSync();
  if (hasPendingInvite()) {
    await handleInvite(actx());
    if (bandReady() && !bandOpen()) openBand('members');
  }
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
  if (to && to !== tab) mDetail = false;
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
  mDetail = false;
  render();
}

// ---------------- shell ----------------

function render() {
  document.getElementById('kitPop')?.remove();
  // the Tabwriter start block is borrowed from #library: give it back before clearing
  const rec = root.querySelector('#libRecover');
  if (rec) document.querySelector('#library .libWrap')?.insertBefore(rec, document.getElementById('flow'));
  root.innerHTML = '';
  root.appendChild(sidebar());
  const main = el('main', 'bandMain');
  root.appendChild(main);
  main.appendChild(mobileHead());
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

function bandMenu(anchor: HTMLElement) {
  popMenu(anchor, [
    { icon: 'folder', label: t('Band-Datei öffnen …'), fn: () => void importBand() },
    { icon: 'save', label: t('Band-Datei speichern …'), fn: () => void exportBand() },
    'sep',
    { icon: 'plus', label: t('Neue Band einrichten …'), fn: () => void bandWizard(true) },
  ]);
}

/** phone layout: small header (band + Tabwriter); the sidebar becomes a tab bar via CSS */
function mobileHead(): HTMLElement {
  const h = el('div', 'mTop');
  const sw = el('button', 'mBand', `<span class="bandLogo">${band.logo ? `<img src="${band.logo}" alt="">` : esc(initials(band.name))}</span><b>${esc(band.name || t('Band'))}</b>${icon('chevronDown', 12)}`);
  sw.onclick = () => bandMenu(sw);
  h.appendChild(sw);
  h.appendChild(el('span', 'spacer'));
  const ab = accountButton(actx());
  ab.classList.add('mAcct');
  h.appendChild(ab);
  h.appendChild(iconBtn('comment', t('Feedback geben'), () => host.feedback(areaName()), 'tbtn'));
  if (host.hasSong()) {
    const ed = iconBtn('pencil', t('Zurück in den Editor (Esc)'), () => host.editor(), 'tbtn');
    h.appendChild(ed);
  }
  return h;
}

let mDetail = false; // phone: detail instead of list

const areaName = () => (tab === 'home' ? t('Übersicht') : t(STEPS.find((x) => x.tab === tab)?.label ?? tab));

function sidebar(): HTMLElement {
  const side = el('aside', 'bandSide');
  // band switcher: file actions now, several bands once there are accounts
  const sw = el('button', 'bandSw', `<span class="bandLogo">${band.logo ? `<img src="${band.logo}" alt="">` : esc(initials(band.name))}</span><b>${esc(band.name || t('Band'))}</b>${icon('chevronDown', 12)}`);
  sw.dataset.tip = t('Band-Datei, neue Band');
  sw.onclick = () => bandMenu(sw);
  side.appendChild(sw);

  const nav = (cls: string, html: string, fn: () => void, tip = '') => {
    const b = el('button', 'bandNav ' + cls, html);
    if (tip) b.dataset.tip = tip;
    b.onclick = fn;
    side.appendChild(b);
    return b;
  };
  nav('home' + (tab === 'home' ? ' on' : ''), `${icon('house', 16)}<span class="lbl">${esc(t('Übersicht'))}</span><kbd>⇧⌘L</kbd>`, () => go('home'));
  side.appendChild(el('div', 'bandNavSep'));
  const counts: Record<string, number> = { members: band.members.length, songs: band.songs.length, stage: band.gear.items.length, setlists: band.setlists.length, gigs: band.gigs.length };
  STEPS.forEach((st, i) => {
    nav(tab === st.tab ? 'on' : '', `<span class="step">${i + 1}</span>${icon(st.icon, 16)}<span class="lbl">${esc(t(st.label))}</span><span class="cnt">${counts[st.tab] || ''}</span>`, () => go(st.tab), `⌘${i + 1}`);
    if (st.tab === 'songs' && host.hasSong()) {
      nav('sub', `${icon('pencil', 14)}<span>${esc(host.songTitle() || t('Editor'))}</span>`, () => host.editor(), t('Zurück in den Editor (Esc)'));
    }
  });
  side.appendChild(el('span', 'spacer'));
  const foot = el('div', 'sideFoot');
  foot.appendChild(accountButton(actx()));
  foot.appendChild(iconBtn('comment', t('Feedback geben'), () => host.feedback(areaName()), 'tbtn feedbackBtn'));
  side.appendChild(foot);
  return side;
}

/** list | detail */
function split(main: HTMLElement): [HTMLElement, HTMLElement] {
  const s = el('div', 'bandSplit' + (mDetail ? ' showDetail' : ''));
  const l = el('div', 'bandList');
  s.appendChild(l);
  main.appendChild(s);
  return [l, s];
}

function listItem(list: HTMLElement, on: boolean, title: string, sub: string, fn: () => void, cls = '') {
  const r = el('div', 'bandItem' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), `<span class="t">${title}</span><span class="s">${sub}</span>`);
  r.onclick = () => {
    mDetail = true;
    fn();
  };
  list.appendChild(r);
  return r;
}

function detail(): HTMLElement {
  const d = el('div', 'bandDetail');
  const back = el('button', 'mBack', `${icon('chevronLeft', 14)}<span>${esc(t('Zurück'))}</span>`);
  back.onclick = () => {
    mDetail = false;
    render();
  };
  d.appendChild(back);
  return d;
}

function titleInput<T extends object>(obj: T, key: keyof T, ph: string, onChange?: () => void) {
  return input(obj, key, ph, onChange, 'bandTitle');
}

// ---------------- images ----------------

/** pick an image and scale it to a square (cover crop) data URL */
function pickImage(size: number, type: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<string | null> {
  return new Promise((resolve) => {
    const inp = el('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const s = Math.min(img.width, img.height);
        const g = c.getContext('2d')!;
        if (type === 'image/png') {
          // logos: keep the whole image, centered
          const k = size / Math.max(img.width, img.height);
          g.drawImage(img, (size - img.width * k) / 2, (size - img.height * k) / 2, img.width * k, img.height * k);
        } else g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL(type, 0.86));
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(f);
    };
    inp.click();
  });
}

function avatar(m: Member, size = 32): string {
  return m.photo
    ? `<span class="av" style="--s:${size}px"><img src="${m.photo}" alt=""></span>`
    : `<span class="av" style="--s:${size}px">${esc(initials(m.name || '?'))}</span>`;
}

// ---------------- overview ----------------

function relTime(ms?: number): string {
  if (!ms) return '';
  const d = (Date.now() - ms) / 1000;
  if (d < 3600) return t('vor {n} min', { n: Math.max(1, Math.round(d / 60)) });
  if (d < 86400) return t('vor {n} h', { n: Math.round(d / 3600) });
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function renderHome(main: HTMLElement) {
  pageHead(main, { title: t('Übersicht') });
  host.mountRecovery(main);
  const grid = el('div', 'homeGrid');
  main.appendChild(grid);

  // next gig
  const now = today();
  const next = band.gigs.filter((g) => g.date >= now).sort((a, z) => a.date.localeCompare(z.date))[0];
  const reh = nextRehearsal(band, now);
  const c1 = card(grid, reh ? t('Als Nächstes') : t('Nächster Gig'));
  if (reh) {
    const r = el('div', 'linkRow', `<b>${esc(t('Probe'))}</b><span>${esc(fmtDate(reh.date))}${reh.from ? ' · ' + esc(reh.from) : ''}${reh.place ? ' · ' + esc(reh.place) : ''}</span>${reh.songs.length ? `<span>${esc(reh.songs.map((id) => band.songs.find((x) => x.id === id)?.title).filter(Boolean).join(', '))}</span>` : ''}`);
    r.onclick = () => void rehearsalWizard(ctx(), reh);
    c1.appendChild(r);
  }
  if (next) {
    const tk = ticketTotals(next.tickets);
    const r = el('div', 'linkRow', `<b>${esc(next.title || next.venue || t('Gig'))}</b><span>${esc(fmtDate(next.date))}${next.venue ? ' · ' + esc(next.venue) : ''}</span>${tk.sold ? `<span>${esc(t('{n} Karten verkauft', { n: tk.sold }))}</span>` : ''}`);
    r.onclick = () => {
      selGig = next.id;
      go('gigs');
    };
    c1.appendChild(r);
  } else hint(c1, t('Kein Gig geplant.'));

  // open to-dos
  const open = allTodos().filter((x) => todoStatus(x.td) !== 'done' && x.td.text.trim());
  const c2 = card(grid, t('Offene To-dos'));
  if (!open.length) hint(c2, t('Nichts offen.'));
  for (const { td, song } of open.slice(0, 6)) {
    const r = el('div', 'linkRow', `<b>${esc(td.text)}</b><span>${esc(song?.title ?? t('Band'))}${todoStatus(td) === 'doing' ? ' · ' + esc(t('In Arbeit')) : ''}</span>`);
    r.onclick = () => {
      songSub = 'todos';
      go('songs');
    };
    c2.appendChild(r);
  }

  // recently edited scores (Tabwriter)
  const openBtn = iconBtn('folder', t('Datei öffnen …'), () => host.openDialog(), 'tb add');
  const c3 = card(grid, t('Zuletzt bearbeitet'), { extra: [openBtn] });
  const recent = host.recentFiles().slice(0, 6);
  if (!recent.length) hint(c3, t('Noch keine Songs geöffnet.'));
  for (const f of recent) {
    const r = el('div', 'linkRow', `<b>${esc(f.label)}</b><span>${esc(relTime(f.time))}</span>`);
    r.onclick = () => void openSongFile(f.file);
    c3.appendChild(r);
  }
}

// ---------------- band (members) ----------------

function renderMembers(main: HTMLElement) {
  pageHead(main, { title: t('Band'), primary: { label: t('Mitglied'), tip: t('Mitglied hinzufügen'), fn: () => void memberWizard() } });
  const cols = el('div', 'gigCols wideRight');
  const left = el('div');
  const right = el('div');
  cols.append(left, right);
  main.appendChild(cols);

  // band: logo, name, contact
  const extra = band.logo ? [iconBtn('trash', t('Logo entfernen'), () => { band.logo = undefined; save(); render(); }, 'tb')] : [];
  const c = card(left, t('Band'), { extra });
  const logo = el('button', 'logoPick' + (band.logo ? ' has' : ''), band.logo ? `<img src="${band.logo}" alt="">` : `${icon('image', 22)}<span>${esc(t('Logo hinzufügen'))}</span>`);
  logo.dataset.tip = band.logo ? t('Logo ändern') : t('Logo hinzufügen');
  logo.onclick = async () => {
    const u = await pickImage(320, 'image/png');
    if (!u) return;
    band.logo = u;
    save();
    render();
  };
  c.appendChild(logo);
  const nameIn = input(band, 'name', t('Name der Band'), () => {
    const b = root.querySelector('.bandSw b');
    if (b) b.textContent = band.name || t('Band');
  });
  nameIn.addEventListener('change', () => {
    if (band.cloud?.role === 'admin' && band.name.trim()) void renameCloudBand(band.cloud.id, band.name.trim()).catch(() => {});
  });
  row(c, t('Name'), nameIn);
  const k = card(left, t('Kontakt'));
  row(k, t('E-Mail'), input(band.contact, 'email', 'band@…', undefined, 'pInput', 'email'));
  row(k, t('Telefon'), input(band.contact, 'phone', '+43 …'));
  row(k, t('Web'), input(band.contact, 'web', 'https://…'));
  row(k, t('Booking'), input(band.contact, 'booking', t('Name, E-Mail')));
  socialCard(left);

  // members
  const mc = card(right, t('Mitglieder'));
  if (!band.members.length) hint(mc, t('Noch keine Mitglieder.'));
  for (const m of band.members) mc.appendChild(memberRow(m));
  accessCard(right, actx());
  crewCard(right, ctx());
}

const ctx = () => ({ b: band, rerender: render, confirm: (m: string) => host.confirm(m), flash: (m: string) => host.flash(m) });

const LINK_ICON: Record<string, IconName> = { instagram: 'image', facebook: 'people', tiktok: 'play', youtube: 'play', spotify: 'music', apple: 'music', bandcamp: 'album', soundcloud: 'waveform', website: 'house', linktree: 'link', other: 'link' };
const kindOfUrl = (u: string) => (/instagram/.test(u) ? 'instagram' : /facebook|fb\.com/.test(u) ? 'facebook' : /tiktok/.test(u) ? 'tiktok' : /youtu/.test(u) ? 'youtube' : /spotify/.test(u) ? 'spotify' : /music\.apple/.test(u) ? 'apple' : /bandcamp/.test(u) ? 'bandcamp' : /soundcloud/.test(u) ? 'soundcloud' : /linktr\.ee/.test(u) ? 'linktree' : '');

function socialCard(parent: HTMLElement) {
  const used = new Set(band.links.map((l) => l.kind));
  const c = card(parent, t('Social Media & Streaming'), {
    addTip: t('Profil hinzufügen'),
    add: (a) => popMenu(a, LINK_KINDS.map(([k, label]): MenuItem => ({ icon: used.has(k) ? 'checkmark' : LINK_ICON[k], label, fn: () => {
      band.links.push({ id: uid('k'), kind: k, url: '' });
      save();
      render();
      const all = root.querySelectorAll<HTMLInputElement>('.linkRow2 input');
      all[all.length - 1]?.focus();
    } })), 'scroll'),
  });
  if (!band.links.length) hint(c, t('Instagram, Spotify, YouTube, Website … – erscheint im Rider und lässt sich überall verlinken.'));
  for (const l of band.links) {
    const kd = LINK_KINDS.find(([k]) => k === l.kind) ?? LINK_KINDS[LINK_KINDS.length - 1];
    const r = el('div', 'linkRow2');
    r.appendChild(el('span', 'lk', `${icon(LINK_ICON[l.kind] ?? 'link', 14)}<span>${esc(kd[1])}</span>`));
    const u = input(l, 'url', kd[2], () => {
      const k = kindOfUrl(l.url);
      if (k && l.kind === 'other') l.kind = k;
    });
    u.onchange = () => render();
    r.appendChild(u);
    if (l.url) {
      const a = el('a', 'tb', icon('external', 13));
      a.href = /^https?:/.test(l.url) ? l.url : `https://${l.url}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.dataset.tip = t('Öffnen');
      r.appendChild(a);
    } else r.appendChild(el('span'));
    r.appendChild(iconBtn('xmark', t('Entfernen'), () => { band.links = band.links.filter((x) => x !== l); save(); render(); }, 'tb'));
    c.appendChild(r);
  }
}

function memberRow(m: Member): HTMLElement {
  const r = el('div', 'memberRow');
  const ph = el('button', 'avBtn', avatar(m, 44));
  ph.dataset.tip = m.photo ? t('Foto ändern') : t('Foto hinzufügen');
  ph.onclick = async () => {
    if (m.photo) {
      popMenu(ph, [
        { icon: 'image', label: t('Foto ändern …'), fn: async () => { const u = await pickImage(240); if (u) { m.photo = u; save(); render(); } } },
        { icon: 'trash', label: t('Foto entfernen'), danger: true, fn: () => { m.photo = undefined; save(); render(); } },
      ]);
      return;
    }
    const u = await pickImage(240);
    if (!u) return;
    m.photo = u;
    save();
    render();
  };
  r.appendChild(ph);
  const body = el('div', 'memberBody');
  body.appendChild(input(m, 'name', t('Name'), undefined, 'pInput name'));
  const chips = el('div', 'insChips');
  for (const g of memberInstruments(band, m.id)) {
    const ins = instrumentOf(g.preset);
    const chip = el('button', 'insChip', `${icon(gearIcon(g.kind, g.preset), 13)}<span>${esc(ins ? t(ins.label) : gearLabel(g))}</span>${g.name ? `<i>${esc(g.name)}</i>` : ''}`);
    chip.onclick = () => gearPop(chip, g);
    chips.appendChild(chip);
  }
  const add = el('button', 'insChip add', `${icon('plus', 12)}<span>${esc(t('Instrument'))}</span>`);
  add.onclick = () => popMenu(add, INSTRUMENTS.map((ins): MenuItem => ({ icon: ins.icon, label: t(ins.label), fn: () => { addGear(band, m.id, ins.gear, ins.id); render(); } })), 'scroll');
  chips.appendChild(add);
  body.appendChild(chips);
  r.appendChild(body);
  r.appendChild(iconBtn('xmark', t('Mitglied entfernen'), () => void removeMember(m), 'tb'));
  return r;
}

/** small popover for an instrument: model (with suggestions + Thomann), remove */
function gearPop(anchor: HTMLElement, g: GearItem) {
  document.getElementById('kitPop')?.remove();
  const pop = el('div', 'pop gearPop');
  pop.id = 'kitPop';
  pop.appendChild(el('div', 'gearPopHead', `${icon(gearIcon(g.kind, g.preset), 14)}<b>${esc(gearLabel(g))}</b>`));
  pop.appendChild(modelField(g));
  const rm = el('button', 'btn small danger', esc(t('Entfernen')));
  rm.onclick = () => {
    band.gear.items = band.gear.items.filter((x) => x !== g);
    for (const c of band.gear.inputs) if (c.gear === g.id) c.gear = '';
    syncRole(band, g.member);
    save();
    pop.remove();
    render();
  };
  pop.appendChild(rm);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(window.innerWidth - 300, r.left)}px`;
  pop.style.top = `${r.bottom + 4}px`;
  (pop.querySelector('input') as HTMLInputElement).focus();
  setTimeout(() => document.addEventListener('mousedown', function off(e) {
    if (!pop.contains(e.target as Node)) {
      pop.remove();
      document.removeEventListener('mousedown', off);
      render();
    }
  }), 0);
}

async function removeMember(m: Member) {
  if (!(await host.confirm(t('{x} entfernen?', { x: m.name || t('Mitglied') })))) return;
  band.members = band.members.filter((x) => x !== m);
  band.gear.items = band.gear.items.filter((g) => g.member !== m.id);
  for (const g of band.gigs) g.lineup = g.lineup.filter((id) => id !== m.id);
  save();
  render();
}

/** for Tabwriter: people with their instruments (and the matching track preset) */
export function bandPeople() {
  if (!bandReady()) return [];
  return band.members
    .map((m) => ({
      id: m.id,
      name: m.name || '?',
      instruments: memberInstruments(band, m.id)
        .map((g) => ({ id: g.id, label: gearLabel(g), model: g.name, preset: instrumentOf(g.preset) ?? INSTRUMENTS.find((x) => x.gear === g.kind) }))
        .filter((x): x is { id: string; label: string; model: string; preset: InstrumentPreset } => !!x.preset),
    }))
    .filter((p) => p.instruments.length);
}

/** older band files: instruments from the role text or the gear kinds */
function migrate(b: Band) {
  for (const m of b.members) {
    const items = b.gear.items.filter((g) => g.member === m.id);
    for (const g of items) {
      if (g.preset) continue;
      const p = INSTRUMENTS.find((x) => x.gear === g.kind);
      if (p && INSTRUMENT_KINDS.includes(g.kind)) g.preset = p.id;
    }
    if (!items.some((g) => g.preset) && m.role) {
      const cur = band;
      band = b;
      for (const id of guessInstruments(m.role)) {
        const p = instrumentOf(id)!;
        addGear(b, m.id, p.gear, p.id);
      }
      band = cur;
    }
  }
}

// ---------------- songs ----------------

let selSong = '';
let songSub: 'songs' | 'todos' = 'songs';
let songQuery = '';
let songAlbum = ''; // '' = all, '\u0000' = without album

const ideaHost = () => ({
  snippet: () => host.snippet(),
  useClip: (c: Clip) => host.useClip(c),
  flash: (m: string) => host.flash(m),
  confirm: (m: string) => host.confirm(m),
});

function allTodos(): { td: Todo; song: Song | null }[] {
  return [...band.songs.flatMap((s) => s.todos.map((td) => ({ td, song: s as Song | null }))), ...band.todos.map((td) => ({ td, song: null }))];
}

function setStatus(td: Todo, st: TodoStatus) {
  td.status = st;
  td.done = st === 'done';
  save();
}

function renderSongs(main: HTMLElement) {
  const openTodos = allTodos().filter((x) => todoStatus(x.td) !== 'done').length;
  const tb = tabs<'songs' | 'todos'>([['songs', t('Songs'), band.songs.length], ['todos', t('To-dos'), openTodos]], songSub, (k) => {
    songSub = k;
    render();
  });
  if (songSub === 'todos') {
    pageHead(main, { title: t('Songs'), tabs: tb, primary: { label: t('To-do'), tip: t('To-do für die Band'), fn: () => {
      band.todos.unshift(newTodo());
      save();
      render();
      (root.querySelector('.kbCol .kbCard input') as HTMLInputElement | null)?.focus();
    } } });
    renderBoard(main);
    return;
  }
  pageHead(main, { title: t('Songs'), tabs: tb, primary: { label: t('Song'), tip: t('Song anlegen'), fn: () => void songWizard() } });
  if (!band.songs.length) return emptyState(main, t('Noch keine Songs.'));

  const ql = songQuery.trim().toLowerCase();
  const albums = [...new Set(band.songs.map((s) => s.album).filter(Boolean))].sort();
  if (songAlbum && songAlbum !== '\u0000' && !albums.includes(songAlbum)) songAlbum = '';
  const shown = band.songs.filter((s) => (!songAlbum || (songAlbum === '\u0000' ? !s.album : s.album === songAlbum)) && (!ql || [s.title, s.album, s.key, s.notes, s.lyrics].join(' ').toLowerCase().includes(ql)));
  if (!shown.some((s) => s.id === selSong)) selSong = shown[0]?.id ?? '';
  const [list, sp] = split(main);
  list.appendChild(searchField(songQuery, (v) => {
    songQuery = v;
    render();
  }, 'songSearch'));
  if (albums.length) {
    const bar = el('div', 'phaseBar');
    const chip = (v: string, label: string, n: number) => {
      const c = el('button', 'phaseChip' + (songAlbum === v ? ' on' : ''), `${v && v !== '\u0000' ? icon('album', 11) : ''}${esc(label)}<span>${n}</span>`);
      c.onclick = () => {
        songAlbum = v;
        render();
      };
      bar.appendChild(c);
    };
    chip('', t('Alle'), band.songs.length);
    for (const a of albums) chip(a, a, band.songs.filter((x) => x.album === a).length);
    const none = band.songs.filter((x) => !x.album).length;
    if (none) chip('\u0000', t('Ohne Album'), none);
    list.appendChild(bar);
  }
  let lastAlbum: string | null = null;
  const sorted = [...shown].sort((a, z) => (a.album || '￿').localeCompare(z.album || '￿'));
  for (const s of sorted) {
    if (s.album !== lastAlbum && band.songs.some((x) => x.album)) {
      list.appendChild(el('div', 'bandGroup', esc(s.album || t('Ohne Album'))));
      lastAlbum = s.album;
    }
    const open = s.todos.filter((x) => !x.done).length;
    const meta = [s.key, s.bpm ? `${s.bpm} bpm` : '', s.duration ? fmtDur(s.duration) : '', open ? t('{n} offen', { n: open }) : ''].filter(Boolean).join(' · ');
    listItem(list, s.id === selSong,
      `${esc(s.title || t('Ohne Titel'))}${s.file ? `<span class="fileDot" data-tip="${esc(baseName(s.file))}">${icon('doc', 11)}</span>` : ''}`,
      esc(meta || (s.file ? baseName(s.file) : t('Noch keine Noten'))),
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
  const items: MenuItem[] = [{ icon: 'folder', label: t('Datei wählen …'), fn: () => void chooseFile(s) }];
  const recent = host.recentFiles();
  if (recent.length) items.push('sep');
  for (const r of recent.slice(0, 12)) {
    items.push({ icon: r.file === s.file ? 'checkmark' : 'doc', label: r.label, fn: () => { s.file = r.file; if (!s.title) s.title = r.label; save(); render(); } });
  }
  if (s.file) items.push('sep', { icon: 'unlink', label: t('Verknüpfung lösen'), danger: true, fn: () => { s.file = ''; save(); render(); } });
  popMenu(anchor, items, 'scroll');
}

function applyScore(s: Song, f: ScoreInfo) {
  s.file = f.file;
  if (!s.title.trim() || s.title === t('Neuer Song')) s.title = f.title;
  if (f.bpm) s.bpm = f.bpm;
  if (f.duration) s.duration = f.duration;
  if (f.tuning && !s.tuning) s.tuning = f.tuning;
  save();
  render();
  host.flash(t('„{x}“ verknüpft', { x: baseName(f.file) }));
}

async function chooseFile(s: Song) {
  const [f] = await host.importScores(null, false);
  if (f) applyScore(s, f);
}

/** drop target for score files; stops the editor's own drop handler */
function dropTarget(box: HTMLElement, onFiles: (files: File[]) => void) {
  box.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    box.classList.add('over');
  });
  box.addEventListener('dragleave', () => box.classList.remove('over'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    box.classList.remove('over');
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) onFiles(files);
  });
}

function fileCard(parent: HTMLElement, s: Song) {
  const extra = s.file ? [iconBtn('link', t('Andere Datei verknüpfen'), () => linkMenu(lk, s), 'tb')] : [];
  const lk = extra[0];
  const c = card(parent, t('Noten'), { extra });
  if (s.file) {
    const ext = (s.file.match(/\.([^.]+)$/)?.[1] ?? '').toUpperCase();
    const box = el('div', 'fileBox', `<span class="fileIc">${esc(ext || 'GP')}</span><span class="fileTx"><b>${esc(baseName(s.file).replace(/\.[^.]+$/, ''))}</b><small>${esc(baseName(s.file))}</small></span>`);
    const open = el('button', 'btn primary', `${icon('pencil', 12)}<span>${esc(t('Im Editor öffnen'))}</span>`);
    open.onclick = () => void openSongFile(s.file);
    box.appendChild(open);
    c.appendChild(box);
    dropTarget(box, async (files) => {
      const [f] = await host.importScores(files.slice(0, 1), false);
      if (f) applyScore(s, f);
    });
    return;
  }
  const z = el('div', 'dropZone', `${icon('upload', 22)}<b>${esc(t('Noten-Datei hierher ziehen'))}</b><small>GP3–GP7, GPX, MusicXML, .tabw</small>`);
  const btns = el('div', 'dzBtns');
  const pick = el('button', 'btn', `${icon('folder', 12)}<span>${esc(t('Datei wählen …'))}</span>`);
  pick.onclick = () => void chooseFile(s);
  const nw = el('button', 'btn', `${icon('docPlus', 12)}<span>${esc(t('Neu im Editor schreiben'))}</span>`);
  nw.onclick = () => {
    host.newSong(s.title);
    host.flash(t('Beim ersten Speichern wird die Datei mit „{x}“ verknüpft.', { x: s.title }));
  };
  btns.append(pick, nw);
  z.appendChild(btns);
  const recent = host.recentFiles().slice(0, 4);
  if (recent.length) {
    const rc = el('div', 'dzRecent', `<span>${esc(t('Zuletzt:'))}</span>`);
    for (const r of recent) {
      const b = el('button', 'chipBtn', esc(r.label));
      b.onclick = () => { s.file = r.file; save(); render(); };
      rc.appendChild(b);
    }
    z.appendChild(rc);
  }
  dropTarget(z, async (files) => {
    const [f] = await host.importScores(files.slice(0, 1), false);
    if (f) applyScore(s, f);
  });
  c.appendChild(z);
}

const SERVICES: [RegExp, string, IconName][] = [
  [/spotify\.com/, 'Spotify', 'music'],
  [/youtu\.?be/, 'YouTube', 'play'],
  [/music\.apple\.com/, 'Apple Music', 'music'],
  [/bandcamp\.com/, 'Bandcamp', 'album'],
  [/soundcloud\.com/, 'SoundCloud', 'waveform'],
  [/dropbox\.com|drive\.google\.com|icloud\.com|onedrive/, 'Cloud', 'folder'],
];
const serviceOf = (url: string): [string, IconName] => {
  const s = SERVICES.find(([re]) => re.test(url));
  return s ? [s[1], s[2]] : [t('Link'), 'link'];
};
/** https://open.spotify.com/track/ID -> embed url */
const spotifyEmbed = (url: string) => {
  const m = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
  return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : '';
};

function mediaCard(parent: HTMLElement, s: Song) {
  const c = card(parent, t('Aufnahmen & Links'), {
    addTip: t('Aufnahme oder Link hinzufügen'),
    add: (a) => popMenu(a, [
      { icon: 'link', label: t('Link (Spotify, YouTube, Bandcamp …)'), fn: () => {
        s.media.push({ id: uid('r'), kind: 'link', label: '', url: '' });
        save();
        render();
        const all = root.querySelectorAll<HTMLInputElement>('.mediaRow input.url');
        all[all.length - 1]?.focus();
      } },
      { icon: 'waveform', label: t('Audio-Datei hinzufügen …'), fn: () => pickAudio(s) },
    ]),
  });
  if (!s.media.length) hint(c, t('Fertige Aufnahmen, Demos oder Links zu Spotify, YouTube, Bandcamp. Audio-Dateien kannst du auch hierher ziehen.'));
  for (const m of s.media) {
    const r = el('div', 'mediaRow');
    if (m.kind === 'link') {
      const [svc, ic] = serviceOf(m.url);
      const top = el('div', 'mediaTop');
      top.appendChild(el('span', 'mIc', icon(ic, 14)));
      const url = input(m, 'url', t('https://open.spotify.com/track/…'), undefined, 'pInput url');
      url.onchange = () => render();
      top.appendChild(url);
      top.appendChild(el('span', 'svc', esc(m.url ? svc : '')));
      if (m.url) {
        const open = el('a', 'tb', icon('external', 13));
        open.href = m.url;
        open.target = '_blank';
        open.rel = 'noopener';
        open.dataset.tip = t('Öffnen');
        top.appendChild(open);
      }
      top.appendChild(iconBtn('xmark', t('Entfernen'), () => { s.media = s.media.filter((x) => x !== m); save(); render(); }, 'tb'));
      r.appendChild(top);
      const emb = spotifyEmbed(m.url);
      if (emb) {
        // privacy: Spotify only gets contacted after a click
        const load = el('button', 'btn small spotifyLoad', `${icon('play', 12)}<span>${esc(t('Spotify-Player laden'))}</span>`);
        load.dataset.tip = t('Lädt den Player von Spotify (dabei werden Daten an Spotify übertragen)');
        load.onclick = () => {
          const f = el('iframe', 'spotify');
          f.src = emb;
          f.allow = 'encrypted-media';
          load.replaceWith(f);
        };
        r.appendChild(load);
      }
    } else {
      const top = el('div', 'mediaTop');
      top.appendChild(el('span', 'mIc', icon('waveform', 14)));
      top.appendChild(input(m, 'label', t('z.B. Master 2026, Demo'), undefined, 'pInput url'));
      top.appendChild(el('span', 'svc', esc(m.audio?.duration ? fmtDur(m.audio.duration) : '')));
      top.appendChild(iconBtn('xmark', t('Entfernen'), async () => {
        if (!(await host.confirm(t('{x} löschen?', { x: m.label || m.audio?.name || t('Aufnahme') })))) return;
        await dbDelete(audioKey(m.id));
        s.media = s.media.filter((x) => x !== m);
        save();
        render();
      }, 'tb'));
      r.appendChild(top);
      const au = el('audio');
      au.controls = true;
      au.preload = 'metadata';
      r.appendChild(au);
      void dbGet<Blob>(audioKey(m.id)).then((blob) => {
        if (blob) au.src = URL.createObjectURL(blob);
        else r.appendChild(el('span', 'hint', esc(t('Audio nicht gefunden (nur auf dem Gerät gespeichert, wo es hinzugefügt wurde)'))));
      });
    }
    c.appendChild(r);
  }
  dropTarget(c, (files) => void addAudio(s, files.filter((f) => f.type.startsWith('audio') || /\.(mp3|wav|m4a|aiff?|flac|ogg|caf)$/i.test(f.name))));
}

function pickAudio(s: Song) {
  const inp = el('input');
  inp.type = 'file';
  inp.accept = 'audio/*,.m4a,.mp3,.wav,.aiff,.flac,.caf';
  inp.multiple = true;
  inp.onchange = () => void addAudio(s, Array.from(inp.files ?? []));
  inp.click();
}

async function addAudio(s: Song, files: File[]) {
  for (const f of files) {
    const m = { id: uid('r'), kind: 'audio' as const, label: f.name.replace(/\.[^.]+$/, ''), url: '', audio: { name: f.name, type: f.type, duration: await audioDuration(f) } };
    await dbPut(audioKey(m.id), f);
    s.media.push(m);
    if (!s.duration && m.audio.duration) s.duration = m.audio.duration;
  }
  if (files.length) {
    save();
    render();
  }
}

function lyricsCard(parent: HTMLElement, s: Song) {
  const c = card(parent, t('Lyrics'), { cls: 'lyricsCard' });
  const wrap = el('div', 'lyrics');
  const ta = el('textarea', 'pInput');
  ta.placeholder = t('Strophe 1 …\n\nRefrain …');
  ta.value = s.lyrics;
  ta.spellcheck = true;
  const gut = el('div', 'syl');
  gut.dataset.tip = t('Silben pro Zeile (ungefähr)');
  const upd = () => {
    gut.innerHTML = ta.value.split('\n').map((l) => `<span>${l.trim() ? syllables(l) : ''}</span>`).join('');
    gut.scrollTop = ta.scrollTop;
  };
  ta.oninput = () => {
    s.lyrics = ta.value;
    save();
    upd();
  };
  ta.onscroll = () => (gut.scrollTop = ta.scrollTop);
  wrap.append(ta, gut);
  c.appendChild(wrap);
  upd();
}

function songDetail(s: Song): HTMLElement {
  const d = detail();
  const refreshItem = () => {
    const it = root.querySelector('.bandItem.on .t');
    if (it) it.firstChild!.textContent = s.title || t('Ohne Titel');
  };
  const cur = host.currentSong();
  detailHead(d, {
    title: titleInput(s, 'title', t('Titel'), refreshItem),
    meta: [s.key, s.bpm ? `${s.bpm} bpm` : '', s.duration ? fmtDur(s.duration) : ''].filter(Boolean).join(' · '),
    menu: () => [
      ...(cur && cur.file && cur.file === s.file ? [{ icon: 'restore' as IconName, label: t('Tempo & Länge aus dem Editor übernehmen'), fn: () => { s.bpm = cur.bpm; s.duration = cur.duration; save(); render(); } }, 'sep' as const] : []),
      { icon: 'trash', label: t('Song entfernen'), danger: true, fn: () => void removeSong(s) },
    ],
  });

  const [left, right] = columns(d);
  fileCard(left, s);
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
  const tu = input(s, 'tuning', 'E Standard');
  tu.setAttribute('list', 'songTunings');
  row(s1, t('Stimmung'), tu);
  const tl = el('datalist');
  tl.id = 'songTunings';
  for (const x of TUNINGS) tl.appendChild(Object.assign(el('option'), { value: x }));
  s1.appendChild(tl);
  const s2 = card(left, t('Notizen'));
  const ta = el('textarea', 'pInput notes');
  ta.placeholder = t('z.B. Capo 2, Fade-Out, Idee für die Bridge …');
  ta.value = s.notes;
  ta.oninput = () => {
    s.notes = ta.value;
    save();
  };
  s2.appendChild(ta);

  lyricsCard(right, s);

  const s3 = card(right, t('To-dos'), {
    extra: [iconBtn('kanban', t('Alle To-dos als Board'), () => { songSub = 'todos'; render(); }, 'tb')],
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
    const st = todoStatus(td);
    const r = el('div', 'todoRow' + (td.done ? ' done' : ''));
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = td.done;
    cb.onchange = () => {
      setStatus(td, cb.checked ? 'done' : 'open');
      r.classList.toggle('done', td.done);
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
    r.append(cb, tx);
    r.appendChild(el('span', 'tdState', st === 'doing' ? esc(t('In Arbeit')) : ''));
    r.appendChild(iconBtn('xmark', t('Entfernen'), () => { s.todos = s.todos.filter((x) => x !== td); save(); render(); }, 'tb'));
    s3.appendChild(r);
  }

  mediaCard(right, s);
  renderSongIdeas(right, band, s.id, ideaHost(), render);

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
  for (const it of band.ideas) if (it.song === s.id) it.song = '';
  save();
  render();
}

// ---------------- to-do board ----------------

const COLS: [TodoStatus, string][] = [['open', 'Offen'], ['doing', 'In Arbeit'], ['done', 'Erledigt']];

function renderBoard(main: HTMLElement) {
  const board = el('div', 'kanban');
  main.appendChild(board);
  const items = allTodos();
  COLS.forEach(([st, label], ci) => {
    const col = el('section', 'kbCol');
    col.dataset.status = st;
    const inCol = items.filter((x) => todoStatus(x.td) === st);
    col.appendChild(el('div', 'kbHead', `<h3>${esc(t(label))}</h3><span>${inCol.length}</span>`));
    const list = el('div', 'kbList');
    for (const { td, song } of inCol) {
      const c = el('div', 'kbCard');
      c.draggable = true;
      c.dataset.id = td.id;
      c.ondragstart = (e) => {
        e.dataTransfer?.setData('text/plain', td.id);
        c.classList.add('dragging');
      };
      c.ondragend = () => c.classList.remove('dragging');
      c.appendChild(input(td, 'text', t('Was ist zu tun?')));
      const foot = el('div', 'kbFoot');
      const tag = el('button', 'kbSong', esc(song ? song.title || t('Ohne Titel') : t('Band')));
      if (song) {
        tag.dataset.tip = t('Song öffnen');
        tag.onclick = () => {
          selSong = song.id;
          songSub = 'songs';
          render();
        };
      } else tag.disabled = true;
      foot.appendChild(tag);
      foot.appendChild(el('span', 'spacer'));
      if (ci > 0) foot.appendChild(iconBtn('arrowLeft', t('Nach „{x}“', { x: t(COLS[ci - 1][1]) }), () => { setStatus(td, COLS[ci - 1][0]); render(); }, 'tb'));
      if (ci < COLS.length - 1) foot.appendChild(iconBtn('arrowRight', t('Nach „{x}“', { x: t(COLS[ci + 1][1]) }), () => { setStatus(td, COLS[ci + 1][0]); render(); }, 'tb'));
      foot.appendChild(iconBtn('xmark', t('Entfernen'), () => {
        if (song) song.todos = song.todos.filter((x) => x !== td);
        else band.todos = band.todos.filter((x) => x !== td);
        save();
        render();
      }, 'tb'));
      c.appendChild(foot);
      list.appendChild(c);
    }
    if (!inCol.length) list.appendChild(el('div', 'kbEmpty', esc(st === 'open' ? t('Neue To-dos mit „+ To-do“ oder im Song.') : t('Karten hierher ziehen'))));
    col.appendChild(list);
    col.ondragover = (e) => {
      e.preventDefault();
      col.classList.add('over');
    };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const id = e.dataTransfer?.getData('text/plain');
      const it = items.find((x) => x.td.id === id);
      if (it) {
        setStatus(it.td, st);
        render();
      }
    };
    board.appendChild(col);
  });
}

// ---------------- setlists ----------------

/** "⚠ 25 % zu lang" badge when a setlist is more than 20 % off its planned time */
function targetWarn(l: Setlist, long = false): string {
  const { state, pct } = targetState(band, l);
  if (!state) return '';
  const msg = state === 'long' ? t('{n} % zu lang', { n: pct }) : t('{n} % zu kurz', { n: -pct });
  const tip = t('Vorgabe {x}, geplant {y}', { x: fmtDur(l.target!), y: fmtDur(setlistDuration(band, l)) });
  return `<span class="setWarn ${state}" data-tip="${esc(tip)}">${icon('warning', 12)}${long ? `<span>${esc(msg)}</span>` : ''}</span>`;
}

function renderSetlists(main: HTMLElement) {
  pageHead(main, { title: t('Setlists'), primary: { label: t('Setlist'), tip: t('Setlist anlegen'), fn: () => void setlistWizard() } });
  if (!band.setlists.length) return emptyState(main, t('Noch keine Setlists.'));
  if (!band.setlists.some((l) => l.id === selList)) selList = band.setlists[0].id;
  const [list, sp] = split(main);
  for (const l of band.setlists) {
    listItem(list, l.id === selList, esc(l.name || t('Ohne Namen')) + targetWarn(l), esc(t('{n} Einträge · {d}', { n: l.items.length, d: fmtDur(setlistDuration(band, l)) }) + (l.target ? ' / ' + fmtDur(l.target) : '')), () => {
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
      if (it) it.innerHTML = esc(l.name || t('Ohne Namen')) + targetWarn(l);
    }),
    meta: fmtDur(setlistDuration(band, l)) + (l.target ? ' / ' + fmtDur(l.target) : ''),
    menu: () => [
      { icon: 'printer', label: t('Für die Bühne drucken / PDF'), hint: t('groß'), fn: () => printSetlist(l, true) },
      { icon: 'list', label: t('Mit Details drucken / PDF'), fn: () => printSetlist(l, false) },
      'sep',
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

  const wrap = el('div', 'gigCols wideLeft');
  const left = el('div');
  const right = el('div');
  wrap.append(left, right);
  d.appendChild(wrap);

  const cols = l.cols ?? ['bpm', 'key', 'tuning', 'dur', 'note'];
  const colBtn = iconBtn('list', t('Spalten'), () => popMenu(colBtn, SET_COLS.map(([k, lb]): MenuItem => ({ icon: cols.includes(k) ? 'checkmark' : 'minus', label: t(lb), fn: () => {
    l.cols = cols.includes(k) ? cols.filter((x) => x !== k) : SET_COLS.map(([x]) => x).filter((x) => x === k || cols.includes(x));
    save();
    render();
  } }))), 'tb');
  const c = card(left, t('Ablauf'), {
    extra: [colBtn],
    addTip: t('Pause, Trennlinie oder Freitext'),
    add: (a) => popMenu(a, [
      { icon: 'pause', label: t('Pause / Ansage'), fn: () => { l.items.push({ id: uid('i'), type: 'break', label: t('Pause'), duration: 0 }); save(); render(); } },
      { icon: 'minus', label: t('Trennlinie'), fn: () => { l.items.push({ id: uid('i'), type: 'line', label: '' }); save(); render(); } },
      { icon: 'textInfo', label: t('Freitext'), fn: () => { l.items.push({ id: uid('i'), type: 'text', text: '' }); save(); render(); const all = root.querySelectorAll<HTMLInputElement>('.setRow.txt input'); all[all.length - 1]?.focus(); } },
    ]),
  });
  const W: Record<SetCol, string> = { bpm: '50px', key: '44px', tuning: '100px', dur: '48px', note: 'minmax(70px, 1fr)' };
  const grid = `16px 20px minmax(90px, 1.5fr) ${cols.map((k) => W[k]).join(' ')} 22px`;
  const items = el('div', 'setItems');
  items.style.setProperty('--cols', grid);
  if (l.items.some((x) => x.type === 'song')) {
    const hd = el('div', 'setHead', `<span></span><span></span><span>${esc(t('Song'))}</span>${cols.map((k) => `<span>${esc(t(SET_COLS.find(([x]) => x === k)![1]))}</span>`).join('')}<span></span>`);
    items.appendChild(hd);
  }
  let n = 0;
  const upd = () => {
    const m = root.querySelector('.dHead .dMeta');
    if (m) m.textContent = fmtDur(setlistDuration(band, l)) + (l.target ? ' / ' + fmtDur(l.target) : '');
    const tt = root.querySelector('.setTotal b');
    if (tt) tt.textContent = fmtDur(setlistDuration(band, l));
    const w = root.querySelector('.setTotal .warnSlot');
    if (w) w.innerHTML = targetWarn(l, true);
    const it = root.querySelector('.bandItem.on');
    if (it) {
      it.querySelector('.t')!.innerHTML = esc(l.name || t('Ohne Namen')) + targetWarn(l);
      it.querySelector('.s')!.textContent = t('{n} Einträge · {d}', { n: l.items.length, d: fmtDur(setlistDuration(band, l)) }) + (l.target ? ' / ' + fmtDur(l.target) : '');
    }
  };
  l.items.forEach((it, i) => {
    const r = el('div', 'setRow ' + it.type);
    r.dataset.i = String(i);
    const grip = el('span', 'grip', icon('grip', 14));
    grip.dataset.tip = t('Ziehen zum Verschieben');
    r.appendChild(grip);
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
      for (const k of cols) {
        if (!s) { r.appendChild(el('span')); continue; }
        if (k === 'bpm') {
          const b2 = input(s, 'bpm', '–', undefined, 'pInput num', 'number');
          if (!s.bpm) b2.value = '';
          r.appendChild(b2);
        } else if (k === 'key') r.appendChild(input(s, 'key', '–', undefined, 'pInput key'));
        else if (k === 'tuning') {
          const tu = input(s, 'tuning', '–', undefined, 'pInput tun');
          tu.setAttribute('list', 'tunings');
          r.appendChild(tu);
        } else if (k === 'dur') r.appendChild(durInput(s, upd));
        else r.appendChild(input(it, 'note', t('Notiz, z.B. Fade-Out'), undefined, 'pInput note'));
      }
    } else if (it.type === 'break') {
      r.appendChild(el('span', 'num', icon('pause', 12)));
      r.appendChild(input(it, 'label', t('Pause / Ansage'), undefined, 'pInput name'));
      for (const k of cols) r.appendChild(k === 'dur' ? durInput(it, upd) : el('span'));
    } else if (it.type === 'line') {
      const ln = el('span', 'lineBox');
      ln.appendChild(input(it, 'label', t('optional, z.B. Zugabe'), undefined, 'pInput lineLabel'));
      r.appendChild(ln);
    } else {
      r.appendChild(el('span', 'num', icon('textInfo', 12)));
      r.appendChild(input(it, 'text', t('Freitext, z.B. Gitarre umstimmen, Ansage Merch …'), undefined, 'pInput txt'));
    }
    r.appendChild(iconBtn('xmark', t('Entfernen'), () => { l.items.splice(i, 1); save(); render(); }, 'tb'));
    items.appendChild(r);
  });
  c.appendChild(items);
  const tl = el('datalist');
  tl.id = 'tunings';
  for (const x of TUNINGS) tl.appendChild(Object.assign(el('option'), { value: x }));
  c.appendChild(tl);
  if (!l.items.length) items.appendChild(el('div', 'setEmpty', esc(band.songs.length ? t('Songs von rechts hierher ziehen oder anklicken.') : t('Noch keine Songs in der Band. Lege sie unter „Songs“ an.'))));
  const tot = el('div', 'setTotal', `<span>${esc(t('{n} Songs', { n }))}</span><span class="spacer"></span><span class="warnSlot">${targetWarn(l, true)}</span>`);
  const tg = el('input', 'pInput target');
  tg.placeholder = '45:00';
  tg.value = l.target ? fmtDur(l.target) : '';
  tg.dataset.tip = t('Geplante Spielzeit, z.B. 45:00 – bei mehr als 20 % Abweichung gibt es eine Warnung');
  tg.onchange = () => {
    const v = parseDur(/^\d+$/.test(tg.value.trim()) ? tg.value.trim() + ':00' : tg.value);
    if (v === null) { tg.value = l.target ? fmtDur(l.target) : ''; return; }
    l.target = v || undefined;
    tg.value = v ? fmtDur(v) : '';
    save();
    upd();
  };
  const tl2 = el('label', 'targetBox', `<span>${esc(t('Vorgabe'))}</span>`);
  tl2.appendChild(tg);
  tot.appendChild(tl2);
  tot.appendChild(el('b', '', fmtDur(setlistDuration(band, l))));
  c.appendChild(tot);

  // song shelf: drag into the running order (or click = append)
  const used = new Set(l.items.map((it) => (it.type === 'song' ? it.song : '')));
  const albums = [...new Set(band.songs.map((s) => s.album).filter(Boolean))].sort();
  const albumSel = albums.length ? select([['', t('Alle Alben')], ...albums.map((a) => [a, a] as [string, string]), ['\u0000', t('Ohne Album')]], shelfAlbum, (v) => { shelfAlbum = v; render(); }) : undefined;
  const shelf = card(right, t('Songs'), { cls: 'shelf', extra: albumSel ? [albumSel] : [] });
  const ql = shelfQuery.trim().toLowerCase();
  shelf.appendChild(searchField(shelfQuery, (v) => { shelfQuery = v; render(); }, 'shelfSearch'));
  const shelfList = el('div', 'shelfList');
  for (const s of band.songs.filter((x) => (!shelfAlbum || (shelfAlbum === '\u0000' ? !x.album : x.album === shelfAlbum)) && (!ql || x.title.toLowerCase().includes(ql)))) {
    const r = el('div', 'shelfRow' + (used.has(s.id) ? ' used' : ''), `<span class="grip">${icon('grip', 13)}</span><span class="t">${esc(s.title || t('Ohne Titel'))}</span><span class="d">${s.duration ? fmtDur(s.duration) : ''}</span>${used.has(s.id) ? `<span class="ok">${icon('checkmark', 12)}</span>` : ''}`);
    r.dataset.song = s.id;
    r.onclick = (ev) => { if ((ev as PointerEvent).pointerType === 'touch' || matchMedia('(pointer: coarse)').matches) insert(l.items.length, { id: uid('i'), type: 'song', song: s.id, note: '' } as SetItem); };
    r.dataset.tip = used.has(s.id) ? t('Schon in der Setlist – nochmal hinzufügen?') : t('Ziehen oder klicken zum Hinzufügen');
    shelfList.appendChild(r);
  }
  if (!shelfList.childElementCount) shelfList.appendChild(el('div', 'hint pad', esc(t('Nichts gefunden.'))));
  shelf.appendChild(shelfList);

  const insert = (at: number, item: SetItem) => {
    l.items.splice(at, 0, item);
    save();
    render();
  };
  setlistDrag(items, shelfList, (from, to) => {
    const [it] = l.items.splice(from, 1);
    l.items.splice(to > from ? to - 1 : to, 0, it);
    save();
    render();
  }, (song, at) => insert(at ?? l.items.length, { id: uid('i'), type: 'song', song, note: '' } as SetItem));
  return d;
}

let shelfAlbum = '';
let shelfQuery = '';

/**
 * Drag & drop for the setlist: rows are reordered, songs from the shelf are inserted.
 * Click on a shelf song (no movement) appends it.
 */
function setlistDrag(box: HTMLElement, shelf: HTMLElement, move: (from: number, gap: number) => void, add: (song: string, gap?: number) => void) {
  const start = (e: PointerEvent, label: string, done: (gap: number | null) => void, click?: () => void) => {
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let ghost: HTMLElement | null = null;
    let gap: number | null = null;
    const rows = () => Array.from(box.querySelectorAll<HTMLElement>('.setRow'));
    const clear = () => {
      rows().forEach((r) => r.classList.remove('dropT', 'dropB'));
      box.classList.remove('dropIn');
    };
    const mv = (m: PointerEvent) => {
      if (!ghost) {
        if (Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) < 4) return;
        ghost = el('div', 'dragGhost', esc(label));
        document.body.appendChild(ghost);
        document.body.classList.add('arDragging');
      }
      ghost.style.left = `${m.clientX + 12}px`;
      ghost.style.top = `${m.clientY - 10}px`;
      clear();
      const bx = box.getBoundingClientRect();
      const inside = m.clientX >= bx.left - 40 && m.clientX <= bx.right + 40 && m.clientY >= bx.top - 30 && m.clientY <= bx.bottom + 40;
      if (!inside) {
        gap = null;
        return;
      }
      const rs = rows();
      gap = rs.filter((r) => m.clientY > r.getBoundingClientRect().top + r.offsetHeight / 2).length;
      if (!rs.length) box.classList.add('dropIn');
      else if (gap < rs.length) rs[gap].classList.add('dropT');
      else rs[rs.length - 1].classList.add('dropB');
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('arDragging');
      clear();
      if (!ghost) return click?.();
      ghost.remove();
      done(gap);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  box.addEventListener('pointerdown', (e) => {
    const t0 = e.target as HTMLElement;
    if (t0.closest('input, button, select, textarea, .link')) return;
    const r = t0.closest('.setRow') as HTMLElement | null;
    if (!r) return;
    if (e.pointerType === 'touch' && !t0.closest('.grip')) return; // touch: drag only by the handle, the rest scrolls
    const from = Number(r.dataset.i);
    r.classList.add('dragging');
    start(e, r.querySelector('.name')?.textContent || (r.querySelector('input') as HTMLInputElement | null)?.value || '', (gap) => {
      r.classList.remove('dragging');
      if (gap !== null && gap !== from && gap !== from + 1) move(from, gap);
    });
    window.addEventListener('pointerup', () => r.classList.remove('dragging'), { once: true });
  });
  shelf.addEventListener('pointerdown', (e) => {
    const r = (e.target as HTMLElement).closest('.shelfRow') as HTMLElement | null;
    if (!r) return;
    const song = r.dataset.song!;
    if (e.pointerType === 'touch' && !(e.target as HTMLElement).closest('.grip')) return; // touch: tap adds (click handler)
    start(e, r.querySelector('.t')?.textContent ?? '', (gap) => { if (gap !== null) add(song, gap); }, () => add(song));
  });
}

function printSetlist(l: Setlist, big: boolean) {
  let n = 0;
  const cols = (l.cols ?? ['bpm', 'key', 'tuning', 'dur', 'note']).filter((k) => !big || k !== 'note');
  const nc = cols.length + 2;
  const val = (k: SetCol, s: Song | undefined, note: string) => k === 'bpm' ? (s?.bpm ? String(s.bpm) : '') : k === 'key' ? s?.key ?? '' : k === 'tuning' ? s?.tuning ?? '' : k === 'dur' ? (s?.duration ? fmtDur(s.duration) : '') : note;
  const thead = big ? '' : `<tr class="hd"><td></td><td>${esc(t('Song'))}</td>${cols.map((k) => `<td>${esc(t(SET_COLS.find(([x]) => x === k)![1]))}</td>`).join('')}</tr>`;
  const rows = thead + l.items.map((it) => {
    if (it.type === 'break') return `<tr class="brk"><td></td><td>${esc(it.label || t('Pause'))}</td>${cols.map((k) => `<td class="r">${k === 'dur' && it.duration ? fmtDur(it.duration) : ''}</td>`).join('')}</tr>`;
    if (it.type === 'line') return `<tr class="line"><td colspan="${nc}"><span>${esc(it.label)}</span></td></tr>`;
    if (it.type === 'text') return `<tr class="txt"><td></td><td colspan="${nc - 1}">${esc(it.text)}</td></tr>`;
    const s = band.songs.find((x) => x.id === it.song);
    n++;
    return big
      ? `<tr><td class="n">${n}</td><td><b>${esc(s?.title ?? '')}</b>${it.note ? `<i>${esc(it.note)}</i>` : ''}</td>${cols.map((k) => `<td class="r">${esc(val(k, s, ''))}</td>`).join('')}</tr>`
      : `<tr><td class="n">${n}</td><td><b>${esc(s?.title ?? '')}</b></td>${cols.map((k) => `<td${k === 'dur' ? ' class="r"' : ''}>${esc(val(k, s, it.note))}</td>`).join('')}</tr>`;
  }).join('');
  const css = big
    ? `#printArea.setPrint{font:600 30px -apple-system,Helvetica,Arial,sans-serif;color:#000;padding:4px}
.setPrint h1{font-size:22px;margin:0 0 14px;display:flex;align-items:center;gap:12px}.setPrint h1 img{height:36px}
.setPrint table{border-collapse:collapse;width:100%}.setPrint td{padding:7px 8px;vertical-align:baseline}
.setPrint tr+tr td{border-top:1px solid #ccc}.setPrint .n{width:52px;color:#888;font-weight:500}
.setPrint i{display:block;font:italic 400 17px -apple-system,Helvetica,Arial,sans-serif;color:#444}
.setPrint .r{text-align:right;color:#666;font-size:22px;font-weight:500}.setPrint .brk td{font:italic 400 20px -apple-system,Helvetica,Arial,sans-serif;color:#666}
.setPrint tr{break-inside:avoid}.setPrint .line td{border-top:3px solid #000!important;padding:2px 8px;font:italic 500 16px -apple-system,Helvetica,Arial,sans-serif;color:#444}
.setPrint .txt td{font:italic 400 18px -apple-system,Helvetica,Arial,sans-serif;color:#333}`
    : `#printArea.setPrint{font:13px -apple-system,Helvetica,Arial,sans-serif;color:#111;padding:8px}
.setPrint h1{font-size:22px;margin:0 0 4px;display:flex;align-items:center;gap:10px}.setPrint h1 img{height:30px}.setPrint .sub{color:#555;margin-bottom:16px}
.setPrint table{border-collapse:collapse;width:100%}.setPrint td{padding:5px 6px;vertical-align:top}
.setPrint tr+tr td{border-top:0.5px solid #ddd}.setPrint .n{width:28px;color:#777}.setPrint .r{text-align:right}
.setPrint .brk td{color:#777;font-style:italic}.setPrint tfoot td{border-top:1px solid #999;font-weight:600}
.setPrint .hd td{font-size:11px;color:#666;font-weight:600}.setPrint .line td{border-top:2px solid #000!important;font-style:italic;color:#555}.setPrint .txt td{font-style:italic;color:#333}`;
  const head = `<h1>${band.logo ? `<img src="${band.logo}" alt="">` : ''}<span>${esc(band.name)} – ${esc(l.name)}</span></h1>`;
  const html = `<style>${css}</style>${head}${big ? '' : `<div class="sub">${esc(t('{n} Songs', { n }))} · ${fmtDur(setlistDuration(band, l))}</div>`}<table>${rows}${big ? '' : `<tfoot><tr><td></td><td>${esc(t('Gesamt'))}</td>${cols.map((k) => `<td class="r">${k === 'dur' ? fmtDur(setlistDuration(band, l)) : ''}</td>`).join('')}</tr></tfoot>`}</table>`;
  document.getElementById('printArea')?.remove();
  const area = el('div', 'setPrint', html);
  area.id = 'printArea';
  document.body.appendChild(area);
  window.addEventListener('afterprint', () => setTimeout(() => area.remove(), 500), { once: true });
  void openPrintDialog();
}

// ---------------- gigs ----------------

let gigSub: 'plan' | 'tickets' | 'money' | 'docs' = 'plan';

function gigLabel(g: Gig) {
  return g.title || g.venue || t('Gig');
}

let gigView: 'list' | 'cal' = 'list';
let gigTour = ''; // '' = all, '\u0000' = without tour, else Tour.id

/** tour select for a gig; "Neue Tour …" runs the tour wizard */
function tourSelect(g: { tour?: string }, after: () => void): HTMLSelectElement {
  const sel = select(tourOptions(band), g.tour ?? '', async (v) => {
    if (v === NEW_TOUR) {
      const tr = await tourWizard(band);
      if (tr) g.tour = tr.id;
    } else g.tour = v;
    save();
    after();
  });
  return sel;
}

function renderGigs(main: HTMLElement) {
  const exp = iconBtn('calendar', band.rehearsals.length ? t('Alle Gigs und Proben als Kalender (.ics)') : t('Alle Gigs als Kalender (.ics)'), () => void downloadIcs(band, band.gigs, `${band.name} Gigs`, (m) => host.flash(m), band.rehearsals), 'tbtn');
  pageHead(main, {
    title: t('Gigs'),
    tabs: tabs<'list' | 'cal'>([['list', t('Liste')], ['cal', t('Kalender')]], gigView, (k) => { gigView = k; render(); }),
    actions: band.gigs.length || band.rehearsals.length ? [exp] : [],
    primary: { label: t('Gig'), tip: t('Gig anlegen'), fn: () => void gigWizard() },
  });
  if (gigView === 'cal') return renderCalendar(main, ctx(), (id) => { selGig = id; gigView = 'list'; render(); });
  if (!band.gigs.length) return emptyState(main, t('Noch keine Gigs.'));
  if (gigTour && gigTour !== '\u0000' && !band.tours.some((x) => x.id === gigTour)) gigTour = '';
  const shown = band.gigs.filter((g) => !gigTour || (gigTour === '\u0000' ? !g.tour : g.tour === gigTour));
  if (!shown.some((g) => g.id === selGig)) selGig = (shown[0] ?? band.gigs[0]).id;
  const now = today();
  const sorted = [...shown].sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  const upcoming = sorted.filter((g) => !g.date || g.date >= now);
  const past = sorted.filter((g) => g.date && g.date < now).reverse();
  const [list, sp] = split(main);
  if (band.tours.length) {
    const f = select([['', t('Alle Gigs')], ...band.tours.map((x) => [x.id, x.name] as [string, string]), ['\u0000', t('Ohne Tour')]], gigTour, (v) => { gigTour = v; render(); });
    f.classList.add('tourFilter');
    list.appendChild(f);
    const tr = band.tours.find((x) => x.id === gigTour);
    if (tr) list.appendChild(tourSummary(band, tr, render, (m) => host.confirm(m), () => { gigTour = ''; render(); }));
  }
  if (!shown.length) list.appendChild(el('div', 'hint pad', esc(t('Keine Gigs in dieser Auswahl.'))));
  const group = (title: string, gigs: Gig[]) => {
    if (!gigs.length) return;
    list.appendChild(el('div', 'bandGroup', esc(title)));
    for (const g of gigs) {
      const tr = !gigTour ? tourOf(band, g) : undefined;
      listItem(list, g.id === selGig, esc(gigLabel(g)) + moneyBadge(g), esc(fmtDate(g.date)) + (g.venue && g.title ? ' · ' + esc(g.venue) : '') + presaleInfo(g) + (tr ? ` · <span class="tourTag">${icon('route', 10)}${esc(tr.name)}</span>` : ''), () => {
        selGig = g.id;
        render();
      }, g.date && g.date < now ? 'past' : '');
    }
  };
  group(t('Kommend'), upcoming);
  group(t('Vergangen'), past);
  const years = new Map<string, { fee: number; open: number }>();
  for (const g of gigTour ? [] : band.gigs) {
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
    const tr = !gigTour ? tourOf(band, g) : undefined;
    it.querySelector('.s')!.innerHTML = esc(fmtDate(g.date)) + (g.venue && g.title ? ' · ' + esc(g.venue) : '') + presaleInfo(g) + (tr ? ` · <span class="tourTag">${icon('route', 10)}${esc(tr.name)}</span>` : '');
  };
  detailHead(d, {
    title: titleInput(g, 'title', g.venue || t('Titel, z.B. Release-Show'), refreshItem),
    meta: fmtDate(g.date, false),
    menu: () => [
      { icon: 'printer', label: t('Tagesplan drucken'), fn: () => printGig(g) },
      ...riderPrintItems(band, g),
      { icon: 'calendar', label: t('Kalendereinladung (.ics)'), fn: () => void downloadIcs(band, [g], `${gigLabel(g)} ${g.date}`, (m) => host.flash(m)) },
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
    tabs: tabs<'plan' | 'tickets' | 'money' | 'docs'>([['plan', t('Planung')], ['tickets', t('Vorverkauf')], ['money', t('Abrechnung')], ['docs', t('Dokumente'), g.docs.length + g.photos.length]], gigSub, (k) => {
      gigSub = k;
      render();
    }, 'gigSeg'),
  });
  if (gigSub === 'tickets') renderTickets(d, band, g, render, (m) => host.confirm(m));
  else if (gigSub === 'money') renderMoney(d, g, refreshItem);
  else if (gigSub === 'docs') renderDocs(d, g, ctx());
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
  row(s1, t('Tour'), tourSelect(g, render));

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
  if (sl && targetState(band, sl).state) s3.appendChild(el('div', 'setWarnRow', targetWarn(sl, true)));
  const lineup = el('div', 'lineup');
  const away = g.date ? awayOn(band, g.date) : [];
  for (const m of band.members) {
    const on = g.lineup.includes(m.id);
    const c = el('button', 'chipBtn' + (on ? ' on' : '') + (away.includes(m.id) ? ' away' : ''), esc(m.name || '?'));
    c.dataset.tip = away.includes(m.id) ? t('{x} hat an diesem Tag keine Zeit', { x: m.name }) : m.role;
    c.onclick = () => {
      g.lineup = on ? g.lineup.filter((x) => x !== m.id) : [...g.lineup, m.id];
      save();
      render();
    };
    lineup.appendChild(c);
  }
  row(s3, t('Besetzung'), lineup);

  gigCrewCard(right, g, ctx());

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

interface BandDraft { name: string; members: { name: string; ins: string }[]; songs: ScoreInfo[] }

const insOptions = (): [string, string][] => [['', t('Instrument …')], ...INSTRUMENTS.map((x) => [x.id, t(x.label)] as [string, string])];

/** list of picked score files with a drop zone (wizard step) */
function scorePicker(box: HTMLElement, list: ScoreInfo[]) {
  const z = el('div', 'dropZone', `${icon('upload', 22)}<b>${esc(t('Dateien hierher ziehen'))}</b><small>GP3–GP7, GPX, MusicXML, .tabw</small>`);
  const pick = el('button', 'btn', `${icon('folder', 12)}<span>${esc(t('Dateien wählen …'))}</span>`);
  pick.type = 'button';
  const rows = el('div', 'wizPick');
  const draw = () => {
    rows.innerHTML = '';
    list.forEach((f, i) => {
      const r = el('div', 'wizPickRow on', `<span class="n">${i + 1}</span><span>${esc(f.title)}</span><span class="d">${f.duration ? fmtDur(f.duration) : ''}</span>`);
      r.appendChild(iconBtn('xmark', t('Entfernen'), () => { list.splice(i, 1); draw(); }, 'tb'));
      rows.appendChild(r);
    });
  };
  const add = async (files: File[] | null) => {
    for (const f of await host.importScores(files, true)) if (!list.some((x) => x.file === f.file)) list.push(f);
    draw();
  };
  pick.onclick = () => void add(null);
  const btns = el('div', 'dzBtns');
  btns.appendChild(pick);
  z.appendChild(btns);
  dropTarget(z, (files) => void add(files));
  box.append(z, rows);
  draw();
}

/** first start (or a new band): name, members with instrument, songs from score files */
export async function bandWizard(replace = false) {
  if (replace && bandReady() && !(await host.confirm(t('Neue Band einrichten? Die aktuelle Band wird ersetzt – speichere sie vorher als Datei.')))) return;
  let opened = false;
  const r = await wizard<BandDraft>({
    title: t('Band einrichten'),
    state: { name: '', members: [{ name: '', ins: '' }], songs: [] },
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
        body: (box, s, redraw) => wizField(box, t('Name'), wizInput(s.name, t('Name der Band'), (v) => { s.name = v; redraw(); })),
      },
      {
        title: t('Wer spielt mit?'),
        text: t('Das Instrument bestimmt später die Spur in Tabwriter, Kanäle und den Bühnenplan. Weitere Instrumente und Fotos fügst du auf der Band-Seite hinzu.'),
        body: (box, s) => {
          const list = el('div', 'wizRows');
          const draw = () => {
            list.innerHTML = '';
            s.members.forEach((m, i) => {
              const r = el('div', 'wizRow');
              r.append(wizInput(m.name, t('Name'), (v) => (m.name = v)), select(insOptions(), m.ins, (v) => (m.ins = v)));
              r.appendChild(iconBtn('xmark', t('Entfernen'), () => { s.members.splice(i, 1); draw(); }, 'tb'));
              list.appendChild(r);
            });
          };
          draw();
          box.appendChild(list);
          const add = el('button', 'btn plain', `${icon('plus', 12)}<span>${esc(t('Person'))}</span>`);
          add.type = 'button';
          add.onclick = () => {
            s.members.push({ name: '', ins: '' });
            draw();
            (list.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.focus();
          };
          box.appendChild(add);
        },
      },
      {
        title: t('Songs importieren'),
        text: t('Wähle Guitar-Pro- oder Tabwriter-Dateien. Titel, Tempo und Länge werden übernommen. Kann leer bleiben.'),
        optional: true,
        body: (box, s) => scorePicker(box, s.songs),
      },
    ],
  });
  if (!r || opened) return;
  if (sync) await sync.now().catch(() => {});
  const b = newBand(r.name.trim());
  band = b;
  restartSync();
  for (const m of r.members.filter((x) => x.name.trim())) {
    const nm = newMember();
    nm.name = m.name.trim();
    b.members.push(nm);
    const p = instrumentOf(m.ins);
    if (p) addGear(b, nm.id, p.gear, p.id);
  }
  for (const f of r.songs) b.songs.push({ ...newSong(f.title), file: f.file, bpm: f.bpm, duration: f.duration, tuning: f.tuning ?? '' });
  b.setup = true;
  tab = 'home';
  save();
  host.flash(t('{x} ist angelegt', { x: b.name }));
  openBand('home');
}

async function memberWizard() {
  const r = await wizard({
    title: t('Mitglied'),
    state: { name: '', ins: '' },
    finish: t('Hinzufügen'),
    steps: [{
      title: t('Wer kommt dazu?'),
      ok: (s) => !!s.name.trim(),
      body: (box, s, redraw) => {
        wizField(box, t('Name'), wizInput(s.name, t('Name'), (v) => { s.name = v; redraw(); }));
        wizField(box, t('Instrument'), select(insOptions(), s.ins, (v) => (s.ins = v)));
      },
    }],
  });
  if (!r) return;
  const m = { ...newMember(), name: r.name.trim() };
  band.members.push(m);
  const p = instrumentOf(r.ins);
  if (p) addGear(band, m.id, p.gear, p.id);
  for (const g of band.gigs) if (g.date >= today() && g.lineup.length) g.lineup.push(m.id);
  save();
  render();
}

type SongSource = 'new' | 'open' | 'file' | 'none';

async function songWizard() {
  const cur = host.currentSong();
  const r = await wizard<{ src: SongSource; title: string; album: string; picked: ScoreInfo | null }>({
    title: t('Song'),
    state: { src: cur ? 'open' : 'file', title: '', album: songAlbum && songAlbum !== '\u0000' ? songAlbum : '', picked: null },
    finish: t('Anlegen'),
    steps: [
      {
        title: t('Woher kommen die Noten?'),
        ok: (s) => s.src !== 'file' || !!s.picked,
        body: (box, s, redraw) => {
          choices<SongSource>(box, [
            ...(cur ? [{ k: 'open' as const, icon: 'music' as IconName, label: t('Offenen Song übernehmen'), sub: cur.title }] : []),
            { k: 'file', icon: 'folder', label: t('Vorhandene Datei'), sub: s.picked ? baseName(s.picked.file) : 'GP3–GP7, GPX, MusicXML, .tabw' },
            { k: 'new', icon: 'docPlus', label: t('Neu im Editor schreiben'), sub: t('Öffnet einen leeren Song in Tabwriter') },
            { k: 'none', icon: 'textInfo', label: t('Noch keine Noten'), sub: t('Nur Titel und Steckbrief') },
          ], s.src, async (k) => {
            s.src = k;
            if (k === 'file' && !s.picked) {
              const [f] = await host.importScores(null, false);
              if (f) {
                s.picked = f;
                s.title = f.title;
                const sub = box.querySelector('.wizChoice.on small');
                if (sub) sub.textContent = baseName(f.file);
              }
            }
            redraw();
          });
          dropTarget(box, async (files) => {
            const [f] = await host.importScores(files.slice(0, 1), false);
            if (!f) return;
            s.src = 'file';
            s.picked = f;
            s.title = f.title;
            box.querySelectorAll('.wizChoice').forEach((x) => x.classList.toggle('on', x.querySelector('small')?.textContent?.includes('GP') ?? false));
            redraw();
          });
        },
      },
      {
        title: t('Wie heißt der Song?'),
        ok: (s) => !!s.title.trim(),
        body: (box, s, redraw) => {
          if (!s.title && s.src === 'open' && cur) s.title = cur.title;
          wizField(box, t('Titel'), wizInput(s.title, t('Titel'), (v) => { s.title = v; redraw(); }));
          const al = wizInput(s.album, t('optional, z.B. EP 2027'), (v) => (s.album = v));
          al.setAttribute('list', 'wizAlbums');
          const dl = el('datalist');
          dl.id = 'wizAlbums';
          for (const a of [...new Set(band.songs.map((x) => x.album).filter(Boolean))]) dl.appendChild(Object.assign(el('option'), { value: a }));
          box.appendChild(dl);
          wizField(box, t('Album'), al);
        },
      },
    ],
  });
  if (!r) return;
  const title = r.title.trim();
  const s = newSong(title);
  s.album = r.album.trim();
  if (r.src === 'open' && cur) {
    s.bpm = cur.bpm;
    s.duration = cur.duration;
    s.key = cur.key;
    s.file = cur.file;
  } else if (r.src === 'file' && r.picked) {
    s.file = r.picked.file;
    s.bpm = r.picked.bpm;
    s.duration = r.picked.duration;
    s.tuning = r.picked.tuning ?? '';
  }
  band.songs.push(s);
  selSong = s.id;
  songSub = 'songs';
  save();
  if (r.src === 'new') {
    host.newSong(title);
    host.flash(t('Beim ersten Speichern wird die Datei mit „{x}“ verknüpft.', { x: title }));
  } else render();
}

async function setlistWizard() {
  const r = await wizard<{ name: string; songs: string[]; base: string; target: string }>({
    title: t('Setlist'),
    state: { name: '', songs: [], base: '', target: '' },
    finish: t('Anlegen'),
    steps: [
      {
        title: t('Wie heißt die Setlist?'),
        ok: (s) => !!s.name.trim(),
        body: (box, s, redraw) => {
          const nm = wizInput(s.name, t('z.B. Clubshow 45 min'), (v) => { s.name = v; redraw(); });
          wizField(box, t('Name'), nm);
          const tg = wizInput(s.target, t('optional, z.B. 45 oder 1:30:00'), (v) => (s.target = v));
          wizField(box, t('Spielzeit (Minuten)'), tg);
          if (!band.setlists.length) return;
          wizField(box, t('Vorlage'), select([['', t('Leer – Songs auswählen')], ...band.setlists.map((x) => [x.id, t('Auf Basis von „{x}“', { x: x.name || t('Ohne Namen') })] as [string, string])], s.base, (v) => {
            s.base = v;
            const bl = band.setlists.find((x) => x.id === v);
            if (bl && !s.name.trim()) {
              s.name = `${bl.name} (${t('Variante')})`;
              nm.value = s.name;
            }
            if (bl?.target && !s.target.trim()) {
              s.target = fmtDur(bl.target);
              tg.value = s.target;
            }
            redraw();
          }));
          box.appendChild(el('p', 'wizText', esc(t('Mit Vorlage wird der ganze Ablauf übernommen – inkl. Pausen, Trennlinien, Notizen und Spalten. Danach kannst du ihn anpassen.'))));
        },
      },
      {
        title: t('Welche Songs?'),
        skip: (s) => !!s.base,
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
  const tv = r.target.trim();
  const target = parseDur(/^\d+$/.test(tv) ? tv + ':00' : tv);
  if (target) l.target = target;
  const base = band.setlists.find((x) => x.id === r.base);
  if (base) {
    l.items = JSON.parse(JSON.stringify(base.items)).map((it: SetItem) => ({ ...it, id: uid('i') }));
    if (base.cols) l.cols = [...base.cols];
  } else l.items = r.songs.map((id) => ({ id: uid('i'), type: 'song', song: id, note: '' } as SetItem));
  band.setlists.push(l);
  selList = l.id;
  save();
  render();
}

async function gigWizard() {
  const r = await wizard<{ date: string; title: string; venue: string; setlist: string; lineup: string[]; tour: string }>({
    title: t('Gig'),
    state: { date: today(), title: '', venue: '', setlist: band.setlists[0]?.id ?? '', lineup: band.members.map((m) => m.id), tour: band.tours.some((x) => x.id === gigTour) ? gigTour : '' },
    finish: t('Anlegen'),
    steps: [
      {
        title: t('Wann und wo?'),
        ok: (s) => !!s.date,
        body: (box, s, redraw) => {
          wizField(box, t('Datum'), wizInput(s.date, '', (v) => { s.date = v; redraw(); }, 'date'));
          wizField(box, t('Venue'), wizInput(s.venue, t('Name des Clubs'), (v) => (s.venue = v)));
          wizField(box, t('Titel'), wizInput(s.title, t('optional, z.B. Release-Show'), (v) => (s.title = v)));
          if (band.tours.length) wizField(box, t('Tour'), select(tourOptions(band).filter(([k]) => k !== NEW_TOUR), s.tour, (v) => (s.tour = v)));
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
          const away = awayOn(band, s.date);
          if (away.length) s.lineup = s.lineup.filter((x) => !away.includes(x));
          for (const m of band.members) {
            const c = el('button', 'chipBtn' + (s.lineup.includes(m.id) ? ' on' : '') + (away.includes(m.id) ? ' away' : ''), esc(m.name || '?'));
            if (away.includes(m.id)) c.dataset.tip = t('{x} hat an diesem Tag keine Zeit', { x: m.name });
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
  if (r.tour) g.tour = r.tour;
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
        if (it.type === 'line') return `<tr class="brk"><td colspan="4" style="border-top:2px solid #000">${esc(it.label)}</td></tr>`;
        if (it.type === 'text') return `<tr class="brk"><td></td><td colspan="3">${esc(it.text)}</td></tr>`;
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
<div><h2>${esc(t('Besetzung'))}</h2><table>${members.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.role)}</td><td style="text-align:right">${esc(m.phone)}</td></tr>`).join('')}${g.crew.map((w) => { const p = band.crew.find((x) => x.id === w.person); return p ? `<tr><td>${esc(p.name)}</td><td>${esc(w.task || p.role)}${w.time ? ' · ' + esc(w.time) : ''}</td><td style="text-align:right">${esc(p.phone)}</td></tr>` : ''; }).join('')}</table></div></div>
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
      delete b.cloud; // a file is a copy: it does not take over a cloud band
      migrate(b);
      if (bandReady() && !(await host.confirm(t('Aktuelle Band-Daten durch „{x}“ ersetzen?', { x: b.name })))) return;
      b.setup = true;
      band = b;
      await restoreAudio(raw.audio);
      save();
      restartSync();
      host.flash(t('{x} geöffnet', { x: f.name }));
      openBand('home');
    } catch (e: any) {
      host.flash(t('Datei konnte nicht geöffnet werden: {x}', { x: t(e?.message ?? String(e)) }));
    }
  };
  inp.click();
}

