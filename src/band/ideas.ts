// Ideas inside a song: riffs (from the editor), voice memos / audio files and text ideas.
// Audio is kept in IndexedDB.
import { t } from '../i18n';
import { icon, type IconName } from '../icons';
import { dbGet, dbPut, dbDelete } from '../library';
import { el, iconBtn, input, esc, save } from './dom';
import { card, popMenu, hint, type MenuItem } from './kit';
import { type Band, type Idea, type IdeaKind, newIdea, fmtDur } from './model';
import type { Clip } from '../editor';

export interface IdeaHost {
  snippet(): Clip | null;
  useClip(c: Clip): void;
  flash(msg: string): void;
  confirm(msg: string): Promise<boolean>;
}

let recorder: MediaRecorder | null = null;
let recSong = '';
let recStart = 0;
let recTimer = 0;
let target = ''; // song the next idea belongs to

const KIND_ICON: Record<IdeaKind, IconName> = { riff: 'guitar', memo: 'mic', text: 'textInfo' };
export const audioKey = (id: string) => `memo:${id}`;

function addIdea(b: Band, it: Idea) {
  it.song = target;
  b.ideas.unshift(it);
  save();
}

/** the ways to add an idea to a song */
export function ideaAddItems(b: Band, song: string, host: IdeaHost, rerender: () => void): MenuItem[] {
  target = song;
  const free = b.ideas.filter((x) => !x.song || !b.songs.some((s) => s.id === x.song));
  return [
    {
      icon: 'guitar', label: t('Riff aus der Auswahl im Editor'), fn: () => {
        const c = host.snippet();
        if (!c) return host.flash(t('Erst im Editor etwas markieren (⇧←/→)'));
        const it = newIdea('riff', t('Riff {n}', { n: b.ideas.filter((x) => x.kind === 'riff' && x.song === song).length + 1 }));
        it.clip = c;
        it.preview = asciiTab(c);
        try {
          const tempo = JSON.parse(c.json).masterbars?.[0]?.tempoautomations?.[0]?.value;
          if (tempo) it.bpm = Math.round(tempo);
        } catch {
          /* ignore */
        }
        addIdea(b, it);
        rerender();
      },
    },
    { icon: 'mic', label: t('Sprachmemo aufnehmen'), fn: () => void startRecording(b, rerender, host) },
    { icon: 'waveform', label: t('Audio importieren …'), fn: () => importAudio(b, rerender, host) },
    { icon: 'textInfo', label: t('Text-Idee'), fn: () => { addIdea(b, newIdea('text', t('Neue Idee'))); rerender(); } },
    ...(free.length ? ['sep' as const, ...free.slice(0, 12).map((x): MenuItem => ({ icon: KIND_ICON[x.kind], label: t('Zuordnen: {x}', { x: x.title || t('Ohne Titel') }), fn: () => { x.song = song; save(); rerender(); } }))] : []),
  ];
}

/** card "Ideen & Memos" in the song detail */
export function renderSongIdeas(parent: HTMLElement, b: Band, song: string, host: IdeaHost, rerender: () => void) {
  const c = card(parent, t('Ideen & Memos'), { addTip: t('Riff, Sprachmemo, Audio oder Text'), add: (a) => popMenu(a, ideaAddItems(b, song, host, rerender)) });
  if (recorder && recSong === song) {
    const bar = el('div', 'recBar', `<span class="dot"></span><span>${esc(t('Aufnahme läuft'))}</span><span class="recTime">0:00</span>`);
    const stop = el('button', 'btn small', `${icon('stop', 12)}<span>${esc(t('Beenden'))}</span>`);
    stop.onclick = () => stopRecording();
    bar.appendChild(stop);
    c.appendChild(bar);
    recTick();
  }
  const list = b.ideas.filter((x) => x.song === song);
  if (!list.length && !(recorder && recSong === song)) hint(c, t('Riffs aus dem Editor, Sprachmemos und Textzeilen zu diesem Song.'));
  for (const it of list) c.appendChild(ideaRow(b, it, host, rerender));
}

function ideaRow(b: Band, it: Idea, host: IdeaHost, rerender: () => void): HTMLElement {
  const r = el('div', 'ideaRow');
  const top = el('div', 'ideaTop');
  top.appendChild(el('span', 'kindIc', icon(KIND_ICON[it.kind], 13)));
  top.appendChild(input(it, 'title', t('Titel'), undefined, 'pInput name'));
  const meta = [it.key, it.bpm ? `${it.bpm} bpm` : '', it.audio?.duration ? fmtDur(it.audio.duration) : ''].filter(Boolean).join(' · ');
  top.appendChild(el('span', 'meta', esc(meta)));
  if (it.kind === 'riff' && it.clip) top.appendChild(iconBtn('pencil', t('In den Editor kopieren'), () => host.useClip(it.clip!), 'tb'));
  top.appendChild(iconBtn('xmark', t('Idee löschen'), async () => {
    if (!(await host.confirm(t('{x} löschen?', { x: it.title || t('Idee') })))) return;
    if (it.audio) await dbDelete(audioKey(it.id));
    b.ideas = b.ideas.filter((x) => x !== it);
    save();
    rerender();
  }, 'tb'));
  r.appendChild(top);
  if (it.kind === 'riff' && it.clip) r.appendChild(el('pre', 'asciiTab', esc(it.preview || asciiTab(it.clip))));
  if (it.audio) {
    const au = el('audio');
    au.controls = true;
    r.appendChild(au);
    void dbGet<Blob>(audioKey(it.id)).then((blob) => {
      if (blob) au.src = URL.createObjectURL(blob);
      else r.appendChild(el('span', 'hint', esc(t('Audio nicht gefunden (nur auf dem Gerät gespeichert, wo es aufgenommen wurde)'))));
    });
  }
  if (it.kind === 'text') {
    const ta = el('textarea', 'pInput notes small');
    ta.placeholder = t('Textzeilen, Reime, Titel-Ideen …');
    ta.value = it.text;
    ta.oninput = () => {
      it.text = ta.value;
      save();
    };
    r.appendChild(ta);
  }
  return r;
}

