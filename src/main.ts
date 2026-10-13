import './style.css';
import * as alphaTab from '@coderline/alphatab';
import { prefs, setPrefs, isDark } from './prefs';
import { renderOverview } from './overview';
import { initLang, t, translateDom, currentLang } from './i18n';
import { Editor } from './editor';
import { createEmptyScore, PRESETS, DRUM_LANES, getTempo, setTempo, snapshot, restore, rebuild } from './model';
import { pickFile, readDropped, saveFile, readPath, isTauri, GP5, GP7, MIDI, WAV, TABW, ZIP } from './io';
import * as A from './arrangement';
import { openFeedback, routeExternalLinks } from './feedback';
import { initBand, openBand, closeBand, bandOpen, STEPS, bandReady as hasBand, bandWizard, songSaved, bandPeople, type BandTab, type ScoreInfo } from './band/ui';
import { barTicks } from './model';
import { renderLeadSheet } from './leadsheet';
import { startMidi, stopMidi, midiSupported } from './midiin';
import { fretboardSvg, SCALES, CHORDS, NOTE_NAMES, NOTE_NAMES_EN, shapeFor } from './fretboard';
import { reaperZip } from './reaper';
import { type Version, diffScores } from './versions';
import { openPrintDialog } from './print';
import { detectChord, beatMidi, chordOf, lyricOf } from './chords';
type Arrangement = A.Arrangement;
import { listRecent, addRecent, removeRecent, cachedBytes, relTime, dbGet, dbPut, dbDelete, type RecentEntry } from './library';
import { exportMidi } from './midi';
import { writeGp5 } from './gp5writer';
import { renderWav } from './wav';
import { printScore, printParts } from './print';
import { buildDemo } from './demo';
import { tuningToText, parseTuning, tuningPresets, findPresetName, noteName } from './tuning';
import { GM_GROUPS, gmName } from './gm';
import { setupMenu, guardClose, closeWindow, onOpenFiles, checkUpdate, isDesktop, isMac, setWindowTheme, type Action } from './tauri';
import { checkBrowser } from './compat';
import { icon, hydrateIcons, type IconName } from './icons';
import { installTooltips } from './tooltip';
import { trackKind } from './model';

declare const __APP_VERSION__: string;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';

// ---------------- language + static texts ----------------
initLang(prefs().lang);
hydrateIcons();
translateDom();
installTooltips();
if (isDesktop()) document.body.classList.add('tauri');
if (isDesktop() && isMac()) document.documentElement.classList.add('vibrancy');
// Windows / Linux: show Ctrl/Alt/Shift instead of the Mac key symbols
if (!isMac()) {
  const pc = (x: string) => x.replace(/⌃⌘/g, 'Ctrl+Alt+').replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+').replace(/⌃/g, 'Ctrl+');
  document.querySelectorAll<HTMLElement>('kbd').forEach((k) => { if (/[⌘⌥⇧⌃]/.test(k.textContent ?? '')) k.textContent = pc(k.textContent!); });
  document.querySelectorAll<HTMLElement>('[data-key]').forEach((k) => { k.dataset.key = pc(k.dataset.key!); });
}

// ---------------- alphaTab setup ----------------
const settings = new alphaTab.Settings();
settings.core.engine = 'svg';
settings.core.fontDirectory = './font/';
settings.player.soundFont = './soundfont/sonivox.sf2';
settings.importer.encoding = 'windows-1252';
settings.core.logLevel = alphaTab.LogLevel.Warning;
settings.display.layoutMode = alphaTab.LayoutMode.Page;
settings.display.scale = prefs().zoom;
settings.display.padding = [30, 30, 30, 30] as any;
settings.player.playerMode = alphaTab.PlayerMode.EnabledAutomatic;
settings.player.enableCursor = true;
settings.player.outputMode = alphaTab.PlayerOutputMode.WebAudioScriptProcessor;
settings.player.enableAnimatedBeatCursor = true;
settings.player.scrollElement = $('scroll');
settings.player.scrollMode = alphaTab.ScrollMode.Continuous;
settings.notation.rhythmMode = alphaTab.TabRhythmMode.Hidden;
settings.notation.elements.set(alphaTab.NotationElement.EffectDynamics, false);
settings.notation.elements.set(alphaTab.NotationElement.TrackNames, false);
applyThemeToSettings(settings);
applyNotationView(settings);
applySansFonts(settings);

const api = new alphaTab.AlphaTabApi($('at'), settings);
const editor = new Editor(createEmptyScore(), api.settings);
editor.autoReflow = prefs().autoReflow;

type Format = 'gp5' | 'gp' | 'tabw';
let fileName = t('Neuer Song');
let saveHandle: unknown = null;
let format: Format = 'gp5';
let renderPending = false;
let playing = false;
let playedBeat: alphaTab.model.Beat | null = null;
let multiView = false;

// ---------------- theme / zoom / notation view ----------------
function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return new alphaTab.model.Color((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
}

function applyThemeToSettings(s: alphaTab.Settings) {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  { const th = prefs().theme; void setWindowTheme(th === 'auto' ? null : th); }
  const r = s.display.resources;
  const ink = dark ? '#ececee' : '#1d1d1f';
  r.mainGlyphColor = rgb(ink);
  r.secondaryGlyphColor = rgb(dark ? '#98989d' : '#6e6e73');
  r.scoreInfoColor = rgb(ink);
  r.staffLineColor = rgb(dark ? '#4a4a4f' : '#b4b4b9');
  r.barSeparatorColor = rgb(dark ? '#8e8e93' : '#3a3a3c');
  r.barNumberColor = rgb(dark ? '#8e8e93' : '#8e8e93');
}

// all text in the score uses the system sans-serif; music symbols stay in Bravura (SMuFL)
function applySansFonts(s: alphaTab.Settings) {
  const r = s.display.resources as any;
  const swap = (f: alphaTab.model.Font | undefined) =>
    f ? new alphaTab.model.Font(SANS, f.size, f.style, f.weight) : f;
  const map: Map<number, alphaTab.model.Font> | undefined = r.elementFonts;
  if (map) for (const [k, f] of Array.from(map.entries())) map.set(k, swap(f)!);
  for (const key of ['effectFont', 'fingeringFont', 'inlineFingeringFont', 'numberedNotationFont', 'numberedNotationGraceFont', 'tablatureFont', 'graceFont']) {
    if (r[key]) r[key] = swap(r[key]);
  }
}

function applyNotationView(s: alphaTab.Settings) {
  const v = prefs().notation;
  s.display.staveProfile =
    v === 'tab' ? alphaTab.StaveProfile.Tab : v === 'score' ? alphaTab.StaveProfile.Score : alphaTab.StaveProfile.Default;
}

function refreshLook() {
  applyThemeToSettings(api.settings);
  applyNotationView(api.settings);
  api.settings.display.scale = prefs().zoom;
  api.updateSettings();
  render();
}

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (prefs().theme === 'auto') refreshLook();
});

function setZoom(z: number) {
  const v = Math.round(Math.max(0.6, Math.min(1.6, z)) * 10) / 10;
  setPrefs({ zoom: v });
  refreshLook();
  flash(t('Zoom {n} %', { n: Math.round(v * 100) }));
}

// ---------------- rendering ----------------
function visibleTracks(): number[] {
  if (!multiView) return [editor.cursor.track];
  return editor.score.tracks
    .map((tr, i) => (tr.isVisibleOnMultiTrack || i === editor.cursor.track ? i : -1))
    .filter((i) => i >= 0);
}

let renderedKey = '';
// one render at a time: a result that arrives after the score was replaced
// would point to beats that no longer exist (broken cursor lookup).
// alphaTab also re-renders on its own (e.g. on resize), so count via its events.
let rendersRunning = 0;
let renderRequested = false;
let renderQueued = false;
let renderGuard = 0;
function render() {
  if (rendersRunning > 0 || renderRequested) {
    renderQueued = true;
    return;
  }
  renderRequested = true;
  renderPending = true;
  const tracks = visibleTracks();
  renderedKey = tracks.join(',');
  clearTimeout(renderGuard);
  renderGuard = window.setTimeout(resetRender, 15000);
  // render a copy: the editor changes its score in place before committing, and a render
  // that is still running must not see that (ids stay the same, so all lookups still match)
  api.renderScore(rebuild(editor.score, api.settings), tracks);
}
function resetRender() {
  rendersRunning = 0;
  renderRequested = false;
  if (renderQueued) {
    renderQueued = false;
    render();
  }
}
api.renderStarted.on(() => {
  renderRequested = false;
  rendersRunning++;
});
/** returns true when a newer render was started */
function renderDone(): boolean {
  rendersRunning = Math.max(0, rendersRunning - 1);
  if (rendersRunning > 0 || renderRequested || !renderQueued) return false;
  clearTimeout(renderGuard);
  renderQueued = false;
  render();
  return true;
}

function setMultiView(on: boolean) {
  multiView = on;
  if (leadMode) setLeadMode(false);
  $('viewBtn').classList.toggle('on', on);
  $('oneBtn').classList.toggle('on', !on);
  render();
}

// ---------------- MIDI input ----------------
let midiOn = false;
async function toggleMidiInput() {
  if (midiOn) {
    stopMidi();
    midiOn = false;
    $('midiBtn').classList.remove('on');
    flash(t('MIDI-Eingabe aus'));
    return;
  }
  if (!midiSupported()) {
    flash(isTauri() ? t('MIDI-Eingabe gibt es vorerst nur in der Web-Version (Chrome/Edge)') : t('Dieser Browser unterstützt kein Web MIDI – bitte Chrome oder Edge verwenden'));
    return;
  }
  try {
    const names = await startMidi((pitches) => {
      if (anyModalOpen() || libraryOpen() || inTextField() || leadMode) return;
      editor.clearSelection();
      if (editor.setPitches(pitches)) {
        previewNote(editor.beat.notes[0]);
        editor.next();
        moved();
        updateCursor(true);
      }
    });
    midiOn = true;
    $('midiBtn').classList.add('on');
    flash(names.length ? t('MIDI-Eingabe an: {x}', { x: names.join(', ') }) : t('MIDI-Eingabe an – noch kein Gerät gefunden'));
  } catch (e: any) {
    flash(t('MIDI nicht verfügbar: {x}', { x: e?.message ?? String(e) }));
  }
}
$('midiBtn').onclick = () => { $('midiBtn').blur(); void toggleMidiInput(); };

// ---------------- fretboard ----------------
let fbOpen = false;
function showFretboard(on: boolean) {
  fbOpen = on;
  $('fretPanel').classList.toggle('hidden', !on);
  $('fbBtn').classList.toggle('on', on);
  setPrefs({ fretboard: on });
  if (on) {
    buildFbControls();
    refreshFretboard();
  }
  updateCursor(true);
}

function buildFbControls() {
  const box = $('fbControls');
  box.innerHTML = '';
  const names = currentLang() === 'en' ? NOTE_NAMES_EN : NOTE_NAMES;
  const sel = (opts: [string, string][], v: string, fn: (v: string) => void, tip: string) => {
    const s = document.createElement('select');
    s.className = 'pInput small';
    s.dataset.tip = tip;
    for (const [k, l] of opts) s.add(new Option(l, k));
    s.value = v;
    s.onchange = () => {
      fn(s.value);
      s.blur();
      refreshFretboard();
    };
    box.appendChild(s);
    return s;
  };
  sel([['-1', t('Keine Skala')], ...names.map((n, i) => [String(i), n] as [string, string])], String(prefs().fbRoot), (v) => setPrefs({ fbRoot: Number(v) }), t('Grundton der Skala'));
  sel(SCALES.map((x) => [x.id, t(x.label)] as [string, string]), prefs().fbScale, (v) => setPrefs({ fbScale: v }), t('Skala'));
  const nm = document.createElement('button');
  nm.className = 'tbtn small' + (prefs().fbNames ? ' on' : '');
  nm.textContent = 'A♯';
  nm.dataset.tip = t('Tonnamen in der Skala zeigen');
  nm.onclick = () => {
    setPrefs({ fbNames: !prefs().fbNames });
    nm.classList.toggle('on', prefs().fbNames);
    nm.blur();
    refreshFretboard();
  };
  box.appendChild(nm);
  sel([['12', '12'], ['15', '15'], ['17', '17'], ['22', '22'], ['24', '24']], String(prefs().fbFrets), (v) => setPrefs({ fbFrets: Number(v) }), t('Anzahl Bünde'));
  const sep = document.createElement('i');
  sep.className = 'fbSep';
  box.appendChild(sep);
  const ch = sel([['', t('Akkord einsetzen …')], ...CHORDS.map((c) => [c.name, c.name] as [string, string])], '', (v) => {
    if (!v) return;
    const shape = shapeFor(v, editor.staff.tuning);
    if (!shape) flash(t('Griffbilder gibt es nur für 6 Saiten in Standardstimmung'));
    else {
      editor.setShape(shape, v);
      previewNote(editor.beat.notes[0]);
    }
    ch.value = '';
  }, t('Griffbild auf den aktuellen Schlag setzen (mit Akkordname)'));
}

function refreshFretboard() {
  if (!fbOpen) return;
  const body = $('fbBody');
  if (editor.isDrums) {
    body.innerHTML = `<div class="sideEmpty">${escapeHtml(t('Das Griffbrett gibt es für Saiteninstrumente.'))}</div>`;
    return;
  }
  const n = editor.stringCount;
  const p = prefs();
  body.innerHTML = fretboardSvg({
    tuning: editor.staff.tuning,
    frets: p.fbFrets,
    notes: editor.beat.notes.map((x) => ({ row: n - x.string, fret: x.fret })),
    row: editor.cursor.row,
    root: p.fbRoot,
    scale: p.fbScale,
    names: p.fbNames,
    en: currentLang() === 'en',
  }, Math.max(500, body.clientWidth - 8));
}
$('fbBtn').onclick = () => { $('fbBtn').blur(); showFretboard(!fbOpen); };
$('fbClose').onclick = () => showFretboard(false);
$('fbBody').addEventListener('mousedown', (e) => {
  const hit = (e.target as Element).closest('.fbHit') as SVGRectElement | null;
  if (!hit) return;
  e.preventDefault();
  const r = Number(hit.dataset.r);
  const f = Number(hit.dataset.f);
  const n = editor.toggleFretNote(r, f);
  previewNote(n);
  moved();
});
window.addEventListener('resize', () => refreshFretboard());
if (prefs().fretboard) setTimeout(() => showFretboard(true));

// ---------------- lead sheet ----------------
let leadMode = false;
function setLeadMode(on: boolean) {
  leadMode = on;
  closeEntry(false);
  $('sheet').classList.toggle('hidden', on);
  $('lead').classList.toggle('hidden', !on);
  $('leadBtn').classList.toggle('on', on);
  if (!on) document.body.classList.remove('rehearsing');
  $('viewBtn').classList.toggle('on', !on && multiView);
  $('oneBtn').classList.toggle('on', !on && !multiView);
  if (on) refreshLead(true);
  else updateCursor(true);
}
/** bar ranges of the sections (or the whole song) */
function sectionRanges(): { name: string; a: number; z: number }[] {
  const mbs = editor.score.masterBars;
  const starts = mbs.map((mb, i) => (mb.section ? i : -1)).filter((i) => i >= 0);
  if (!starts.length || starts[0] !== 0) starts.unshift(0);
  return starts.map((a, k) => ({ name: mbs[a].section?.text || t('Anfang'), a, z: (starts[k + 1] ?? mbs.length) - 1 }));
}

/** select bars a..z on the current track and loop them */
function loopBars(a: number, z: number) {
  stop();
  editor.selAnchor = { bar: a, beat: 0 };
  editor.cursor.bar = z;
  editor.cursor.beat = Math.max(0, editor.staff.bars[z].voices[0].beats.length - 1);
  looping = true;
  api.isLooping = true;
  api.playbackRange = selectionRange();
  applyPractice();
  moved();
}

function rehearsalBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'rehearse';
  const btn = (ic: IconName, tip: string, fn: () => void, on = false, label = '') => {
    const b = document.createElement('button');
    b.className = 'tbtn' + (on ? ' on' : '');
    b.innerHTML = label ? `<span>${escapeHtml(label)}</span>` : icon(ic);
    b.dataset.tip = tip;
    b.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    return b;
  };
  bar.appendChild(btn(playing ? 'pause' : 'play', t('Play / Pause (Leertaste)'), () => togglePlay(), playing));
  bar.appendChild(btn('stop', t('Stop'), () => stop()));
  const sp = Math.round(prefs().speed * 100);
  bar.appendChild(btn('minus', t('Langsamer'), () => { setPrefs({ speed: Math.max(0.25, Math.round((prefs().speed - 0.05) * 100) / 100) }); applyPractice(); refreshLead(); }));
  const spd = document.createElement('span');
  spd.className = 'rhSpeed' + (sp !== 100 ? ' changed' : '');
  spd.textContent = `${sp} % · ${Math.round(getTempo(editor.score) * prefs().speed)} bpm`;
  spd.dataset.tip = t('Klick = 100 %');
  spd.onclick = () => { setPrefs({ speed: 1 }); applyPractice(); refreshLead(); };
  bar.appendChild(spd);
  bar.appendChild(btn('plus', t('Schneller'), () => { setPrefs({ speed: Math.min(1.5, Math.round((prefs().speed + 0.05) * 100) / 100) }); applyPractice(); refreshLead(); }));
  bar.appendChild(document.createElement('i'));
  bar.appendChild(btn('metronome', t('Metronom'), () => { toggleMetronome(); refreshLead(); }, prefs().metronome));
  bar.appendChild(btn('loop', looping ? t('Schleife aus') : t('Schleife über die Auswahl / den Song'), () => { toggleLoop(); refreshLead(); }, looping));
  bar.appendChild(document.createElement('i'));
  // parts: click = loop this part
  const parts = document.createElement('div');
  parts.className = 'rhParts';
  const sel = editor.hasSelection ? editor.selection() : null;
  for (const r of sectionRanges()) {
    const on = looping && sel && sel.start.bar === r.a && sel.end.bar === r.z;
    const c = document.createElement('button');
    c.className = 'chipBtn' + (on ? ' on' : '');
    c.textContent = r.name;
    c.dataset.tip = on ? t('Schleife aus') : t('Takte {a}–{z} in Schleife', { a: r.a + 1, z: r.z + 1 });
    c.onclick = () => {
      if (on) {
        toggleLoop();
        editor.clearSelection();
      } else loopBars(r.a, r.z);
      refreshLead();
    };
    parts.appendChild(c);
  }
  bar.appendChild(parts);
  bar.appendChild(btn('textInfo', t('Kleiner'), () => { setPrefs({ leadZoom: Math.max(0.8, prefs().leadZoom - 0.1) }); refreshLead(); }, false, 'A−'));
  bar.appendChild(btn('textInfo', t('Größer'), () => { setPrefs({ leadZoom: Math.min(2.6, prefs().leadZoom + 0.1) }); refreshLead(); }, false, 'A+'));
  bar.appendChild(btn('sidebarRight', document.body.classList.contains('rehearsing') ? t('Seitenleisten zeigen') : t('Bühnenansicht: nur Lead Sheet'), () => {
    document.body.classList.toggle('rehearsing');
    refreshLead();
  }, document.body.classList.contains('rehearsing')));
  return bar;
}

function refreshLead(scroll = false) {
  if (!leadMode) return;
  const el = $('lead');
  el.style.setProperty('--ls-zoom', String(prefs().leadZoom));
  el.innerHTML = '';
  el.appendChild(rehearsalBar());
  const body = document.createElement('div');
  body.className = 'lsBody';
  el.appendChild(body);
  body.innerHTML = renderLeadSheet(editor.score, {
    perRow: 4,
    current: editor.cursor.bar,
    playing: ovPlayBar,
    title: editor.score.title || fileName,
    artist: editor.score.artist,
    tempo: getTempo(editor.score),
  });
  const target = el.querySelector('.lsBar.play') ?? (scroll ? el.querySelector('.lsBar.cur') : null);
  (target as HTMLElement | null)?.scrollIntoView({ block: ovPlayBar >= 0 ? 'center' : 'nearest', behavior: ovPlayBar >= 0 ? 'smooth' : 'auto' });
}
$('leadBtn').onclick = () => {
  $('leadBtn').blur();
  setLeadMode(!leadMode);
};
$('lead').addEventListener('mousedown', (e) => {
  const b = (e.target as HTMLElement).closest('.lsBar[data-bar]') as HTMLElement | null;
  if (!b) return;
  editor.clearSelection();
  editor.cursor.bar = Number(b.dataset.bar);
  editor.cursor.beat = 0;
  moved();
});

// ---------------- chord / lyric entry ----------------
let entryKind: 'chord' | 'lyric' | null = null;
const entryEl = document.createElement('div');
entryEl.id = 'entry';
entryEl.className = 'hidden';
entryEl.innerHTML = '<span class="entryLabel"></span><input autocomplete="off" spellcheck="false" />';
document.body.appendChild(entryEl);
const entryInput = entryEl.querySelector('input') as HTMLInputElement;

function placeEntry() {
  if (!entryKind) return;
  const r = cursorEl.getBoundingClientRect();
  const w = entryEl.offsetWidth || 180;
  const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const y = entryKind === 'chord' ? r.top - 40 : r.bottom + 6;
  entryEl.style.left = `${x}px`;
  entryEl.style.top = `${Math.max(8, Math.min(window.innerHeight - 44, y))}px`;
}

function openEntry(kind: 'chord' | 'lyric') {
  if (leadMode) setLeadMode(false);
  editor.clearSelection();
  if (kind === 'lyric' && !editor.beat.notes.length) editor.stepNoteBeat(1);
  entryKind = kind;
  entryEl.classList.remove('hidden');
  entryEl.classList.toggle('lyric', kind === 'lyric');
  (entryEl.querySelector('.entryLabel') as HTMLElement).innerHTML = icon(kind === 'chord' ? 'music' : 'textInfo', 13);
  entryEl.dataset.tip = kind === 'chord' ? t('Akkord: ↵ setzen · Tab nächster Schlag · leer = entfernen · Esc') : t('Liedtext: Leertaste/Tab weiter · ⇧Tab zurück · Silbe mit - trennen · Esc');
  fillEntry();
  moved();
  placeEntry();
  entryInput.focus();
  entryInput.select();
}

function fillEntry() {
  const b = editor.beat;
  if (entryKind === 'chord') {
    entryInput.placeholder = detectChord(beatMidi(b)) || t('z.B. Am7');
    entryInput.value = chordOf(b) || '';
  } else {
    entryInput.placeholder = t('Silbe');
    entryInput.value = lyricOf(b);
  }
}

function commitEntry() {
  if (!entryKind) return;
  const v = entryInput.value;
  if (entryKind === 'chord') {
    if (v.trim() !== chordOf(editor.beat)) editor.setChord(v);
  } else editor.setLyric(v);
}

function closeEntry(commit = true) {
  if (!entryKind) return;
  if (commit) commitEntry();
  entryKind = null;
  entryEl.classList.add('hidden');
  entryInput.blur();
}

entryInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  const k = e.key;
  if (k === 'Escape') {
    e.preventDefault();
    closeEntry(entryKind === 'lyric');
    return;
  }
  if (entryKind === 'chord') {
    if (k === 'Enter' && !entryInput.value && entryInput.placeholder && !chordOf(editor.beat) && detectChord(beatMidi(editor.beat))) {
      // empty + Enter on a fresh beat: take the suggestion
      entryInput.value = entryInput.placeholder;
    }
    if (k === 'Enter') { e.preventDefault(); closeEntry(true); return; }
    if (k === 'Tab') {
      e.preventDefault();
      commitEntry();
      if (e.shiftKey) editor.prev(); else editor.stepNoteBeat(1) || editor.next();
      fillEntry();
      moved();
      entryInput.select();
    }
    return;
  }
  // lyrics
  if (k === ' ' || k === 'Tab' || k === 'Enter') {
    e.preventDefault();
    commitEntry();
    if (e.shiftKey && k === 'Tab') editor.stepNoteBeat(-1);
    else if (!editor.stepNoteBeat(1)) { closeEntry(false); flash(t('Ende des Songs')); moved(); return; }
    fillEntry();
    moved();
    entryInput.select();
    return;
  }
  if (k === 'Backspace' && !entryInput.value) {
    e.preventDefault();
    editor.setLyric('');
    editor.stepNoteBeat(-1);
    fillEntry();
    moved();
    entryInput.select();
  }
});
entryInput.addEventListener('blur', () => setTimeout(() => {
  if (entryKind && document.activeElement !== entryInput) closeEntry(true);
}, 0));


editor.onChange = (structural) => {
  if (structural) refreshChrome();
  else refreshOverview();
  refreshLead();
  refreshFretboard();
  render();
  updateStatus();
  scheduleAutosave();
};

api.renderFinished.on(() => {
  renderPending = false;
  hideBoot();
});
api.postRenderFinished.on(() => {
  if (renderDone()) return;
  updateCursor(true);
});
api.error.on((e) => flash(t('Fehler: {x}', { x: String((e as any)?.message ?? e) })));

// ---------------- cursor overlay ----------------
const cursorEl = $('cursor');
const cursorRow = $('cursorRow');
const laneLabel = document.createElement('div');
laneLabel.className = 'lane';
cursorEl.appendChild(laneLabel);

interface CursorGeo { x: number; w: number; top: number; bottom: number; tab: alphaTab.rendering.Bounds | null }

function trackBarBounds(barIndex: number) {
  const mbb = api.boundsLookup?.findMasterBarByIndex(barIndex);
  if (!mbb) return [];
  return mbb.bars.filter((b) => {
    const st = (b.bar ?? b.beats[0]?.beat.voice.bar)?.staff;
    return st && st.track.index === editor.cursor.track && st.index === 0;
  });
}

function beatBoxes(beat: alphaTab.model.Beat | undefined) {
  if (!beat || !api.boundsLookup) return [];
  return (api.boundsLookup.findBeats(beat) ?? []).filter((bb) => bb.beat.voice.bar.staff.track.index === editor.cursor.track);
}

function findCursorGeo(): CursorGeo | null {
  const bars = trackBarBounds(editor.cursor.bar);
  if (!bars.length) return null;
  const first = bars[0].visualBounds;
  const last = bars[bars.length - 1].visualBounds;
  const showsTab = !editor.isDrums && editor.staff.showTablature && prefs().notation !== 'score';
  const tab = showsTab ? last : null;
  const all = beatBoxes(editor.beat);
  let x: number, w: number;
  if (all.length) {
    const vb = all[all.length - 1].visualBounds;
    x = vb.x;
    w = Math.max(vb.w, 12);
  } else {
    // empty beat: place after the previous beat or at bar start
    const prev = editor.cursor.beat > 0 ? beatBoxes(editor.voice.beats[editor.cursor.beat - 1]) : [];
    if (prev.length) {
      const vb = prev[prev.length - 1].visualBounds;
      x = vb.x + vb.w + 14;
    } else {
      x = first.x + Math.min(30, first.w / 3);
    }
    w = 12;
  }
  return { x, w, top: first.y, bottom: last.y + last.h, tab };
}

const selEl = document.createElement('div');
selEl.id = 'selection';
$('sheet').appendChild(selEl);

function drawSelection() {
  selEl.innerHTML = '';
  if (!editor.hasSelection || !api.boundsLookup) return;
  const { start, end } = editor.selection();
  for (let b = start.bar; b <= end.bar; b++) {
    const bars = trackBarBounds(b);
    if (!bars.length) continue;
    const first = bars[0].visualBounds;
    const last = bars[bars.length - 1].visualBounds;
    const beats = editor.staff.bars[b].voices[0].beats;
    const from = b === start.bar ? start.beat : 0;
    const to = b === end.bar ? end.beat : beats.length - 1;
    const fb = beatBoxes(beats[from]).pop()?.visualBounds;
    const tb = beatBoxes(beats[to]).pop()?.visualBounds;
    const x1 = from === 0 ? first.x + 2 : fb ? fb.x - 5 : first.x;
    const x2 = to === beats.length - 1 ? first.x + first.w - 2 : tb ? tb.x + tb.w + 5 : first.x + first.w;
    const r = document.createElement('div');
    r.style.left = `${x1}px`;
    r.style.width = `${Math.max(6, x2 - x1)}px`;
    r.style.top = `${first.y - 8}px`;
    r.style.height = `${last.y + last.h - first.y + 16}px`;
    selEl.appendChild(r);
  }
}

let lastScrollKey = '';
function updateCursor(scroll = false) {
  if (leadMode) return;
  drawSelection();
  queueMicrotask(placeEntry);
  const g = findCursorGeo();
  if (!g) {
    cursorEl.style.display = 'none';
    return;
  }
  cursorEl.style.display = '';
  const pad = 4;
  const top = g.top - 10;
  cursorEl.style.left = `${g.x - pad}px`;
  cursorEl.style.width = `${g.w + pad * 2}px`;
  cursorEl.style.top = `${top}px`;
  cursorEl.style.height = `${g.bottom - g.top + 20}px`;
  cursorEl.classList.toggle('drums', !g.tab);
  if (!g.tab) {
    laneLabel.textContent = editor.isDrums ? t(DRUM_LANES[editor.cursor.row].name) : '';
  } else {
    laneLabel.textContent = '';
    const n = editor.rowCount;
    const y = g.tab.y + (n > 1 ? (editor.cursor.row * g.tab.h) / (n - 1) : 0);
    cursorRow.style.top = `${y - top - 7}px`;
  }
  const key = `${editor.cursor.bar}`;
  if (scroll || key !== lastScrollKey) {
    lastScrollKey = key;
    ensureVisible(top - 30, g.bottom + 40);
  }
}

function ensureVisible(top: number, bottom: number) {
  if (playing) return;
  const sc = $('scroll');
  const offset = $('sheet').offsetTop;
  const tp = top + offset;
  const bt = bottom + offset;
  if (tp < sc.scrollTop) sc.scrollTo({ top: tp - 20 });
  else if (bt > sc.scrollTop + sc.clientHeight) sc.scrollTo({ top: bt - sc.clientHeight + 20 });
}

// ---------------- status bar ----------------
const DUR_NAMES: Record<number, string> = { 1: '1/1', 2: '1/2', 4: '1/4', 8: '1/8', 16: '1/16', 32: '1/32', 64: '1/64' };

function toggleVoice() {
  if (editor.isDrums) {
    flash(t('Drums haben nur eine Stimme'));
    return;
  }
  editor.setVoice(editor.vi ? 0 : 1);
  flash(editor.vi ? t('Stimme 2 (Hälse nach unten) – Q wechselt zurück') : t('Stimme 1'));
  moved();
  updateCursor(true);
}

function updateStatus() {
  const c = editor.cursor;
  $('lcdVoice').textContent = String(editor.vi + 1);
  $('lcdVoiceCell').classList.toggle('changed', editor.vi > 0);
  const b = editor.beat;
  $('lcdPos').textContent = `${c.bar + 1} · ${c.beat + 1}`;
  let d = DUR_NAMES[b.duration] ?? String(b.duration);
  if (b.dots) d += '.';
  if (b.tupletNumerator === 3) d += '³';
  $('lcdDur').textContent = d;
  if (editor.isDrums) {
    $('lcdRow').textContent = t(DRUM_LANES[c.row].name).split(' ')[0];
    $('lcdRowCap').textContent = t('Drums');
  } else {
    $('lcdRow').textContent = alphaTab.model.Tuning.getTextForTuning(editor.staff.tuning[c.row], false);
    $('lcdRowCap').textContent = t('Saite {n}', { n: c.row + 1 });
  }
  const f = editor.barFill();
  const mb = editor.masterBar;
  $('lcdSig').textContent = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
  const fill = $('lcdFill');
  const over = f.used > f.total;
  const under = !over && f.used < f.total && editor.barHasContent();
  fill.textContent = over ? t('zu voll') : under ? t('offen') : t('Takt');
  fill.classList.toggle('over', over);
  fill.classList.toggle('warn', under);
  $('lcdSigCell').dataset.tip = over ? t('Takt zu voll') : under ? t('Takt unvollständig') : t('Taktart ändern (M)');
}

let flashTimer = 0;
function flash(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el.classList.remove('on'), 2200);
}

// ---------------- notice banner ----------------
function notice(text: string, actions: { label: string; fn: () => void; primary?: boolean }[] = []) {
  $('noticeText').textContent = text;
  const box = $('noticeActions');
  box.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    b.className = a.primary ? 'btn primary' : 'btn';
    b.onclick = () => {
      hideNotice();
      a.fn();
    };
    box.appendChild(b);
  }
  $('notice').classList.remove('hidden');
}
function hideNotice() {
  $('notice').classList.add('hidden');
}
$('noticeClose').onclick = hideNotice;

// ---------------- top bar + sidebars ----------------
const titleEl = $<HTMLInputElement>('title');
const tempoEl = $<HTMLInputElement>('tempo');

const KIND_ICON: Record<string, IconName> = { guitar: 'guitar', bass: 'bass', drums: 'drum', synth: 'synth' };

function trackSubtitle(tr: alphaTab.model.Track): string {
  const st = tr.staves[0];
  if (st.isPercussion) return t('Standard-Drumkit');
  return gmName(tr.playbackInfo.program);
}

function trackTip(tr: alphaTab.model.Track): string {
  const st = tr.staves[0];
  if (st.isPercussion) return tr.name;
  const name = st.stringTuning.name?.replace(/^(Guitar|Bass) /, '').replace(/ Tuning$/, '');
  return `${tr.name}: ${gmName(tr.playbackInfo.program)}, ${name || tuningToText(st.tuning).replace(/-?\d/g, '')}`;
}

function refreshChrome() {
  if (document.activeElement !== titleEl) titleEl.value = editor.score.title || fileName;
  if (document.activeElement !== tempoEl) tempoEl.value = String(getTempo(editor.score));
  refreshTrackList();
  refreshSections();
  refreshPanel();
  updateWindowTitle();
  refreshOverview();
}

// ---------------- boot skeleton ----------------
function hideBoot() {
  const b = document.getElementById('boot');
  if (!b || b.classList.contains('out') || b.dataset.leaving) return;
  b.dataset.leaving = '1';
  // let the light come on before the stage fades out (about 1.2 s after start)
  const wait = Math.max(0, 1200 - performance.now());
  setTimeout(() => {
    b.classList.add('out');
    setTimeout(() => b.remove(), 550);
  }, wait);
}
setTimeout(hideBoot, 8000); // fallback

// ---------------- overview (tracks × bars) ----------------
let ovOpen = false;
let ovPlayBar = -1;
function refreshOverview() {
  if (!ovOpen) return;
  const sel = editor.hasSelection ? editor.selection() : null;
  renderOverview($('ovContent'), {
    score: editor.score,
    track: editor.cursor.track,
    bar: editor.cursor.bar,
    sel: sel ? { start: sel.start.bar, end: sel.end.bar } : null,
    playingBar: ovPlayBar,
    arr: editor.arr,
  }, {
    tracks: t('Spuren'),
    bar: (n) => t('Takt {n}', { n }),
    arrangement: t('Arrangement'),
    linked: (n) => t('{n}× verknüpft', { n }),
    times: (n) => t('{n}× wiederholen', { n }),
    from: (p) => t('aus {x}', { x: p }),
  });
  $('arrBtn').classList.toggle('on', !!editor.arr);
  $('arrAdd').classList.toggle('hidden', !editor.arr);
}
function showOverview(on: boolean) {
  ovOpen = on;
  $('overview').classList.toggle('hidden', !on);
  $('ovBtn').classList.toggle('on', on);
  setPrefs({ overview: on });
  refreshOverview();
}
if (prefs().overview) setTimeout(() => showOverview(true));
$('ovClose').onclick = () => showOverview(false);
$('ovBtn').onclick = () => {
  $('ovBtn').blur();
  showOverview(!ovOpen);
};
$('overview').style.setProperty('--ov-h', prefs().ovHeight + 'px');
$('overview').addEventListener('mousedown', (e) => {
  if ((e.target as HTMLElement).closest('.ovTop')) return;
  if ((e.target as HTMLElement).classList.contains('ovGrip')) {
    e.preventDefault();
    const ov = $('overview');
    const y0 = e.clientY;
    const h0 = ov.getBoundingClientRect().height;
    document.body.classList.add('ovResizing');
    const mv = (m: MouseEvent) => {
      const h = Math.round(Math.min(window.innerHeight * 0.7, Math.max(90, h0 + y0 - m.clientY)));
      ov.style.setProperty('--ov-h', h + 'px');
    };
    const up = () => {
      document.body.classList.remove('ovResizing');
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      setPrefs({ ovHeight: Math.round(ov.getBoundingClientRect().height) });
      updateCursor(true);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return;
  }
  const blk = (e.target as HTMLElement).closest('.arBlock') as HTMLElement | null;
  if (blk) {
    e.preventDefault();
    arrMouseDown(e, Number(blk.dataset.blk));
    return;
  }
  const el = (e.target as HTMLElement).closest('[data-b],[data-t]') as HTMLElement | null;
  if (!el) return;
  e.preventDefault();
  if (e.altKey && editor.arr && el.dataset.t !== undefined && el.dataset.b !== undefined) {
    // ⌥-click: mute/unmute this track in this block
    const bi = A.blockAt(editor.arr, Number(el.dataset.b));
    const tr = Number(el.dataset.t);
    const on = !editor.arr.blocks[bi].muted.includes(tr);
    editor.arrOp((o, a) => A.setMute(o, a, a.blocks[bi], tr, on));
    return;
  }
  const tr = el.dataset.t !== undefined ? Number(el.dataset.t) : editor.cursor.track;
  const b = el.dataset.b !== undefined ? Number(el.dataset.b) : -1;
  if (tr !== editor.cursor.track) switchTrack(tr);
  if (b >= 0) {
    if (e.shiftKey && tr === editor.cursor.track) {
      const a = editor.selAnchor?.bar ?? editor.cursor.bar;
      const lastOf = (i: number) => Math.max(0, editor.staff.bars[i].voices[0].beats.length - 1);
      // whole bars from anchor bar to clicked bar, in either direction
      editor.selAnchor = b >= a ? { bar: a, beat: 0 } : { bar: a, beat: lastOf(a) };
      editor.cursor.bar = b;
      editor.cursor.beat = b >= a ? lastOf(b) : 0;
    } else {
      editor.clearSelection();
      editor.cursor.bar = b;
      editor.cursor.beat = 0;
    }
    moved();
    updateCursor(true);
  }
});

// ---------------- band (Stagecraft) ----------------
/** how the open song is found again: real path (desktop) or its library file name */
function currentFileKey(): string {
  if (typeof saveHandle === 'string') return saveHandle;
  const it = listRecent().find((x) => x.fileName.replace(/\.[^.]+$/, '') === fileName);
  return it?.path ?? it?.fileName ?? '';
}
/** song length in seconds (repeats ignored), tempo of bar 1 */
function songDuration(score = editor.score): number {
  const bpm = getTempo(score) || 120;
  const ticks = score.masterBars.reduce((a, mb) => a + barTicks(mb), 0);
  // repeated sections count once more per extra play
  let rep = 0;
  let start = 0;
  score.masterBars.forEach((mb, i) => {
    if (mb.isRepeatStart) start = i;
    if (mb.repeatCount > 1) for (let k = start; k <= i; k++) rep += barTicks(score.masterBars[k]) * (mb.repeatCount - 1);
  });
  return Math.round(((ticks + rep) / 960) * (60 / bpm));
}

const SCORE_EXT = '.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml,.mxl,.tabw';

/** read score files for the band: title, tempo, length; the bytes go into the library */
async function importScores(files: File[] | null, multiple: boolean): Promise<ScoreInfo[]> {
  if (!files) {
    files = await new Promise<File[]>((res) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = SCORE_EXT;
      inp.multiple = multiple;
      inp.onchange = () => res(Array.from(inp.files ?? []));
      inp.oncancel = () => res([]);
      inp.click();
    });
  }
  const out: ScoreInfo[] = [];
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const ext = (f.name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
      const score = ext === 'tabw'
        ? restore(JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)).score), api.settings)
        : alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, api.settings);
      const title = score.title || f.name.replace(/\.[^.]+$/, '');
      await addRecent({ title, artist: score.artist, fileName: f.name, tracks: score.tracks.map((tr) => tr.name) }, bytes);
      const gt = score.tracks.find((tr) => !tr.staves[0]?.isPercussion && tr.staves[0]?.tuning.length >= 6);
      const tn = gt ? (findPresetName(gt.staves[0].tuning).replace(/^Guitar /, '').replace(/ Tuning$/, '') || tuningToText(gt.staves[0].tuning)) : '';
      out.push({ title, file: f.name, bpm: Math.round(getTempo(score)), duration: songDuration(score), tuning: tn });
    } catch (e: any) {
      flash(t('Datei konnte nicht geöffnet werden: {x}', { x: `${f.name} – ${e?.message ?? e}` }));
    }
  }
  return out;
}
const bandReady = initBand({
  currentSong: () => (hasSong ? { title: editor.score.title || fileName, bpm: Math.round(getTempo(editor.score)), duration: songDuration(), key: '', file: currentFileKey() } : null),
  flash: (m) => flash(m),
  confirm: (m) => confirmAsk(m),
  home: () => { closeBand(); openLibrary(); },
  editor: () => { closeBand(); closeLibrary(); },
  hasSong: () => hasSong,
  songTitle: () => editor.score.title || fileName,
  newSong: (title) => { closeBand(); void newSong(title); },
  mountRecovery: (box) => {
    void showRecovery();
    box.appendChild($('libRecover'));
  },
  openDialog: () => void openSong(),
  feedback: (area) => void openFeedback(area, flash),
  importScores,
  snippet: () => editor.snippet(),
  useClip: (c) => {
    editor.setClip(c);
    closeBand();
    closeLibrary();
    flash(t('Riff kopiert – ⌘V fügt es ein, ⇧⌘V als neue Takte'));
  },
  recentFiles: () => listRecent().map((it) => ({ label: it.title || it.fileName, file: it.path ?? it.fileName, time: it.time })),
  pickFile: async () => {
    const f = await pickFile($<HTMLInputElement>('fileInput'));
    if (!f) return null;
    const path = typeof f.handle === 'string' ? f.handle : undefined;
    await addRecent({ title: f.name.replace(/\.[^.]+$/, ''), artist: '', fileName: f.name, path, tracks: [] }, f.bytes);
    return { label: f.name.replace(/\.[^.]+$/, ''), file: path ?? f.name };
  },
  openFile: async (file) => {
    const it = listRecent().find((x) => x.path === file || x.fileName === file);
    if (it) {
      await openRecent(it);
      return true;
    }
    if (isTauri() && /[\\/]/.test(file)) {
      await openPath(file);
      return true;
    }
    return false;
  },
});
// the home screen may have been drawn before the band data was loaded
void bandReady.then(() => {
  if (libraryOpen()) openLibrary();
});

// ---------------- arrangement ----------------
$('arrBtn').onclick = async () => {
  $('arrBtn').blur();
  if (editor.arr) {
    if (!(await confirmAsk(t('Arrangement ausschalten? Abschnitte bleiben, Verknüpfungen und Kommentare gehen verloren.')))) return;
    editor.enableArrangement(false);
    flash(t('Arrangement aus'));
  } else {
    editor.enableArrangement(true);
    flash(t('Arrangement an – Teile aus den Abschnitten erstellt'));
  }
};
$('arrAdd').onclick = () => {
  $('arrAdd').blur();
  void arrNewPart();
};

function arrCur(): number {
  return editor.arr ? A.blockAt(editor.arr, editor.cursor.bar) : -1;
}

function gotoBlock(i: number) {
  const arr = editor.arr;
  if (!arr) return;
  editor.clearSelection();
  editor.cursor.bar = A.starts(arr)[i];
  editor.cursor.beat = 0;
  moved();
  updateCursor(true);
}

async function arrNewPart() {
  const at = arrCur();
  const name = await ask(t('Name des neuen Teils'), t('Bridge'));
  if (!name) return;
  const lenS = await ask(t('Anzahl Takte'), '4');
  const len = Math.max(1, Math.min(256, parseInt(lenS ?? '') || 0));
  if (!lenS || !len) return;
  editor.arrOp((o, a) => A.insertNew(o, a, at, name.trim(), len));
  gotoBlock(at + 1);
}

function openBlockMenu(i: number, x: number, y: number) {
  const arr = editor.arr;
  if (!arr) return;
  const bl = arr.blocks[i];
  const part = A.partOf(arr, bl);
  const linked = A.siblings(arr, bl).length > 1;
  const pop = $('trackMenu');
  pop.innerHTML = '';
  menuButton(pop, 'pencil', t('Umbenennen …'), async () => {
    const n = await ask(linked ? t('Name (gilt für alle verknüpften)') : t('Name des Teils'), part.name);
    if (n?.trim()) editor.arrOp((_o, a) => (A.partOf(a, a.blocks[i]).name = n.trim()));
  });
  menuButton(pop, 'link', t('Verknüpft duplizieren'), () => {
    editor.arrOp((o, a) => A.duplicate(o, a, i, i, true));
    gotoBlock(i + 1);
  });
  menuButton(pop, 'duplicate', t('Als eigene Kopie duplizieren'), () => {
    editor.arrOp((o, a) => A.duplicate(o, a, i, i, false));
    gotoBlock(i + 1);
  });
  if (linked) {
    menuButton(pop, 'unlink', t('Kopie lösen'), () => {
      editor.arrOp((_o, a) => {
        const b = a.blocks[i];
        b.part = A.addPart(a, `${A.partOf(a, b).name}'`).id;
      });
    });
  }
  pop.appendChild(document.createElement('hr'));
  menuButton(pop, 'repeat', bl.times > 1 ? t('Wiederholung: {n}× …', { n: bl.times }) : t('Wiederholen …'), async () => {
    const n = await ask(t('Wie oft spielen? (1 = keine Wiederholung)'), String(Math.max(2, bl.times)));
    const v = parseInt(n ?? '');
    if (v >= 1) editor.arrOp((o, a) => A.setTimes(o, a, a.blocks[i], v));
  });
  menuButton(pop, 'comment', bl.comment ? t('Kommentar bearbeiten …') : t('Kommentar …'), async () => {
    const c = await ask(t('Kommentar zu diesem Block'), bl.comment);
    if (c !== null) editor.arrOp((_o, a) => (a.blocks[i].comment = c.trim()));
  });
  pop.appendChild(document.createElement('hr'));
  editor.score.tracks.forEach((tr, k) => {
    const m = bl.muted.includes(k);
    menuButton(pop, m ? 'speakerSlash' : 'speaker', m ? t('{x} wieder an', { x: tr.name }) : t('{x} hier stumm', { x: tr.name }), () => {
      editor.arrOp((o, a) => A.setMute(o, a, a.blocks[i], k, !m));
    });
  });
  if (arr.parts.length > 1) {
    menuButton(pop, 'blocks', t('Spuren aus anderen Teilen …'), () => openTrackFrom(i, x, y));
  }
  pop.appendChild(document.createElement('hr'));
  if (i > 0) menuButton(pop, 'arrowLeft', t('Nach links'), () => { editor.arrOp((o, a) => A.move(o, a, i, i - 1)); gotoBlock(i - 1); });
  if (i < arr.blocks.length - 1) menuButton(pop, 'arrowRight', t('Nach rechts'), () => { editor.arrOp((o, a) => A.move(o, a, i, i + 1)); gotoBlock(i + 1); });
  menuButton(pop, 'select', t('Block auswählen'), () => {
    const s = A.starts(arr)[i];
    const end = s + bl.len - 1;
    editor.selAnchor = { bar: s, beat: 0 };
    editor.cursor.bar = end;
    editor.cursor.beat = editor.staff.bars[end].voices[0].beats.length - 1;
    moved();
  });
  if (arr.blocks.length > 1) {
    pop.appendChild(document.createElement('hr'));
    menuButton(pop, 'trash', t('Block löschen'), () => editor.arrOp((o, a) => A.remove(o, a, i)), 'danger');
  }
  closePops();
  placePop(pop, x, y);
}