// ---------------- audio ----------------

async function startRecording(b: Band, rerender: () => void, host: IdeaHost) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      clearInterval(recTimer);
      const dur = (Date.now() - recStart) / 1000;
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
      recorder = null;
      const it = newIdea('memo', t('Memo {d}', { d: new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }));
      it.audio = { name: t('Aufnahme'), type: blob.type, duration: Math.round(dur) };
      await dbPut(audioKey(it.id), blob);
      target = recSong;
      addIdea(b, it);
      rerender();
    };
    recorder = r;
    recSong = target;
    recStart = Date.now();
    r.start();
    rerender();
  } catch (e: any) {
    recorder = null;
    host.flash(t('Mikrofon nicht verfügbar: {x}', { x: e?.message ?? String(e) }));
  }
}

function stopRecording() {
  recorder?.stop();
}

function recTick() {
  clearInterval(recTimer);
  recTimer = window.setInterval(() => {
    const x = document.querySelector('#band .recTime');
    if (x) x.textContent = fmtDur((Date.now() - recStart) / 1000);
  }, 250);
}

function importAudio(b: Band, rerender: () => void, host: IdeaHost) {
  const inp = el('input');
  inp.type = 'file';
  inp.accept = 'audio/*,.m4a,.mp3,.wav,.aiff,.caf';
  inp.multiple = true;
  inp.onchange = async () => {
    for (const f of Array.from(inp.files ?? [])) {
      const it = newIdea('memo', f.name.replace(/\.[^.]+$/, ''));
      it.audio = { name: f.name, type: f.type, duration: await audioDuration(f) };
      await dbPut(audioKey(it.id), f);
      addIdea(b, it);
    }
    rerender();
    host.flash(t('Audio importiert'));
  };
  inp.click();
}

export function audioDuration(f: Blob): Promise<number> {
  return new Promise((res) => {
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      res(isFinite(a.duration) ? Math.round(a.duration) : 0);
      URL.revokeObjectURL(a.src);
    };
    a.onerror = () => res(0);
    a.src = URL.createObjectURL(f);
  });
}

// ---------------- helpers ----------------

/** rough German/English syllable count */
export function syllables(line: string): number {
  const words = line.toLowerCase().match(/[a-zäöüß']+/g) ?? [];
  let n = 0;
  for (const w of words) n += Math.max(1, (w.match(/(ei|ie|eu|äu|au|ai|ee|oo|aa|[aeiouyäöü])+/g) ?? []).length);
  return n;
}

/** plain-text tab of a clip (stringed) or a short summary (drums) */
export function asciiTab(c: Clip): string {
  try {
    const o = JSON.parse(c.json);
    const st = o.tracks[0].staves[0];
    if (c.drums) return t('Drum-Pattern · {n} Takte', { n: st.bars.length });
    const tuning: number[] = st.stringtuning?.tunings ?? [];
    const n = tuning.length || 6;
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const lines = Array.from({ length: n }, (_, i) => (tuning[i] !== undefined ? names[tuning[i] % 12] : '?').padEnd(2) + '|');
    st.bars.forEach((bar: any, bi: number) => {
      const beats = bar.voices?.[0]?.beats ?? [];
      beats.forEach((bt: any, k: number) => {
        if (bi === 0 && k < c.start.beat && !c.fullBars) return;
        if (bi === st.bars.length - 1 && k > c.end.beat && !c.fullBars) return;
        const col = Array(n).fill('-');
        for (const note of bt.notes ?? []) {
          const row = n - (note.string ?? 1);
          if (row >= 0 && row < n) col[row] = String(note.fret ?? 0);
        }
        const w = Math.max(...col.map((x: string) => x.length)) + 1;
        for (let i = 0; i < n; i++) lines[i] += col[i].padEnd(w, '-');
      });
      for (let i = 0; i < n; i++) lines[i] += '|';
    });
    return lines.join('\n');
  } catch {
    return '';
  }
}

/** audio blobs for the band file export */
/** ids of entries that carry a file blob (memo:<id> in IndexedDB) */
export function fileIds(b: Band): string[] {
  return [...b.ideas.filter((x) => x.audio), ...b.songs.flatMap((s) => s.media.filter((m) => m.audio)), ...b.gigs.flatMap((g) => g.docs.filter((d) => d.file))].map((x) => x.id);
}

export async function collectAudio(b: Band): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const withAudio = [...b.ideas.filter((x) => x.audio), ...b.songs.flatMap((s) => s.media.filter((m) => m.audio)), ...b.gigs.flatMap((g) => g.docs.filter((d) => d.file))];
  for (const it of withAudio) {
    const blob = await dbGet<Blob>(audioKey(it.id));
    if (!blob) continue;
    out[it.id] = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(blob);
    });
  }
  return out;
}

export async function restoreAudio(audio: Record<string, string> | undefined) {
  if (!audio) return;
  for (const [id, url] of Object.entries(audio)) {
    const blob = await (await fetch(url)).blob();
    await dbPut(audioKey(id), blob);
  }
}