/** per track: play this part's own material or another part's (e.g. Strophe-Drums im Refrain) */
function openTrackFrom(i: number, x: number, y: number) {
  const arr = editor.arr;
  if (!arr) return;
  const bl = arr.blocks[i];
  const pop = $('trackMenu');
  pop.innerHTML = `<div class="popHead">${escapeHtml(t('Spuren in „{x}“', { x: A.partOf(arr, bl).name }))}</div>`;
  editor.score.tracks.forEach((tr, k) => {
    const row = document.createElement('label');
    row.className = 'fromRow';
    row.innerHTML = `<span class="ovIcon trackIcon ${trackKind(tr)}">${icon(KIND_ICON[trackKind(tr)] ?? 'music', 12)}</span><span class="nm">${escapeHtml(tr.name)}</span>`;
    const s = document.createElement('select');
    s.className = 'pInput small';
    s.add(new Option(bl.muted.includes(k) ? t('stumm') : t('eigene'), ''));
    for (const p of arr.parts) if (p.id !== bl.part) s.add(new Option(t('aus {x}', { x: p.name }), p.id));
    s.value = bl.from?.[k] ?? '';
    s.onchange = () => {
      const v = s.value;
      editor.arrOp((o, a) => A.setTrackFrom(o, a, i, k, v));
      flash(v ? t('{x} spielt hier „{y}“ – Änderungen gelten in beiden Teilen', { x: tr.name, y: arr.parts.find((p) => p.id === v)?.name ?? '' }) : t('{x} spielt hier wieder den eigenen Teil', { x: tr.name }));
    };
    row.appendChild(s);
    pop.appendChild(row);
  });
  closePops();
  placePop(pop, x, y);
}

/** click = jump, double-click = rename, right-click = menu, drag = move */
let arrLastClick = { i: -1, time: 0 };
function arrMouseDown(e: MouseEvent, i: number) {
  if (e.button === 2 || e.ctrlKey) {
    openBlockMenu(i, e.clientX, e.clientY);
    return;
  }
  const now = performance.now();
  if (arrLastClick.i === i && now - arrLastClick.time < 350) {
    arrLastClick = { i: -1, time: 0 };
    const arr = editor.arr!;
    const part = A.partOf(arr, arr.blocks[i]);
    void ask(t('Name des Teils'), part.name).then((n) => {
      if (n?.trim()) editor.arrOp((_o, a) => (A.partOf(a, a.blocks[i]).name = n.trim()));
    });
    return;
  }
  arrLastClick = { i, time: now };
  const x0 = e.clientX;
  const blocks = Array.from(document.querySelectorAll<HTMLElement>('#ovContent .arBlock'));
  let dragging = false;
  let target = i;
  const clearMarks = () => blocks.forEach((b) => b.classList.remove('dropL', 'dropR', 'dragging'));
  const mv = (m: MouseEvent) => {
    if (!dragging && Math.abs(m.clientX - x0) < 5) return;
    dragging = true;
    document.body.classList.add('arDragging');
    clearMarks();
    blocks[i]?.classList.add('dragging');
    // insertion gap = number of blocks whose middle is left of the mouse
    let gap = 0;
    blocks.forEach((b) => {
      const r = b.getBoundingClientRect();
      if (m.clientX > r.left + r.width / 2) gap++;
    });
    target = gap > i ? gap - 1 : gap;
    if (gap < blocks.length) blocks[gap].classList.add('dropL');
    else blocks[blocks.length - 1].classList.add('dropR');
  };
  const up = () => {
    window.removeEventListener('mousemove', mv);
    window.removeEventListener('mouseup', up);
    document.body.classList.remove('arDragging');
    clearMarks();
    if (dragging) {
      if (target !== i) {
        editor.arrOp((o, a) => A.move(o, a, i, target));
        gotoBlock(target);
      }
    } else gotoBlock(i);
  };
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
}
$('overview').addEventListener('contextmenu', (e) => {
  if ((e.target as HTMLElement).closest('.arBlock')) e.preventDefault();
});

function updateWindowTitle() {
  const name = editor.score.title || fileName;
  document.title = `${editor.dirty ? '• ' : ''}${name} – Stagecraft`;
  const parts = [editor.score.artist, editor.dirty ? t('Bearbeitet') : `${fileName}.${format}`].filter(Boolean);
  $('subtitle').textContent = parts.join(' – ');
}

function refreshTrackList() {
  const list = $('trackList');
  list.innerHTML = '';
  editor.score.tracks.forEach((tr, i) => {
    const pi = tr.playbackInfo;
    const kind = trackKind(tr);
    const row = document.createElement('div');
    row.className = 'trackRow' + (i === editor.cursor.track ? ' active' : '') + (pi.isMute ? ' muted' : '');
    row.dataset.tip = trackTip(tr);
    row.innerHTML = `<div class="trackIcon ${kind}">${icon(KIND_ICON[kind] ?? 'music')}</div>
      <div class="info"><div class="name">${escapeHtml(tr.name || t('Spur {n}', { n: i + 1 }))}</div><div class="sub">${escapeHtml(trackSubtitle(tr))}</div></div>`;
    const btns = document.createElement('div');
    btns.className = 'btns';
    const mk = (html: string, tip: string, on: boolean, cls: string, fn: () => void) => {
      const b = document.createElement('button');
      b.className = `tb ${cls}` + (on ? ' on' : '');
      b.innerHTML = html;
      b.dataset.tip = tip;
      b.setAttribute('aria-label', tip);
      b.onclick = (e) => {
        e.stopPropagation();
        b.blur();
        fn();
      };
      btns.appendChild(b);
    };
    if (!tr.staves[0].isPercussion) {
      mk(icon('tuningFork', 14), t('Stimmung ändern'), false, 'tune', () => {
        switchTrack(i);
        showPanel(true);
        const txt = document.getElementById('pTuneText') as HTMLInputElement | null;
        txt?.focus();
        txt?.select();
      });
    }
    mk(icon(tr.isVisibleOnMultiTrack ? 'eye' : 'eyeSlash', 14), tr.isVisibleOnMultiTrack ? t('In „Alle Spuren“ sichtbar') : t('In „Alle Spuren“ ausgeblendet'), tr.isVisibleOnMultiTrack, 'vis', () => {
      editor.mutate((s) => (s.tracks[i].isVisibleOnMultiTrack = !s.tracks[i].isVisibleOnMultiTrack));
    });
    mk('M', t('Stumm'), pi.isMute, 'mute', () => toggleMute(i));
    mk('S', t('Solo'), pi.isSolo, 'solo', () => toggleSolo(i));
    row.appendChild(btns);
    row.onclick = () => switchTrack(i);
    row.ondblclick = async () => {
      const n = await ask(t('Name der Spur'), tr.name);
      if (n) editor.renameTrack(i, n);
    };
    row.oncontextmenu = (e) => {
      e.preventDefault();
      openTrackMenu(i, e.clientX, e.clientY);
    };
    list.appendChild(row);
  });
}

function refreshSections() {
  const list = $('sectionList');
  list.innerHTML = '';
  const bars = editor.score.masterBars;
  const starts = bars.map((mb, i) => (mb.section ? i : -1)).filter((i) => i >= 0);
  if (!starts.length) {
    list.innerHTML = `<div class="sideEmpty">${escapeHtml(t('Markiere Teile wie Intro oder Refrain mit + oder im Takt-Inspektor.'))}</div>`;
    return;
  }
  starts.forEach((bi, k) => {
    const end = (starts[k + 1] ?? bars.length) - 1;
    const row = document.createElement('div');
    row.className = 'secRow' + (editor.cursor.bar >= bi && editor.cursor.bar <= end ? ' active' : '');
    row.innerHTML = `${icon('bookmark', 14)}<span class="secName">${escapeHtml(bars[bi].section!.text || t('Abschnitt'))}</span><span class="secBars">${bi + 1}–${end + 1}</span>`;
    const sel = document.createElement('button');
    sel.className = 'tb';
    sel.innerHTML = icon('select', 14);
    sel.dataset.tip = t('Ganzen Abschnitt auswählen');
    sel.onclick = (e) => {
      e.stopPropagation();
      editor.selAnchor = { bar: bi, beat: 0 };
      editor.cursor.bar = end;
      editor.cursor.beat = editor.staff.bars[end].voices[0].beats.length - 1;
      moved();
      flash(t('Abschnitt ausgewählt – ⌘C zum Kopieren'));
    };
    row.appendChild(sel);
    row.onclick = () => {
      editor.clearSelection();
      editor.cursor.bar = bi;
      editor.cursor.beat = 0;
      moved();
    };
    row.ondblclick = async () => {
      const n = await ask(t('Name des Abschnitts'), bars[bi].section!.text);
      if (n !== null) {
        const err = editor.setSection(n, bi);
        if (err) flash(err);
      }
    };
    list.appendChild(row);
  });
}

$('addSection').onclick = async () => {
  $('addSection').blur();
  const cur = editor.masterBar.section?.text ?? '';
  const n = await ask(t('Abschnitt ab Takt {n}', { n: editor.cursor.bar + 1 }), cur || t('Strophe'));
  if (n !== null) {
    const err = editor.setSection(n);
    if (err) flash(err);
  }
};

function toggleMute(i: number) {
  const tr = editor.score.tracks[i];
  tr.playbackInfo.isMute = !tr.playbackInfo.isMute;
  editor.dirty = true;
  api.changeTrackMute([tr], tr.playbackInfo.isMute);
  refreshTrackList();
  scheduleAutosave();
}

function toggleSolo(i: number) {
  const tr = editor.score.tracks[i];
  tr.playbackInfo.isSolo = !tr.playbackInfo.isSolo;
  editor.dirty = true;
  api.changeTrackSolo([tr], tr.playbackInfo.isSolo);
  refreshTrackList();
  scheduleAutosave();
}

// ---------------- right panel (active track) ----------------
let panelOpen = true;
function showPanel(on: boolean) {
  panelOpen = on;
  document.body.classList.toggle('noPanel', !on);
  $('panelBtn').classList.toggle('on', on);
  render();
}
$('panelBtn').onclick = () => {
  $('panelBtn').blur();
  showPanel(!panelOpen);
};

type PanelTab = 'track' | 'bar';
let panelTab: PanelTab = 'track';
let panelBar = -1;

function refreshPanel() {
  const right = $('right');
  right.innerHTML = '';
  const tabs = document.createElement('div');
  tabs.className = 'inspTabs';
  tabs.innerHTML = `<div class="seg wideSeg">
      <button data-tab="track" class="${panelTab === 'track' ? 'on' : ''}">${icon('guitar', 14)}<span>${escapeHtml(t('Spur'))}</span></button>
      <button data-tab="bar" class="${panelTab === 'bar' ? 'on' : ''}">${icon('barIcon', 14)}<span>${escapeHtml(t('Takt'))}</span></button>
    </div>`;
  tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.onclick = () => {
      panelTab = b.dataset.tab as PanelTab;
      b.blur();
      refreshPanel();
    };
  });
  right.appendChild(tabs);
  const body = document.createElement('div');
  body.className = 'inspBody';
  right.appendChild(body);
  panelBar = editor.cursor.bar;
  if (panelTab === 'bar') refreshBarPanel(body);
  else refreshTrackPanel(body);
}

let pendingWho = ''; // person picked in the inspector, instrument still open
function refreshTrackPanel(el: HTMLElement) {
  const i = editor.cursor.track;
  const tr = editor.score.tracks[i];
  const st = tr.staves[0];
  const drums = st.isPercussion;
  const pi = tr.playbackInfo;
  el.innerHTML = '';

  const section = (title: string) => {
    const s = document.createElement('section');
    s.className = 'insp';
    s.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
    el.appendChild(s);
    return s;
  };
  const row = (parent: HTMLElement, label: string, ...controls: (HTMLElement | string)[]) => {
    const r = document.createElement('div');
    r.className = 'irow';
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = label;
    const c = document.createElement('div');
    c.className = 'ctl';
    for (const x of controls) {
      if (typeof x === 'string') c.insertAdjacentHTML('beforeend', x);
      else c.appendChild(x);
    }
    r.append(l, c);
    parent.appendChild(r);
    return r;
  };
  const popup = (sel: HTMLSelectElement) => {
    const w = document.createElement('span');
    w.className = 'popup';
    w.appendChild(sel);
    return w;
  };

  // track
  const s1 = section(t('Spur'));
  const name = document.createElement('input');
  name.className = 'pInput';
  name.value = tr.name;
  name.spellcheck = false;
  name.onchange = () => {
    const v = name.value.trim();
    if (v && v !== tr.name) editor.renameTrack(i, v);
  };
  name.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') name.blur();
  };
  row(s1, t('Name'), name);

  // who plays it (band members and their instruments)
  const people = bandPeople();
  if (people.length) {
    const fits = (p: { track: { kind: string } }) => (drums ? p.track.kind === 'drums' : p.track.kind !== 'drums');
    const who = people.find((p) => tr.name.startsWith(`${p.name} – `) || tr.name === p.name);
    const ps = document.createElement('select');
    ps.innerHTML = `<option value="">–</option>` + people.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    ps.value = who?.id ?? '';
    const apply = (person: (typeof people)[number], ins: (typeof people)[number]['instruments'][number]) => {
      const pr = ins.preset;
      editor.renameTrack(i, `${person.name} – ${t(pr.label)}`);
      if (!drums) {
        editor.setTrackProgram(i, pr.track.program);
        if (pr.track.tuning.length && pr.track.tuning.join() !== st.tuning.join()) editor.setTuning(i, pr.track.tuning, true);
      }
      refreshChrome();
      render();
      flash(t('Spur: {x}', { x: `${person.name} – ${t(pr.label)}` }));
    };
    ps.onchange = () => {
      const p = people.find((x) => x.id === ps.value);
      ps.blur();
      pendingWho = p ? `${i}:${p.id}` : '';
      const ok = p?.instruments.filter((x) => fits(x.preset)) ?? [];
      if (p && ok.length === 1) {
        pendingWho = '';
        apply(p, ok[0]);
      } else refreshTrackPanel(el);
    };
    ps.id = 'pWho';
    row(s1, t('Person'), popup(ps));
    const pend = pendingWho.startsWith(`${i}:`) ? pendingWho.slice(String(i).length + 1) : '';
    const sel = people.find((p) => p.id === (pend || who?.id));
    if (sel) ps.value = sel.id;
    const ok = sel?.instruments.filter((x) => fits(x.preset)) ?? [];
    if (sel && ok.length > 1) {
      const is = document.createElement('select');
      const curIns = ok.find((x) => tr.name === `${sel.name} – ${t(x.preset.label)}`);
      is.innerHTML = (curIns ? '' : `<option value="">${escapeHtml(t('Instrument wählen …'))}</option>`) + ok.map((x) => `<option value="${x.id}">${escapeHtml(t(x.preset.label) + (x.model ? ` (${x.model})` : ''))}</option>`).join('');
      if (curIns) is.value = curIns.id;
      is.onchange = () => {
        const x = ok.find((y) => y.id === is.value);
        is.blur();
        pendingWho = '';
        if (x) apply(sel, x);
      };
      row(s1, t('Instrument'), popup(is));
    } else if (sel && !ok.length) row(s1, '', `<span class="sub">${escapeHtml(t('Kein passendes Instrument für diese Spur'))}</span>`);
  }

  // sound
  const s2 = section(t('Klang'));
  if (drums) {
    row(s2, t('Instrument'), `<span class="sub">${escapeHtml(t('Standard-Drumkit'))}</span>`);
  } else {
    const sel = document.createElement('select');
    GM_GROUPS.forEach((g, gi) => {
      const og = document.createElement('optgroup');
      og.label = t(g.name);
      g.programs.forEach((p, k) => {
        const o = document.createElement('option');
        o.value = String(gi * 8 + k);
        o.textContent = p;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.value = String(pi.program);
    sel.onchange = () => {
      editor.setTrackProgram(i, parseInt(sel.value));
      sel.blur();
      flash(t('Klang: {x}', { x: gmName(parseInt(sel.value)) }));
    };
    row(s2, t('Instrument'), popup(sel));
  }
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '16';
  vol.value = String(pi.volume);
  vol.dataset.tip = t('Lautstärke: {n}', { n: pi.volume });
  vol.onchange = () => {
    editor.mutate((s) => (s.tracks[i].playbackInfo.volume = parseInt(vol.value)));
    vol.blur();
  };
  const volWrap = document.createElement('span');
  volWrap.className = 'vol';
  volWrap.innerHTML = icon('speakerSlash', 14);
  volWrap.appendChild(vol);
  volWrap.insertAdjacentHTML('beforeend', icon('speaker', 14));
  row(s2, t('Lautstärke'), volWrap);

  const pan = document.createElement('input');
  pan.type = 'range';
  pan.min = '0';
  pan.max = '16';
  pan.value = String(pi.balance);
  pan.dataset.tip = t('Panorama: links ← → rechts (Doppelklick = Mitte)');
  pan.onchange = () => {
    editor.mutate((s) => (s.tracks[i].playbackInfo.balance = parseInt(pan.value)));
    pan.blur();
  };
  pan.ondblclick = () => editor.mutate((s) => (s.tracks[i].playbackInfo.balance = 8));
  const panWrap = document.createElement('span');
  panWrap.className = 'vol';
  panWrap.innerHTML = '<span class="lr">L</span>';
  panWrap.appendChild(pan);
  panWrap.insertAdjacentHTML('beforeend', '<span class="lr">R</span>');
  row(s2, t('Panorama'), panWrap);

  // tuning
  if (!drums) {
    const s3 = section(t('Stimmung'));
    const cur = st.tuning.slice();
    const sel = document.createElement('select');
    sel.innerHTML = `<option value="">${escapeHtml(t('Eigene'))}</option>`;
    const all: number[][] = [];
    for (const g of tuningPresets()) {
      const og = document.createElement('optgroup');
      og.label = g.group;
      for (const p of g.presets) {
        const o = document.createElement('option');
        o.value = String(all.length);
        all.push(p.tunings);
        o.textContent = `${p.name.replace(/^(Guitar|Bass) /, '').replace(/ Tuning$/, '')} – ${tuningToText(p.tunings).replace(/-?\d/g, '')}`;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    const txt = document.createElement('input');
    txt.id = 'pTuneText';
    txt.className = 'pInput mono';
    txt.spellcheck = false;
    txt.placeholder = 'E A D G B E';
    txt.dataset.tip = t('Töne von tief nach hoch, z.B. D A D G B E');
    txt.value = tuningToText(cur);
    const strings = document.createElement('div');
    strings.className = 'strings';
    const err = document.createElement('div');
    err.className = 'err';
    const keep = document.createElement('input');
    keep.type = 'checkbox';
    keep.className = 'switch';
    const keepLabel = document.createElement('label');
    keepLabel.className = 'irow';
    keepLabel.dataset.tip = t('An: Bünde werden umgerechnet, damit es gleich klingt. Aus: Bundzahlen bleiben gleich.');
    keepLabel.innerHTML = `<span class="lbl">${escapeHtml(t('Klang halten'))}</span>`;
    const keepCtl = document.createElement('span');
    keepCtl.className = 'ctl';
    keepCtl.appendChild(keep);
    const apply = document.createElement('button');
    apply.className = 'btn primary';
    apply.textContent = t('Übernehmen');
    apply.disabled = true;
    keepCtl.insertAdjacentHTML('beforeend', '<span class="spacer"></span>');
    keepCtl.appendChild(apply);
    keepLabel.appendChild(keepCtl);

    const parsed = () => parseTuning(txt.value, cur[cur.length - 1]);
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, k) => v === b[k]);
    const sync = () => {
      const r = parsed();
      if (typeof r === 'string') {
        err.textContent = r;
        apply.disabled = true;
        sel.value = '';
        strings.innerHTML = '';
        return;
      }
      err.textContent = '';
      const idx = all.findIndex((a) => same(a, r));
      sel.value = idx >= 0 ? String(idx) : '';
      apply.disabled = same(r, cur);
      strings.innerHTML = r
        .map((m, k) => `<span class="${k < cur.length && cur[k] !== m ? 'chg' : ''}" data-tip="${escapeHtml(t('Saite {n}', { n: k + 1 }))}"><b>${k + 1}</b>${noteName(m)}</span>`)
        .join('');
    };
    sel.onchange = () => {
      if (sel.value !== '') txt.value = tuningToText(all[parseInt(sel.value)]);
      sync();
      sel.blur();
    };
    txt.oninput = sync;
    txt.onkeydown = (e) => {
      if (e.key === 'Enter' && !apply.disabled) apply.click();
      if (e.key === 'Escape') {
        txt.value = tuningToText(cur);
        sync();
        txt.blur();
      }
    };
    apply.onclick = () => {
      const r = parsed();
      if (typeof r === 'string') return;
      editor.setTuning(i, r, keep.checked, findPresetName(r));
      flash(t('Stimmung: {x}', { x: tuningToText(r) }));
    };
    const presetWrap = popup(sel);
    presetWrap.classList.add('wide');
    row(s3, t('Vorlage'), presetWrap);
    row(s3, t('Töne'), txt);
    s3.append(strings, err, keepLabel);
    sync();
  }

  if (editor.score.tracks.length > 1) {
    const s4 = document.createElement('section');
    s4.className = 'insp bottom';
    const del = document.createElement('button');
    del.className = 'btn danger';
    del.innerHTML = `${icon('trash', 14)}<span>${escapeHtml(t('Spur löschen'))}</span>`;
    del.onclick = async () => {
      if (await confirmAsk(t('Spur „{x}" löschen?', { x: tr.name }))) {
        editor.removeTrack(i);
        refreshChrome();
        render();
      }
    };
    s4.appendChild(del);
    el.appendChild(s4);
  }
}

const KEYS_MAJOR = ['Ces', 'Ges', 'Des', 'As', 'Es', 'B', 'F', 'C', 'G', 'D', 'A', 'E', 'H', 'Fis', 'Cis'];
const KEYS_MINOR = ['as', 'es', 'b', 'f', 'c', 'g', 'd', 'a', 'e', 'h', 'fis', 'cis', 'gis', 'dis', 'ais'];
const KEYS_MAJOR_EN = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const KEYS_MINOR_EN = ['ab', 'eb', 'bb', 'f', 'c', 'g', 'd', 'a', 'e', 'b', 'f#', 'c#', 'g#', 'd#', 'a#'];

const D = alphaTab.model.Direction;
const TARGETS: [number, string][] = [
  [D.TargetSegno, 'Segno 𝄋'],
  [D.TargetSegnoSegno, 'Segno Segno 𝄋𝄋'],
  [D.TargetCoda, 'Coda 𝄌'],
  [D.TargetDoubleCoda, 'Doppel-Coda 𝄌𝄌'],
  [D.TargetFine, 'Fine'],
];
const JUMPS: [number, string][] = [
  [D.JumpDaCapo, 'D.C.'],
  [D.JumpDaCapoAlFine, 'D.C. al Fine'],
  [D.JumpDaCapoAlCoda, 'D.C. al Coda'],
  [D.JumpDaCapoAlDoubleCoda, 'D.C. al Doppel-Coda'],
  [D.JumpDalSegno, 'D.S.'],
  [D.JumpDalSegnoAlFine, 'D.S. al Fine'],
  [D.JumpDalSegnoAlCoda, 'D.S. al Coda'],
  [D.JumpDalSegnoAlDoubleCoda, 'D.S. al Doppel-Coda'],
  [D.JumpDalSegnoSegno, 'D.S.S.'],
  [D.JumpDalSegnoSegnoAlFine, 'D.S.S. al Fine'],
  [D.JumpDalSegnoSegnoAlCoda, 'D.S.S. al Coda'],
  [D.JumpDalSegnoSegnoAlDoubleCoda, 'D.S.S. al Doppel-Coda'],
  [D.JumpDaCoda, 'To Coda'],
  [D.JumpDaDoubleCoda, 'To Doppel-Coda'],
];

function refreshBarPanel(el: HTMLElement) {
  const bi = editor.cursor.bar;
  const mb = editor.masterBar;
  const bar = editor.staff.bars[bi];
  const section = (title: string) => {
    const s = document.createElement('section');
    s.className = 'insp';
    s.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
    el.appendChild(s);
    return s;
  };
  const row = (parent: HTMLElement, label: string, ...controls: (HTMLElement | string)[]) => {
    const r = document.createElement('div');
    r.className = 'irow';
    r.innerHTML = `<span class="lbl">${escapeHtml(label)}</span>`;
    const c = document.createElement('div');
    c.className = 'ctl';
    for (const x of controls) typeof x === 'string' ? c.insertAdjacentHTML('beforeend', x) : c.appendChild(x);
    r.appendChild(c);
    parent.appendChild(r);
    return r;
  };
  const popup = (options: [string, string][], value: string, onChange: (v: string) => void, wide = true) => {
    const sel = document.createElement('select');
    for (const [v, l] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      sel.appendChild(o);
    }
    sel.value = value;
    sel.onchange = () => {
      onChange(sel.value);
      sel.blur();
    };
    const w = document.createElement('span');
    w.className = 'popup' + (wide ? ' wide' : '');
    w.appendChild(sel);
    return w;
  };
  const en = currentLang() === 'en';

  // time + key
  const s1 = section(t('Takt {n}', { n: bi + 1 }));
  const sig = document.createElement('input');
  sig.className = 'pInput small';
  sig.value = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
  sig.dataset.tip = t('z.B. 4/4, 3/4, 7/8');
  sig.onchange = () => {
    const mm = sig.value.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
    if (mm && +mm[1] >= 1 && +mm[1] <= 32 && [1, 2, 4, 8, 16, 32].includes(+mm[2])) editor.setTimeSignature(+mm[1], +mm[2]);
    else {
      flash(t('Ungültige Taktart'));
      sig.value = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
    }
  };
  sig.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') sig.blur();
  };
  row(s1, t('Taktart'), sig);
  const minor = (bar.keySignatureType as number) === 1;
  const keyNames = minor ? (en ? KEYS_MINOR_EN : KEYS_MINOR) : en ? KEYS_MAJOR_EN : KEYS_MAJOR;
  const keyOpts: [string, string][] = keyNames.map((n, k) => [String(k - 7), `${n}${minor ? '-Moll' : '-Dur'}`.replace('-Moll', en ? ' minor' : '-Moll').replace('-Dur', en ? ' major' : '-Dur')]);
  row(
    s1,
    t('Tonart'),
    popup(keyOpts, String(bar.keySignature), (v) => editor.setKeySignature(parseInt(v), minor)),
    popup([['0', t('Dur')], ['1', t('Moll')]], minor ? '1' : '0', (v) => editor.setKeySignature(bar.keySignature as number, v === '1'), false),
  );

  // repeats
  const s2 = section(t('Wiederholung'));
  const start = document.createElement('input');
  start.type = 'checkbox';
  start.className = 'switch';
  start.checked = mb.isRepeatStart;
  start.onchange = () => editor.setRepeatStart(start.checked);
  row(s2, t('Anfang'), start, `<span class="hint">${escapeHtml(t('Taste W'))}</span>`);
  const counts: [string, string][] = [['0', t('Kein Ende')]];
  for (let n = 2; n <= 8; n++) counts.push([String(n), t('{n}× spielen', { n })]);
  row(s2, t('Ende'), popup(counts, String(mb.repeatCount), (v) => editor.setRepeatCount(parseInt(v))));
  const chips = document.createElement('div');
  chips.className = 'chips';
  for (let k = 0; k < 8; k++) {
    const b = document.createElement('button');
    const on = (mb.alternateEndings & (1 << k)) !== 0;
    b.className = 'chip' + (on ? ' on' : '');
    b.textContent = String(k + 1);
    b.dataset.tip = t('{n}. Ende', { n: k + 1 });
    b.onclick = () => editor.setAlternateEndings(mb.alternateEndings ^ (1 << k));
    chips.appendChild(b);
  }
  row(s2, t('Alt. Enden'), chips);

  // section + jumps
  const s3 = section(t('Abschnitt & Sprünge'));
  const name = document.createElement('input');
  name.className = 'pInput';
  name.placeholder = t('z.B. Refrain');
  name.value = mb.section?.text ?? '';
  name.onchange = () => {
    const err = editor.setSection(name.value);
    if (err) flash(err);
  };
  name.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') name.blur();
  };
  row(s3, t('Abschnitt'), name);
  const dirs = Array.from(mb.directions ?? []) as number[];
  const target = TARGETS.find(([d]) => dirs.includes(d))?.[0];
  const jump = JUMPS.find(([d]) => dirs.includes(d))?.[0];
  row(s3, t('Ziel'), popup([['', t('Keins')], ...TARGETS.map(([d, l]) => [String(d), t(l)] as [string, string])], target === undefined ? '' : String(target), (v) => editor.setDirection('target', v === '' ? null : parseInt(v))));
  row(s3, t('Sprung'), popup([['', t('Keiner')], ...JUMPS.map(([d, l]) => [String(d), t(l)] as [string, string])], jump === undefined ? '' : String(jump), (v) => editor.setDirection('jump', v === '' ? null : parseInt(v))));
  s3.insertAdjacentHTML('beforeend', `<p class="hint">${escapeHtml(t('Sprünge stehen am Taktende, Ziele am Taktanfang.'))}</p>`);
}

async function confirmAsk(msg: string): Promise<boolean> {
  const tt = (window as any).__TAURI__;
  if (tt?.dialog?.ask) return await tt.dialog.ask(msg, { title: 'Stagecraft', kind: 'warning', okLabel: t('OK'), cancelLabel: t('Abbrechen') });
  try {
    return window.confirm(msg);
  } catch {
    return true;
  }
}

function switchTrack(i: number) {
  editor.gotoTrack(i);
  refreshChrome();
  if (visibleTracks().join(',') !== renderedKey) render();
  else updateCursor(true);
  updateStatus();
}

titleEl.onchange = () => {
  editor.setTitle(titleEl.value.trim());
  titleEl.blur();
};
titleEl.onkeydown = (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') titleEl.blur();
  e.stopPropagation();
};
tempoEl.onchange = () => {
  const v = Math.max(20, Math.min(400, parseInt(tempoEl.value) || 120));
  editor.mutate((s) => setTempo(s, v));
  tempoEl.blur();
};
tempoEl.onkeydown = (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') tempoEl.blur();
  e.stopPropagation();
};

// popovers
function closePops() {
  document.querySelectorAll('.pop').forEach((p) => p.classList.add('hidden'));
}
document.addEventListener('mousedown', (e) => {
  if (!(e.target as HTMLElement).closest('.pop, #menuBtn, #addTrack, .arBlock')) closePops();
});

$('menuBtn').onclick = () => {
  const m = $('menu');
  const hidden = m.classList.contains('hidden');
  closePops();
  if (hidden) m.classList.remove('hidden');
};
$('menu').onclick = (e) => {
  const act = (e.target as HTMLElement).closest('button')?.dataset.act as Action | undefined;
  closePops();
  if (act) run(act);
};

function menuButton(pop: HTMLElement, ic: IconName | null, label: string, fn: () => void, cls = '') {
  const b = document.createElement('button');
  b.innerHTML = `${ic ? `<i>${icon(ic)}</i>` : '<i></i>'}<span>${escapeHtml(label)}</span>`;
  if (cls) b.className = cls;
  b.onclick = () => {
    closePops();
    fn();
  };
  pop.appendChild(b);
}

function placePop(pop: HTMLElement, x: number, y: number) {
  pop.classList.remove('hidden');
  const r = pop.getBoundingClientRect();
  pop.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  pop.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
}

$('addTrack').onclick = () => {
  const pop = $('trackMenu');
  pop.innerHTML = '';
  // band members first: one entry per person and instrument
  for (const p of bandPeople()) {
    const h = document.createElement('div');
    h.className = 'menuHead';
    h.textContent = p.name;
    pop.appendChild(h);
    for (const ins of p.instruments) {
      const pr = ins.preset;
      menuButton(pop, pr.icon, t(pr.label) + (ins.model ? ` · ${ins.model}` : ''), () => {
        editor.addTrack({ kind: pr.track.kind, label: pr.label, name: `${p.name} – ${t(pr.label)}`, program: pr.track.program, tuning: pr.track.tuning });
        refreshChrome();
        render();
        updateStatus();
      });
    }
  }
  if (pop.childElementCount) pop.appendChild(document.createElement('hr'));
  let lastKind = '';
  for (const p of PRESETS) {
    if (lastKind && p.kind !== lastKind) pop.appendChild(document.createElement('hr'));
    lastKind = p.kind;
    menuButton(pop, KIND_ICON[p.kind], t(p.label), () => {
      editor.addTrack(p);
      refreshChrome();
      render();
      updateStatus();
    });
  }
  closePops();
  const r = $('addTrack').getBoundingClientRect();
  placePop(pop, r.left, r.bottom + 6);
};

function openTrackMenu(i: number, x: number, y: number) {
  const tr = editor.score.tracks[i];
  const pop = $('trackMenu');
  pop.innerHTML = '';
  menuButton(pop, 'pencil', t('Umbenennen …'), async () => {
    const n = await ask(t('Name der Spur'), tr.name);
    if (n) editor.renameTrack(i, n);
  });
  if (!tr.staves[0].isPercussion) {
    menuButton(pop, 'tuningFork', t('Stimmung ändern …'), () => {
      switchTrack(i);
      showPanel(true);
      document.getElementById('pTuneText')?.focus();
    });
  }
  if (editor.score.tracks.length > 1) {
    pop.appendChild(document.createElement('hr'));
    menuButton(pop, 'trash', t('Spur löschen'), () => {
      editor.removeTrack(i);
      refreshChrome();
      render();
    }, 'danger');
  }
  closePops();
  placePop(pop, x, y);
}

$('viewBtn').onclick = () => {
  $('viewBtn').blur();
  setMultiView(true);
};
$('oneBtn').onclick = () => {
  $('oneBtn').blur();
  setMultiView(false);
};

let leftOpen = true;
function showLeft(on: boolean) {
  leftOpen = on;
  document.body.classList.toggle('noLeft', !on);
  $('leftBtn').classList.toggle('on', on);
  render();
}
$('leftBtn').onclick = () => {
  $('leftBtn').blur();
  showLeft(!leftOpen);
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// small prompt dialog (window.prompt is not available in Tauri)
function ask(label: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const ov = $('prompt');
    const input = $<HTMLInputElement>('promptInput');
    $('promptLabel').textContent = label;
    input.value = value;
    ov.classList.remove('hidden');
    input.focus();
    input.select();
    const done = (v: string | null) => {
      ov.classList.add('hidden');
      input.onkeydown = null;
      ov.onmousedown = null;
      resolve(v);
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        done(input.value.trim());
      } else if (e.key === 'Escape') done(null);
    };
    ov.onmousedown = (e) => {
      if (e.target === ov) done(null);
    };
  });
}

// generic modal helper: Esc / click outside closes
function modal(id: string, onClose?: () => void) {
  const dlg = $(id);
  const close = () => {
    dlg.classList.add('hidden');
    document.removeEventListener('keydown', esc, true);
    onClose?.();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', esc, true);
  dlg.onmousedown = (e) => {
    if (e.target === dlg) close();
  };
  dlg.classList.remove('hidden');
  return close;
}

function anyModalOpen() {
  return ['prompt', 'meta', 'prefsDlg', 'aboutDlg', 'onboard', 'progressDlg', 'transDlg', 'verDlg', 'partsDlg'].some((id) => !$(id).classList.contains('hidden'));
}

function toggleHelp(show?: boolean) {
  $('help').classList.toggle('hidden', show === undefined ? undefined : !show);
}
$('help').onclick = () => toggleHelp(false);

// ---------------- files ----------------
let versions: Version[] = [];

function loadScore(score: alphaTab.model.Score, name: string, opts: { path?: string; format?: Format; dirty?: boolean; arr?: Arrangement | null; versions?: Version[] } = {}) {
  stop();
  editor.setScore(score, opts.arr ?? null);
  versions = opts.versions ?? [];
  editor.dirty = !!opts.dirty;
  fileName = name.replace(/\.[^.]+$/, '');
  format = opts.format ?? 'gp5';
  saveHandle = opts.path ?? null;
  refreshChrome();
  render();
  updateStatus();
  closeLibrary();
}

function loadBytes(name: string, bytes: Uint8Array, path?: string): boolean {
  try {
    const ext = (name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
    if (ext === 'tabw') return loadTabw(name, bytes, path);
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, api.settings);
    // .gp5 and .gp files are saved back in place in their own format; everything else becomes .gp5
    const fmt: Format = ext === 'gp' ? 'gp' : 'gp5';
    const inPlace = path && (ext === 'gp5' || ext === 'gp') ? path : undefined;
    loadScore(score, name, { path: inPlace, format: fmt });
    void clearAutosave();
    flash(t('{x} geöffnet', { x: name }));
    void addRecent(
      { title: score.title || fileName, artist: score.artist, fileName: name, path, tracks: score.tracks.map((tr) => tr.name) },
      bytes,
    );
    return true;
  } catch (e: any) {
    flash(t('Datei konnte nicht geöffnet werden: {x}', { x: e?.message ?? String(e) }));
    console.error(e);
    return false;
  }
}

// own format: JSON with the alphaTab score and the arrangement
interface TabwFile { app: 'tabwriter'; version: number; score: unknown; arrangement: Arrangement | null; versions?: Version[] }

function tabwBytes(): Uint8Array {
  const d: TabwFile = { app: 'tabwriter', version: 1, score: JSON.parse(snapshot(editor.score)), arrangement: editor.arr, versions };
  return new TextEncoder().encode(JSON.stringify(d));
}

function loadTabw(name: string, bytes: Uint8Array, path?: string): boolean {
  const d = JSON.parse(new TextDecoder().decode(bytes)) as TabwFile;
  if (d.app !== 'tabwriter' || !d.score) throw new Error(t('Keine Stagecraft-Song-Datei'));
  const score = restore(JSON.stringify(d.score), api.settings);
  loadScore(score, name, { path, format: 'tabw', arr: d.arrangement ?? null });
  versions = d.versions ?? [];
  void clearAutosave();
  flash(t('{x} geöffnet', { x: name }));
  void addRecent({ title: score.title || fileName, artist: score.artist, fileName: name, path, tracks: score.tracks.map((tr) => tr.name) }, bytes);
  if (d.arrangement && !ovOpen) showOverview(true);
  return true;
}

async function openSong() {
  if (editor.dirty && !(await confirmDiscard())) return;
  const f = await pickFile($<HTMLInputElement>('fileInput'));
  if (f) loadBytes(f.name, f.bytes, typeof f.handle === 'string' ? f.handle : undefined);
}

async function openPath(path: string) {
  if (editor.dirty && !(await confirmDiscard())) return;
  try {
    const bytes = await readPath(path);
    loadBytes(path.split(/[\\/]/).pop() ?? path, bytes, path);
  } catch (e: any) {
    flash(t('Datei konnte nicht geöffnet werden: {x}', { x: e?.message ?? String(e) }));
  }
}

async function confirmDiscard(): Promise<boolean> {
  return confirmAsk(t('Ungespeicherte Änderungen verwerfen?'));
}

function baseName() {
  return (editor.score.title || fileName || 'song').replace(/[\\/:*?"<>|]/g, '_');
}

function songBytes(fmt: Format): Uint8Array {
  if (fmt === 'tabw') return tabwBytes();
  return fmt === 'gp' ? new alphaTab.exporter.Gp7Exporter().export(editor.score, api.settings) : writeGp5(editor.score);
}

async function saveSong(saveAs = false) {
  try {
    // with an arrangement the song is saved as .tabw (GP5/GP7 stay available as export)
    const fmt: Format = editor.arr || versions.length ? 'tabw' : saveAs ? 'gp5' : format;
    const type = fmt === 'tabw' ? TABW : fmt === 'gp' ? GP7 : GP5;
    const bytes = songBytes(fmt);
    const reuse = !saveAs && fmt === format;
    const r = await saveFile(`${baseName()}.${type.ext}`, bytes, reuse ? saveHandle ?? undefined : undefined, type);
    if (!r) return false;
    format = fmt;
    if (r.handle) saveHandle = r.handle;
    editor.dirty = false;
    fileName = r.name.replace(/\.[^.]+$/, '');
    updateWindowTitle();
    void clearAutosave();
    flash(t('Gespeichert: {x}', { x: r.name }));
    void addRecent(
      { title: editor.score.title || fileName, artist: editor.score.artist, fileName: r.name, path: r.path, tracks: editor.score.tracks.map((tr) => tr.name) },
      bytes,
    );
    songSaved(editor.score.title || fileName, r.path ?? (typeof r.handle === 'string' ? r.handle : r.name));
    return true;
  } catch (e: any) {
    flash(t('Speichern fehlgeschlagen: {x}', { x: e?.message ?? String(e) }));
    console.error(e);
    return false;
  }
}

async function exportFile(kind: 'gp' | 'gp5' | 'midi') {
  try {
    const bytes = kind === 'midi' ? exportMidi(editor.score, api.settings) : songBytes(kind);
    const type = kind === 'gp' ? GP7 : kind === 'gp5' ? GP5 : MIDI;
    const r = await saveFile(`${baseName()}.${type.ext}`, bytes, undefined, type);
    if (r) flash(t('Exportiert: {x}', { x: r.name }));
  } catch (e: any) {
    flash(t('Export fehlgeschlagen: {x}', { x: e?.message ?? String(e) }));
    console.error(e);
  }
}

async function exportReaper() {
  try {
    const bytes = reaperZip(editor.score, api.settings, baseName());
    const r = await saveFile(`${baseName()} (Reaper).zip`, bytes, undefined, ZIP);
    if (r) flash(t('Exportiert: {x}', { x: r.name }));
  } catch (e: any) {
    flash(t('Export fehlgeschlagen: {x}', { x: e?.message ?? String(e) }));
    console.error(e);
  }
}

async function exportWav() {
  if (!api.isReadyForPlayback) {
    flash(t('Sound lädt noch …'));
    return;
  }
  stop();
  let cancelled = false;
  $('progressLabel').textContent = t('Audio wird erstellt …');
  $('progressBar').style.width = '0%';
  const close = modal('progressDlg', () => (cancelled = true));
  $('progressCancel').onclick = () => close();
  try {
    const bytes = await renderWav(api, (f) => ($('progressBar').style.width = `${Math.round(f * 100)}%`), () => cancelled);
    close();
    if (!bytes) return;
    const r = await saveFile(`${baseName()}.wav`, bytes, undefined, WAV);
    if (r) flash(t('Exportiert: {x}', { x: r.name }));
  } catch (e: any) {
    close();
    flash(t('Export fehlgeschlagen: {x}', { x: e?.message ?? String(e) }));
    console.error(e);
  }
}

async function doPrint() {
  stop();
  if (leadMode) {
    document.getElementById('printArea')?.remove();
    const area = document.createElement('div');
    area.id = 'printArea';
    area.className = 'leadPrint';
    area.innerHTML = $('lead').querySelector('.lsBody')?.innerHTML ?? '';
    area.querySelectorAll('.cur,.play').forEach((x) => x.classList.remove('cur', 'play'));
    document.body.appendChild(area);
    window.addEventListener('afterprint', () => setTimeout(() => area.remove(), 500), { once: true });
    await openPrintDialog();
    return;
  }
  flash(t('Druckansicht wird vorbereitet …'));
  const tracks = multiView ? visibleTracks() : [editor.cursor.track];
  await printScore(editor.score, tracks, api.settings);
}

async function newSong(title?: string) {
  if (editor.dirty && !(await confirmDiscard())) return;
  const sc = createEmptyScore();
  if (title) sc.title = title;
  loadScore(sc, title || t('Neuer Song'));
  void clearAutosave();
}

async function openDemo() {
  if (editor.dirty && !(await confirmDiscard())) return;
  loadScore(buildDemo(api.settings), t('Demo-Song'));
  setMultiView(true);
  void clearAutosave();
}

// ---------------- autosave / recovery ----------------
const AUTOSAVE_KEY = '__autosave';
interface AutosaveData { json: string; arr?: Arrangement | null; versions?: Version[]; fileName: string; path?: string; format: Format; time: number; title: string }
let autosaveTimer = 0;

function scheduleAutosave() {
  updateWindowTitle();
  if (!prefs().autosave || !editor.dirty) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(writeAutosave, 1500);
}

async function writeAutosave() {
  clearTimeout(autosaveTimer);
  if (!prefs().autosave || !editor.dirty) return;
  const data: AutosaveData = {
    json: snapshot(editor.score),
    arr: editor.arr,
    versions,
    fileName,
    path: typeof saveHandle === 'string' ? saveHandle : undefined,
    format,
    time: Date.now(),
    title: editor.score.title || fileName,
  };
  await dbPut(AUTOSAVE_KEY, data);
}

async function clearAutosave() {
  clearTimeout(autosaveTimer);
  await dbDelete(AUTOSAVE_KEY);
}

async function showRecovery() {
  const data = await dbGet<AutosaveData>(AUTOSAVE_KEY);
  const box = $('libRecover');
  if (!data) {
    box.classList.add('hidden');
    return;
  }
  $('libRecoverSub').textContent = `${data.title} · ${relTime(data.time)}`;
  box.classList.remove('hidden');
  $('recRestore').onclick = () => {
    try {
      const score = restore(data.json, api.settings);
      loadScore(score, data.fileName, { path: data.path, format: data.format, dirty: true, arr: data.arr ?? null, versions: data.versions ?? [] });
      flash(t('Wiederhergestellt'));
    } catch (e) {
      console.error(e);
      flash(t('Wiederherstellen fehlgeschlagen'));
    }
  };
  $('recDiscard').onclick = async () => {
    await clearAutosave();
    box.classList.add('hidden');
  };
}

// ---------------- library ----------------
let hasSong = false; // false until something was opened/created (start screen)

/** the Tabwriter part of the start screen; lives in #library or inside the band overview */
const libWrap = () => document.querySelector('.libWrap') as HTMLElement;

function openLibrary() {
  hideBoot();
  closePops();
  if (hasBand()) {
    // Stagecraft: the overview is part of the band shell
    $('library').classList.add('hidden');
    openBand('home');
    return;
  }
  closeBand();
  if ($('libRecover').parentElement !== libWrap()) libWrap().insertBefore($('libRecover'), $('flow'));
  renderLibrary();
  renderFlow();
  void showRecovery();
  $('library').classList.remove('hidden');
  $('libClose').classList.toggle('hidden', !hasSong);
}

function closeLibrary() {
  hasSong = true;
  $('library').classList.add('hidden');
  closeBand();
}

function libraryOpen() {
  return !$('library').classList.contains('hidden') || bandOpen();
}

function renderLibrary() {
  const list = $('libList');
  const items = listRecent();
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = `<div class="libEmpty">${escapeHtml(t('Noch keine Songs. Öffne eine Datei oder starte einen neuen Song.'))}</div>`;
    return;
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'libRow';
    const sub = [it.artist, it.fileName].filter(Boolean).join(' · ');
    row.innerHTML = `
      <div class="libIcon">${escapeHtml((it.fileName.match(/\.([^.]+)$/)?.[1] ?? 'gp').toLowerCase())}</div>
      <div class="libInfo">
        <div class="libTitle">${escapeHtml(it.title || it.fileName)}</div>
        <div class="libSub">${escapeHtml(sub)}</div>
        <div class="libTracks">${escapeHtml(it.tracks.slice(0, 6).join(', '))}${it.tracks.length > 6 ? ' …' : ''}</div>
      </div>
      <div class="libTime">${relTime(it.time)}</div>
      <button class="tbtn small libRemove" data-tip="${escapeHtml(t('Aus der Liste entfernen'))}">${icon('xmark', 12)}</button>`;
    row.onclick = () => openRecent(it);
    (row.querySelector('.libRemove') as HTMLElement).onclick = async (e) => {
      e.stopPropagation();
      await removeRecent(it.id);
      renderLibrary();
    };
    list.appendChild(row);
  }
}

async function openRecent(it: RecentEntry) {
  if (editor.dirty && !(await confirmDiscard())) return;
  let bytes: Uint8Array | null = null;
  if (it.path && isTauri()) {
    try {
      bytes = await readPath(it.path);
    } catch {
      bytes = null;
    }
  }
  if (!bytes) bytes = await cachedBytes(it.id);
  if (!bytes) {
    flash(t('Datei nicht gefunden'));
    return;
  }
  loadBytes(it.fileName, bytes, it.path);
}

$('libNew').onclick = () => newSong();
$('libOpen').onclick = () => openSong();
$('libClose').onclick = () => closeLibrary();
$('libFeedback').onclick = () => run('feedback');
routeExternalLinks();
$('homeBtn').onclick = () => { $('homeBtn').blur(); openLibrary(); };

/** start screen without a band: one entry to set up Stagecraft; Tabwriter works without it */
function renderFlow() {
  const box = $('flow');
  box.innerHTML = '';
  $('libLead').textContent = t('Von der Idee bis zur Bühne');
  const card = document.createElement('button');
  card.className = 'flowSetup';
  card.innerHTML = `<span class="flowIcon">${icon('people', 22)}</span><span><span class="flowTitle">${escapeHtml(t('Band einrichten'))}</span><span class="flowSub">${escapeHtml(t('Mitglieder, Songs, Bühne, Setlists und Gigs – Schritt für Schritt. Tabwriter funktioniert auch ohne.'))}</span></span>${icon('chevronRight', 14)}`;
  card.onclick = () => void bandWizard();
  box.appendChild(card);
}

function openStep(tb: BandTab) {
  closePops();
  openBand(tb);
}

// ---------------- song info (metadata) ----------------
const META_FIELDS: [keyof alphaTab.model.Score, string][] = [
  ['title', 'Titel'],
  ['subTitle', 'Untertitel'],
  ['artist', 'Interpret'],
  ['album', 'Album'],
  ['music', 'Musik'],
  ['words', 'Text'],
  ['tab', 'Tab von'],
  ['copyright', 'Copyright'],
  ['instructions', 'Anweisungen'],
  ['notices', 'Notizen'],
];

function openMeta() {
  closePops();
  const dlg = $('meta');
  const form = dlg.querySelector('form') as HTMLFormElement;
  const grid = $('metaFields');
  grid.innerHTML = '';
  const sc = editor.score as any;
  for (const [key, label] of META_FIELDS) {
    const l = document.createElement('label');
    l.className = 'field' + (key === 'notices' ? ' wide' : '');
    l.textContent = t(label);
    const inp = document.createElement(key === 'notices' ? 'textarea' : 'input') as HTMLInputElement;
    inp.name = key as string;
    inp.value = sc[key] ?? '';
    inp.spellcheck = false;
    l.appendChild(inp);
    grid.appendChild(l);
  }
  const close = modal('meta');
  $('metaCancel').onclick = close;
  form.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    editor.mutate((s) => {
      for (const [key] of META_FIELDS) (s as any)[key] = String(fd.get(key as string) ?? '').trim();
    });
    close();
    flash(t('Song-Infos gespeichert'));
  };
  (grid.querySelector('input') as HTMLInputElement).focus();
}

// ---------------- preferences ----------------
function openPrefs() {
  closePops();
  const form = $('prefsDlg').querySelector('form') as HTMLFormElement;
  const p = prefs();
  const langBefore = p.lang;
  (form.elements.namedItem('lang') as HTMLSelectElement).value = p.lang;
  (form.elements.namedItem('theme') as HTMLSelectElement).value = p.theme;
  (form.elements.namedItem('notation') as HTMLSelectElement).value = p.notation;
  const zoom = form.elements.namedItem('zoom') as HTMLInputElement;
  zoom.value = String(Math.round(p.zoom * 100));
  $('zoomVal').textContent = `${zoom.value} %`;
  (form.elements.namedItem('notePreview') as HTMLInputElement).checked = p.notePreview;
  (form.elements.namedItem('autosave') as HTMLInputElement).checked = p.autosave;
  (form.elements.namedItem('autoReflow') as HTMLInputElement).checked = p.autoReflow;
  (form.elements.namedItem('countIn') as HTMLInputElement).checked = p.countIn;

  const apply = () => {
    setPrefs({
      lang: (form.elements.namedItem('lang') as HTMLSelectElement).value as any,
      theme: (form.elements.namedItem('theme') as HTMLSelectElement).value as any,
      notation: (form.elements.namedItem('notation') as HTMLSelectElement).value as any,
      zoom: parseInt(zoom.value) / 100,
      notePreview: (form.elements.namedItem('notePreview') as HTMLInputElement).checked,
      autosave: (form.elements.namedItem('autosave') as HTMLInputElement).checked,
      autoReflow: (form.elements.namedItem('autoReflow') as HTMLInputElement).checked,
      countIn: (form.elements.namedItem('countIn') as HTMLInputElement).checked,
    });
    editor.autoReflow = prefs().autoReflow;
    applyPractice();
    $('zoomVal').textContent = `${zoom.value} %`;
    refreshLook();
    if (!prefs().autosave) void clearAutosave();
  };
  form.onchange = apply;
  zoom.oninput = () => ($('zoomVal').textContent = `${zoom.value} %`);
  const close = modal('prefsDlg', async () => {
    if (prefs().lang !== langBefore) {
      // texts are set at startup: reload (the song survives via autosave)
      await writeAutosave();
      location.reload();
    }
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    close();
  };
}

// ---------------- transpose ----------------
// ---------------- parts (one PDF per musician) ----------------
function openParts() {
  closePops();
  stop();
  const list = $('partsList');
  list.innerHTML = '';
  editor.score.tracks.forEach((tr, i) => {
    const l = document.createElement('label');
    l.className = 'chk part';
    l.innerHTML = `<input type="checkbox" data-t="${i}" ${i === editor.cursor.track || editor.score.tracks.length <= 4 ? 'checked' : ''}/><span class="ovIcon trackIcon ${trackKind(tr)}">${icon(KIND_ICON[trackKind(tr)] ?? 'music', 12)}</span><span>${escapeHtml(tr.name)}</span>`;
    list.appendChild(l);
  });
  const close = modal('partsDlg');
  $('partsCancel').onclick = close;
  ($('partsDlg').querySelector('form') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const sel = Array.from(list.querySelectorAll<HTMLInputElement>('input:checked')).map((x) => Number(x.dataset.t));
    const lead = ($('partsLead') as HTMLInputElement).checked;
    if (!sel.length && !lead) return;
    close();
    flash(t('Druckansicht wird vorbereitet …'));
    const together = ($('partsTogether') as HTMLInputElement).checked;
    const parts = together ? [{ title: sel.map((i) => editor.score.tracks[i].name).join(' · '), tracks: sel }] : sel.map((i) => ({ title: editor.score.tracks[i].name, tracks: [i] }));
    const html = lead ? renderLeadSheet(editor.score, { perRow: 4, current: -1, playing: -1, title: editor.score.title || fileName, artist: editor.score.artist, tempo: getTempo(editor.score) }) : '';
    await printParts(editor.score, parts, api.settings, lead ? { title: t('Lead Sheet'), html } : undefined);
  };
}

// ---------------- versions ----------------
function openVersions() {
  closePops();
  const list = $('verList');
  const fmtTime = (ms: number) => new Date(ms).toLocaleString(currentLang() === 'de' ? 'de-AT' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let open = '';
  const draw = () => {
    list.innerHTML = '';
    if (!versions.length) {
      list.innerHTML = `<div class="sideEmpty">${escapeHtml(t('Noch keine Versionen. Sichere einen Stand, bevor du größere Änderungen machst.'))}</div>`;
      return;
    }
    const cur = snapshot(editor.score);
    [...versions].reverse().forEach((v) => {
      const row = document.createElement('div');
      row.className = 'verRow' + (open === v.id ? ' open' : '');
      row.innerHTML = `<div class="verHead"><i>${icon('restore', 14)}</i><div class="verText"><b>${escapeHtml(v.comment || t('Ohne Kommentar'))}</b><span>${escapeHtml(fmtTime(v.time))}</span></div></div>`;
      const tools = document.createElement('span');
      tools.className = 'verTools';
      const b = (label: string, fn: () => void, cls = 'btn') => {
        const x = document.createElement('button');
        x.className = cls;
        x.textContent = label;
        x.onclick = (e) => {
          e.stopPropagation();
          fn();
        };
        tools.appendChild(x);
      };
      b(open === v.id ? t('Zuklappen') : t('Vergleichen'), () => {
        open = open === v.id ? '' : v.id;
        draw();
      });
      b(t('Wiederherstellen'), async () => {
        if (!(await confirmAsk(t('Stand „{x}“ wiederherstellen? (⌘Z macht es rückgängig)', { x: v.comment || fmtTime(v.time) })))) return;
        editor.replaceAll(restore(v.score, api.settings), v.arr);
        flash(t('Version wiederhergestellt'));
        closeV();
      });
      b(t('Löschen'), async () => {
        if (!(await confirmAsk(t('Version „{x}“ löschen?', { x: v.comment || fmtTime(v.time) })))) return;
        versions = versions.filter((x) => x !== v);
        editor.dirty = true;
        scheduleAutosave();
        draw();
      }, 'btn danger');
      row.querySelector('.verHead')!.appendChild(tools);
      if (open === v.id) {
        const diff = diffScores(v.score, cur);
        const d = document.createElement('ul');
        d.className = 'verDiff';
        d.innerHTML = diff.length ? diff.map((x) => `<li>${escapeHtml(x)}</li>`).join('') : `<li>${escapeHtml(t('Keine Unterschiede zum aktuellen Stand'))}</li>`;
        const cap = document.createElement('div');
        cap.className = 'hint';
        cap.textContent = t('Seit dieser Version geändert:');
        row.append(cap, d);
      }
      list.appendChild(row);
    });
  };
  const closeV = modal('verDlg');
  $('verClose').onclick = closeV;
  $('verSave').onclick = async () => {
    const c = await ask(t('Was hat sich geändert? (z.B. „Bridge umgeschrieben“)'), '');
    if (c === null) return;
    versions.push({ id: `v${Date.now().toString(36)}`, time: Date.now(), comment: c.trim(), score: snapshot(editor.score), arr: editor.arr ? JSON.parse(JSON.stringify(editor.arr)) : null });
    editor.dirty = true;
    scheduleAutosave();
    updateWindowTitle();
    flash(t('Version gesichert – mit ⌘S in die .tabw-Datei schreiben'));
    draw();
  };
  draw();
}

function openTranspose() {
  closePops();
  if (editor.isDrums) {
    flash(t('Drums lassen sich nicht transponieren'));
    return;
  }
  let semis = 1;
  let scope: 'selection' | 'track' | 'song' = editor.hasSelection ? 'selection' : 'track';
  const val = $('trVal');
  const cap = $('trCap');
  const sync = () => {
    val.textContent = (semis > 0 ? '+' : '') + semis;
    cap.textContent = Math.abs(semis) === 1 ? t('Halbton') : t('Halbtöne');
    $('trScope').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.scope === scope));
  };
  $('trUp').onclick = () => { semis = Math.min(24, semis + 1); if (semis === 0) semis = 1; sync(); };
  $('trDown').onclick = () => { semis = Math.max(-24, semis - 1); if (semis === 0) semis = -1; sync(); };
  $('trScope').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.onclick = () => {
      scope = b.dataset.scope as typeof scope;
      sync();
    };
  });
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === '+') { e.preventDefault(); $('trUp').click(); }
    if (e.key === 'ArrowDown' || e.key === '-') { e.preventDefault(); $('trDown').click(); }
  };
  document.addEventListener('keydown', keys, true);
  const close = modal('transDlg', () => document.removeEventListener('keydown', keys, true));
  $('trCancel').onclick = close;
  ($('transDlg').querySelector('form') as HTMLFormElement).onsubmit = (e) => {
    e.preventDefault();
    close();
    const n = editor.transpose(semis, scope);
    flash(t('{n} Noten um {s} transponiert', { n, s: (semis > 0 ? '+' : '') + semis }));
  };
  sync();
}

// ---------------- about / onboarding ----------------
function openAbout() {
  closePops();
  $('aboutVersion').textContent = t('Version {x}', { x: __APP_VERSION__ });
  const close = modal('aboutDlg');
  $('aboutClose').onclick = close;
}

function openOnboarding() {
  closePops();
  const slides = Array.from($('obSlides').children) as HTMLElement[];
  let i = 0;
  const dots = $('obDots');
  dots.innerHTML = slides.map(() => '<span></span>').join('');
  const show = () => {
    slides.forEach((s, k) => s.classList.toggle('on', k === i));
    Array.from(dots.children).forEach((d, k) => d.classList.toggle('on', k === i));
    $('obBack').style.visibility = i === 0 ? 'hidden' : '';
    $('obNext').textContent = i === slides.length - 1 ? t('Los geht\'s') : t('Weiter');
  };
  const close = modal('onboard', () => setPrefs({ onboarded: true }));
  $('obBack').onclick = () => {
    i = Math.max(0, i - 1);
    show();
  };
  $('obNext').onclick = () => {
    if (i === slides.length - 1) close();
    else {
      i++;
      show();
    }
  };
  $('obDemo').onclick = () => {
    close();
    void openDemo();
  };
  show();
}

// drag & drop
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('drop');
});
document.addEventListener('dragleave', (e) => {
  if (e.target === document.documentElement || !(e as DragEvent).relatedTarget) document.body.classList.remove('drop');
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('drop');
  const f = e.dataTransfer?.files?.[0];
  if (f) {
    if (editor.dirty && !(await confirmDiscard())) return;
    const o = await readDropped(f);
    loadBytes(o.name, o.bytes);
  }
});

// ---------------- playback ----------------
const playBtn = $('play');

api.playerStateChanged.on((e) => {
  playing = e.state === alphaTab.synth.PlayerState.Playing;
  playBtn.innerHTML = icon(playing ? 'pause' : 'play');
  playBtn.dataset.tip = playing ? t('Pausieren') : t('Wiedergabe starten');
  playBtn.classList.toggle('playing', playing);
  cursorEl.style.visibility = playing ? 'hidden' : '';
  document.body.classList.toggle('playing', playing);
  refreshLead();
  if (!playing && playedBeat) {
    jumpToBeat(playedBeat);
    playedBeat = null;
  }
});
api.playedBeatChanged.on((b) => {
  playedBeat = b;
  const pb = b?.voice.bar.index ?? -1;
  if (pb !== ovPlayBar) { ovPlayBar = pb; refreshOverview(); refreshLead(); }
});
api.playerFinished.on(() => {
  playedBeat = null;
  ovPlayBar = -1;
  refreshOverview();
});

function jumpToBeat(b: alphaTab.model.Beat) {
  const ti = b.voice.bar.staff.track.index;
  if (ti !== editor.cursor.track) {
    if (!multiView) return;
    editor.gotoTrack(ti);
    refreshChrome();
  }
  editor.cursor.bar = b.voice.bar.index;
  editor.cursor.beat = Math.max(0, editor.voice.beats.findIndex((x) => x.id === b.id));
  editor.clamp();
  updateCursor(true);
  updateStatus();
}

function togglePlay() {
  if (!api.isReadyForPlayback) {
    flash(t('Sound lädt noch …'));
    return;
  }
  if (playing) {
    api.pause();
    return;
  }
  if (renderPending) {
    setTimeout(togglePlay, 50);
    return;
  }
  let tick = 0;
  try {
    tick = api.tickCache?.getBeatStart(editor.beat) ?? editor.cursorTick();
  } catch {
    tick = editor.cursorTick();
  }
  playedBeat = null;
  if (looping) {
    const r = selectionRange();
    api.playbackRange = r;
    if (r) tick = r.startTick;
  }
  api.tickPosition = tick;
  api.play();
}

function stop() {
  playedBeat = null;
  api.stop();
}

playBtn.onclick = () => {
  playBtn.blur();
  togglePlay();
};
// practice tools
let looping = false;
function applyPractice() {
  api.metronomeVolume = prefs().metronome ? 1 : 0;
  api.countInVolume = prefs().countIn ? 1 : 0;
  api.playbackSpeed = prefs().speed;
  $('metroBtn').classList.toggle('on', prefs().metronome);
  $('loopBtn').classList.toggle('on', looping);
  $('lcdSpeed').textContent = `${Math.round(prefs().speed * 100)} %`;
  $('speedCell').classList.toggle('changed', prefs().speed !== 1);
}

function selectionRange(): alphaTab.synth.PlaybackRange | null {
  if (!editor.hasSelection || !api.tickCache) return null;
  const { start, end } = editor.selection();
  const bs = editor.staff.bars[start.bar].voices[0].beats[start.beat];
  const be = editor.staff.bars[end.bar].voices[0].beats[end.beat];
  try {
    const r = new alphaTab.synth.PlaybackRange();
    r.startTick = api.tickCache.getBeatStart(bs);
    r.endTick = api.tickCache.getBeatStart(be) + be.playbackDuration;
    return r.endTick > r.startTick ? r : null;
  } catch {
    return null;
  }
}

function toggleLoop() {
  looping = !looping;
  api.isLooping = looping;
  api.playbackRange = looping ? selectionRange() : null;
  applyPractice();
  flash(looping ? (editor.hasSelection ? t('Schleife über die Auswahl') : t('Schleife über den ganzen Song')) : t('Schleife aus'));
}

function toggleMetronome() {
  setPrefs({ metronome: !prefs().metronome });
  applyPractice();
  flash(prefs().metronome ? t('Metronom an') : t('Metronom aus'));
}

$('loopBtn').onclick = () => {
  $('loopBtn').blur();
  toggleLoop();
};
$('lcdVoiceCell').onclick = () => toggleVoice();
$('metroBtn').onclick = () => {
  $('metroBtn').blur();
  toggleMetronome();
};
$('speedCell').onclick = () => {
  const pop = $('trackMenu');
  pop.innerHTML = '';
  for (const v of [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25]) {
    menuButton(pop, prefs().speed === v ? 'speed' : null, `${Math.round(v * 100)} %`, () => {
      setPrefs({ speed: v });
      applyPractice();
    });
  }
  closePops();
  const r = $('speedCell').getBoundingClientRect();
  placePop(pop, r.left, r.bottom + 8);
};

$('stopBtn').onclick = () => {
  $('stopBtn').blur();
  stop();
};

// note preview while typing (throttled: alphaTab's audio output dislikes rapid restarts)
let previewTimer = 0;
let lastPreview = 0;
function previewNote(n: alphaTab.model.Note | null | undefined) {
  if (!n || playing || !api.isReadyForPlayback || !prefs().notePreview) return;
  clearTimeout(previewTimer);
  const wait = Math.max(40, 220 - (performance.now() - lastPreview));
  const beatId = n.beat.id;
  const noteIdx = n.beat.notes.indexOf(n);
  previewTimer = window.setTimeout(() => {
    if (playing) return;
    const b = editor.beat;
    const target = b.id === beatId ? b.notes[noteIdx] : editor.noteAtCursor();
    if (!target) return;
    lastPreview = performance.now();
    try {
      api.playNote(target);
    } catch {
      /* ignore */
    }
  }, wait);
}

// click on the sheet moves the cursor
let mouseShift = false;
$('at').addEventListener('mousedown', (e) => (mouseShift = e.shiftKey), true);
api.beatMouseDown.on((b) => {
  if (b.voice.index !== 0) return;
  const sameTrack = b.voice.bar.staff.track.index === editor.cursor.track;
  if (mouseShift && sameTrack) {
    if (!editor.selAnchor) editor.selAnchor = { bar: editor.cursor.bar, beat: editor.cursor.beat };
  } else {
    editor.clearSelection();
  }
  jumpToBeat(b);
});
api.noteMouseDown.on((n) => {
  if (editor.isDrums || n.beat.voice.index !== 0) return;
  if (n.beat.voice.bar.staff.track.index !== editor.cursor.track) return;
  editor.cursor.row = editor.stringCount - n.string;
  updateCursor();
  updateStatus();
});

async function editTimeSig() {
  const mb = editor.masterBar;
  const v = await ask(t('Taktart (z.B. 4/4, 3/4, 7/8)'), `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`);
  const mm = v?.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (mm) {
    const n = parseInt(mm[1]);
    const d = parseInt(mm[2]);
    if (n >= 1 && n <= 32 && [1, 2, 4, 8, 16, 32].includes(d)) editor.setTimeSignature(n, d);
    else flash(t('Ungültige Taktart'));
  }
}
$('lcdSigCell').onclick = () => void editTimeSig();

// ---------------- actions (shared by keyboard, ⋯ menu and the native menu) ----------------
const lastRun = new Map<Action, number>();

function inTextField() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function doCopy() { flash(editor.copy()); }
function doCut() { flash(editor.cut()); }
function doPaste(insertBars = false) {
  const err = editor.paste(insertBars);
  if (err) flash(err);
}

function run(a: Action) {
  // the native menu and the keyboard handler may both fire for the same shortcut
  const now = performance.now();
  if (now - (lastRun.get(a) ?? 0) < 250) return;
  lastRun.set(a, now);
  switch (a) {
    case 'about': openAbout(); break;
    case 'prefs': openPrefs(); break;
    case 'feedback': void openFeedback(bandOpen() ? t('Band') : libraryOpen() ? t('Start') : t('Editor'), flash); break;
    case 'updates': void runUpdateCheck(true); break;
    case 'quit': void closeWindow(); break;
    case 'new': void newSong(); break;
    case 'open': void openSong(); break;
    case 'library': if (bandOpen()) closeBand(); openLibrary(); break;
    case 'save': void saveSong(); break;
    case 'saveas': void saveSong(true); break;
    case 'export-gp': void exportFile('gp'); break;
    case 'export-gp5': void exportFile('gp5'); break;
    case 'export-midi': void exportFile('midi'); break;
    case 'export-wav': void exportWav(); break;
    case 'export-reaper': void exportReaper(); break;
    case 'print': void doPrint(); break;
    case 'meta': openMeta(); break;
    case 'versions': openVersions(); break;
    case 'fretboard': showFretboard(!fbOpen); break;
    case 'midi-in': void toggleMidiInput(); break;
    case 'print-parts': openParts(); break;
    case 'undo':
      if (inTextField()) document.execCommand('undo');
      else editor.undo();
      break;
    case 'redo':
      if (inTextField()) document.execCommand('redo');
      else editor.redo();
      break;
    case 'paste-insert': if (!inTextField()) doPaste(true); break;
    case 'select-all':
      if (inTextField()) (document.activeElement as HTMLInputElement).select?.();
      else { editor.selectAll(); moved(); }
      break;
    case 'multi': setMultiView(!multiView); break;
    case 'panel': showPanel(!panelOpen); break;
    case 'sidebar': showLeft(!leftOpen); break;
    case 'overview': showOverview(!ovOpen); break;
    case 'zoom-in': setZoom(prefs().zoom + 0.1); break;
    case 'zoom-out': setZoom(prefs().zoom - 0.1); break;
    case 'zoom-reset': setZoom(1); break;
    case 'play': togglePlay(); break;
    case 'stop': stop(); break;
    case 'loop': toggleLoop(); break;
    case 'metronome': toggleMetronome(); break;
    case 'transpose': openTranspose(); break;
    case 'help': toggleHelp(true); break;
    case 'onboarding': openOnboarding(); break;
    case 'demo': void openDemo(); break;
    case 'lead': setLeadMode(!leadMode); break;
  }
}

// clipboard events (native Edit menu in the desktop app, and the browser's own menu)
let lastClip = 0;
function clipGuard() {
  const now = performance.now();
  if (now - lastClip < 250) return false;
  lastClip = now;
  return true;
}
document.addEventListener('copy', (e) => {
  if (inTextField() || libraryOpen() || anyModalOpen()) return;
  e.preventDefault();
  if (clipGuard()) doCopy();
});
document.addEventListener('cut', (e) => {
  if (inTextField() || libraryOpen() || anyModalOpen()) return;
  e.preventDefault();
  if (clipGuard()) doCut();
});
document.addEventListener('paste', (e) => {
  if (inTextField() || libraryOpen() || anyModalOpen()) return;
  e.preventDefault();
  if (clipGuard()) doPaste(false);
});

// ---------------- keyboard ----------------
let lastSectionBar = -1;
function moved() {
  updateCursor();
  updateStatus();
  if (panelTab === 'bar' && panelBar !== editor.cursor.bar && panelOpen) refreshPanel();
  if (lastSectionBar !== editor.cursor.bar) {
    lastSectionBar = editor.cursor.bar;
    refreshSections();
  }
  refreshOverview();
  refreshLead();
  refreshFretboard();
}

window.addEventListener('keydown', async (e) => {
  if (anyModalOpen()) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;
  if (['Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(k)) return;

  if (bandOpen()) {
    if (mod && e.shiftKey && k.toLowerCase() === 'l') { e.preventDefault(); closeBand(); openLibrary(); return; }
    if (mod && /^[1-5]$/.test(k)) { e.preventDefault(); openBand(STEPS[Number(k) - 1].tab); return; }
    if (k === 'Escape' && !inTextField() && hasSong && !document.querySelector('.wizOverlay')) { e.preventDefault(); closeBand(); }
    return;
  }
  if (libraryOpen()) {
    const lk0 = k.toLowerCase();
    if (k === 'Escape' && hasSong) { e.preventDefault(); closeLibrary(); }
    else if (mod && lk0 === 'n') { e.preventDefault(); run('new'); }
    else if (mod && lk0 === 'o') { e.preventDefault(); run('open'); }
    else if (mod && lk0 === ',') { e.preventDefault(); run('prefs'); }
    else if (mod && /^[1-5]$/.test(k)) { e.preventDefault(); openStep(STEPS[Number(k) - 1].tab); }
    else if (mod && e.shiftKey && lk0 === 'l' && hasSong) { e.preventDefault(); closeLibrary(); }
    return;
  }
  if (!$('help').classList.contains('hidden')) {
    toggleHelp(false);
    e.preventDefault();
    return;
  }
  if (inTextField()) return;

  // --- app shortcuts ---
  if (mod) {
    const lk = k.toLowerCase();
    const map: Record<string, Action> = {
      s: e.shiftKey ? 'saveas' : 'save', l: e.shiftKey ? 'library' : 'loop', k: 'metronome', t: 'transpose', o: 'open', n: 'new', e: e.shiftKey ? 'lead' : 'multi', i: 'panel', b: 'overview',
      p: e.shiftKey ? 'print-parts' : 'print', j: 'fretboard', ',': 'prefs', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset', y: 'redo',
    };
    if (lk === 's' && e.ctrlKey && (e.metaKey || e.altKey)) { e.preventDefault(); run('sidebar'); return; }
    if ((lk === 's' || e.code === 'KeyS') && e.altKey && e.metaKey) { e.preventDefault(); run('versions'); return; }
    if (/^[1-5]$/.test(k) && !e.shiftKey && !e.altKey) { e.preventDefault(); openStep(STEPS[Number(k) - 1].tab); return; }
    if (lk === 'z') { e.preventDefault(); run(e.shiftKey ? 'redo' : 'undo'); return; }
    if (lk === 'c') { e.preventDefault(); if (clipGuard()) doCopy(); return; }
    if (lk === 'x') { e.preventDefault(); if (clipGuard()) doCut(); return; }
    if (lk === 'v') {
      e.preventDefault();
      if (e.shiftKey) run('paste-insert');
      else if (clipGuard()) doPaste(false);
      return;
    }
    if (lk === 'a') { e.preventDefault(); run('select-all'); return; }
    if (map[lk]) { e.preventDefault(); run(map[lk]); return; }
    if (lk === 'q' || lk === 'w' || lk === 'r') return; // leave to the OS / browser
    editor.clearSelection();
    if (k === 'ArrowLeft') { e.preventDefault(); editor.prevBar(); moved(); return; }
    if (k === 'ArrowRight') { e.preventDefault(); editor.nextBar(); moved(); return; }
    if (k === 'ArrowUp') { e.preventDefault(); editor.home(); moved(); return; }
    if (k === 'ArrowDown') { e.preventDefault(); editor.end(); moved(); return; }
    return;
  }

  closePops();

  // --- selection ---
  if (e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight')) {
    e.preventDefault();
    if (k === 'ArrowLeft') e.altKey ? editor.selPrevBar() : editor.selPrev();
    else e.altKey ? editor.selNextBar() : editor.selNext();
    moved();
    return;
  }
  if (editor.hasSelection && e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
    e.preventDefault();
    editor.transpose(k === 'ArrowUp' ? 1 : -1, 'selection');
    return;
  }
  if (editor.hasSelection) {
    if (k === 'Backspace' || k === 'Delete') {
      e.preventDefault();
      editor.deleteSelection();
      return;
    }
    if (k === 'Escape') {
      e.preventDefault();
      editor.clearSelection();
      drawSelection();
      return;
    }
    editor.clearSelection();
    drawSelection();
  }

  let handled = true;
  switch (k) {
    case 'ArrowLeft':
      e.altKey ? editor.prevBar() : editor.prev();
      moved();
      break;
    case 'ArrowRight':
      e.altKey ? editor.nextBar() : editor.next();
      moved();
      break;
    case 'ArrowUp':
      if (e.shiftKey) previewNote(editor.transposeNote(1));
      else { editor.moveRow(-1); moved(); }
      break;
    case 'ArrowDown':
      if (e.shiftKey) previewNote(editor.transposeNote(-1));
      else { editor.moveRow(1); moved(); }
      break;
    case 'Home': editor.home(); moved(); break;
    case 'End': editor.end(); moved(); break;
    case 'Tab': {
      const n = editor.score.tracks.length;
      switchTrack((editor.cursor.track + (e.shiftKey ? n - 1 : 1)) % n);
      break;
    }
    case ' ': togglePlay(); break;
    case 'Escape': stop(); break;
    case '+': case '=': editor.changeDuration(1); break;
    case '-': case '_': editor.changeDuration(-1); break;
    case '.': case ':': editor.toggleDot(); break;
    case 'Backspace': case 'Delete':
      e.shiftKey ? editor.deleteBeat() : editor.deleteNote();
      break;
    case 'Enter':
      if (editor.isDrums) previewNote(editor.toggleDrum());
      else handled = false;
      break;
    case '?': toggleHelp(); break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); return; }

  if (/^[0-9]$/.test(k)) {
    e.preventDefault();
    previewNote(editor.typeDigit(parseInt(k)));
    return;
  }

  handled = true;
  switch (k.toLowerCase()) {
    case 'r': editor.toggleRest(); break;
    case 't': editor.toggleTriplet(); break;
    case 'i': editor.insertBeat(); break;
    case 'l': if (e.shiftKey) { e.preventDefault(); openEntry('lyric'); } else editor.toggleTie(); break;
    case 'h': editor.toggleHammer(); break;
    case 's': editor.toggleSlide(); break;
    case 'v': editor.toggleVibrato(); break;
    case 'u': editor.toggleBend(); break;
    case 'p': editor.togglePalmMute(); break;
    case 'g': editor.toggleGhost(); break;
    case 'a': editor.toggleAccent(); break;
    case 'n': editor.toggleLetRing(); break;
    case 'x':
      if (editor.isDrums) previewNote(editor.toggleDrum());
      else editor.toggleDead();
      break;
    case 'b': e.shiftKey ? editor.deleteBar() : editor.insertBar(); break;
    case 'w': e.shiftKey ? editor.toggleRepeatEnd() : editor.toggleRepeatStart(); break;
    case 'm': e.preventDefault(); void editTimeSig(); break;
    case 'q': e.preventDefault(); toggleVoice(); break;
    case 'c': e.preventDefault(); openEntry('chord'); break;
    default: handled = false;
  }
  if (handled) e.preventDefault();
});

window.addEventListener('beforeunload', (e) => {
  if (editor.dirty) {
    void writeAutosave();
    if (!isDesktop()) e.preventDefault();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void writeAutosave();
});
window.addEventListener('resize', () => setTimeout(() => updateCursor(), 300));

// ---------------- desktop integration ----------------
async function runUpdateCheck(manual: boolean) {
  const u = await checkUpdate();
  if (!u) {
    if (manual) flash(t('Keine Updates gefunden'));
    return;
  }
  notice(t('Version {x} ist verfügbar.', { x: u.version }), [
    {
      label: t('Jetzt aktualisieren'),
      primary: true,
      fn: async () => {
        if (editor.dirty && !(await saveSong())) return;
        flash(t('Update wird geladen …'));
        await u.install((f) => flash(t('Update wird geladen … {n} %', { n: Math.round(f * 100) })));
      },
    },
    { label: t('Später'), fn: () => {} },
  ]);
}

if (isDesktop()) {
  void setupMenu(run);
  guardClose(
    () => editor.dirty,
    () => confirmAsk(t('Ungespeicherte Änderungen verwerfen und schließen?')),
    () => clearAutosave(),
  );
  void onOpenFiles((paths) => {
    if (paths[0]) void openPath(paths[0]);
  });
  setTimeout(() => void runUpdateCheck(false), 4000);
} else {
  // web: offline support + browser check
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    import('virtual:pwa-register').then(({ registerSW }) => {
      const update = registerSW({
        onNeedRefresh() {
          notice(t('Eine neue Version ist verfügbar.'), [
            { label: t('Neu laden'), primary: true, fn: async () => { await writeAutosave(); update(true); } },
            { label: t('Später'), fn: () => {} },
          ]);
        },
        onOfflineReady() {
          flash(t('Stagecraft funktioniert jetzt auch offline'));
        },
      });
    }).catch(() => {});
  }
  const issue = checkBrowser();
  if (issue) notice(issue);
}

// expose for debugging / tests
(window as any).app = { api, editor, loadBytes, run };

refreshChrome();
render();
updateStatus();
applyPractice();
openLibrary();
if (!prefs().onboarded) setTimeout(openOnboarding, 300);
