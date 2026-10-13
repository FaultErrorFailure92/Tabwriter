// Idea library: riffs (from the editor), voice memos / audio files and text ideas,
// with tags, key, tempo and mood. Audio is kept in IndexedDB.
import { t } from '../i18n';
import { icon, type IconName } from '../icons';
import { dbGet, dbPut, dbDelete } from '../library';
import { el, input, select, esc, save } from './dom';
import { card, row, columns, detailHead, searchField, type MenuItem } from './kit';
import { type Band, type Idea, type IdeaKind, newIdea, newSong, fmtDur } from './model';
import type { Clip } from '../editor';

export interface IdeaHost {
  snippet(): Clip | null;
  useClip(c: Clip): void;
  flash(msg: string): void;
  confirm(msg: string): Promise<boolean>;
  openSongs(id: string): void;
}

let sel = '';
let query = '';
let tagFilter = '';
let recorder: MediaRecorder | null = null;
let recStart = 0;
let recTimer = 0;

const KIND_ICON: Record<IdeaKind, IconName> = { riff: 'guitar', memo: 'mic', text: 'textInfo' };
const KIND_LABEL: Record<IdeaKind, string> = { riff: 'Riff', memo: 'Sprachmemo', text: 'Text' };
export const audioKey = (id: string) => `memo:${id}`;

/** the ways to add an idea (shown in the "+ Idee" menu) */
export function ideaAddItems(b: Band, host: IdeaHost, rerender: () => void): MenuItem[] {
  return [
    {
      icon: 'guitar', label: t('Riff aus der Auswahl im Editor'), fn: () => {
        const c = host.snippet();
        if (!c) return host.flash(t('Erst im Editor etwas markieren (⇧←/→)'));
        const it = newIdea('riff', t('Riff {n}', { n: b.ideas.filter((x) => x.kind === 'riff').length + 1 }));
        it.clip = c;
        it.preview = asciiTab(c);
        try {
          const tempo = JSON.parse(c.json).masterbars?.[0]?.tempoautomations?.[0]?.value;
          if (tempo) it.bpm = Math.round(tempo);
        } catch {
          /* ignore */
        }
        b.ideas.unshift(it);
        sel = it.id;
        save();
        rerender();
      },
    },
    { icon: 'mic', label: t('Sprachmemo aufnehmen'), fn: () => void startRecording(b, rerender, host) },
    { icon: 'waveform', label: t('Audio importieren …'), fn: () => importAudio(b, rerender, host) },
    {
      icon: 'textInfo', label: t('Text-Idee'), fn: () => {
        const it = newIdea('text', t('Neue Idee'));
        b.ideas.unshift(it);
        sel = it.id;
        save();
        rerender();
        (document.querySelector('#band .dHead .bandTitle') as HTMLInputElement | null)?.select();
      },
    },
  ];
}

export function renderIdeas(main: HTMLElement, b: Band, host: IdeaHost, rerender: () => void) {
  if (recorder) {
    const bar = el('div', 'recBar', `<span class="dot"></span><span>${esc(t('Aufnahme läuft'))}</span><span class="recTime">0:00</span>`);
    const stop = el('button', 'btn', `${icon('stop', 12)}<span>${esc(t('Beenden'))}</span>`);
    stop.onclick = () => stopRecording();
    bar.appendChild(stop);
    main.appendChild(bar);
    recTick();
  }
  if (!b.ideas.length) {
    main.appendChild(el('div', 'bandEmpty', esc(t('Noch keine Ideen.'))));
    return;
  }
  const ql = query.trim().toLowerCase();
  const shown = b.ideas.filter((x) => (!tagFilter || x.tags.includes(tagFilter)) && (!ql || [x.title, x.key, x.mood, x.note, x.text, x.tags.join(' ')].join(' ').toLowerCase().includes(ql)));
  if (!shown.some((x) => x.id === sel)) sel = shown[0]?.id ?? '';
  const split = el('div', 'bandSplit');
  const list = el('div', 'bandList');
  list.appendChild(searchField(query, (v) => {
    query = v;
    rerender();
  }, 'ideaSearch'));
  const tags = [...new Set(b.ideas.flatMap((x) => x.tags))].sort();
  if (tags.length) {
    const tb = el('div', 'phaseBar');
    for (const tg of ['', ...tags]) {
      const c = el('button', 'phaseChip' + (tagFilter === tg ? ' on' : ''), esc(tg || t('Alle')));
      c.onclick = () => {
        tagFilter = tg;
        rerender();
      };
      tb.appendChild(c);
    }
    list.appendChild(tb);
  }
  for (const it of shown) {
    const meta = [t(KIND_LABEL[it.kind]), it.key, it.bpm ? `${it.bpm} bpm` : '', it.mood].filter(Boolean).join(' · ');
    const r = el('div', 'bandItem' + (it.id === sel ? ' on' : ''), `<span class="t"><span class="kindIc">${icon(KIND_ICON[it.kind], 12)}</span>${esc(it.title || t('Ohne Titel'))}</span><span class="s">${esc(meta)}</span>`);
    r.onclick = () => {
      sel = it.id;
      rerender();
    };
    list.appendChild(r);
  }
  if (!shown.length) list.appendChild(el('div', 'bandEmpty small', esc(t('Nichts gefunden.'))));
  split.appendChild(list);
  const it = b.ideas.find((x) => x.id === sel);
  if (it) split.appendChild(detail(b, it, host, rerender));
  main.appendChild(split);
}

function detail(b: Band, it: Idea, host: IdeaHost, rerender: () => void): HTMLElement {
  const d = el('div', 'bandDetail');
  const makeSong = () => {
    const s = newSong(it.title);
    s.phase = 'idea';
    s.key = it.key;
    s.bpm = it.bpm;
    s.notes = [it.note, it.text].filter(Boolean).join('\n');
    b.songs.push(s);
    it.song = s.id;
    save();
    host.openSongs(s.id);
  };
  let action: HTMLElement | undefined;
  if (it.kind === 'riff' && it.clip) {
    action = el('button', 'btn', `${icon('pencil', 13)}<span>${esc(t('In den Editor kopieren'))}</span>`);
    action.onclick = () => host.useClip(it.clip!);
  }
  detailHead(d, {
    lead: el('span', 'kindBig', icon(KIND_ICON[it.kind], 16)),
    title: input(it, 'title', t('Titel'), () => {
      const x = document.querySelector('#band .bandItem.on .t');
      if (x) x.lastChild!.textContent = it.title || t('Ohne Titel');
    }, 'bandTitle'),
    action,
    menu: () => [
      ...(!it.song ? [{ icon: 'music' as IconName, label: t('Zu Song machen'), hint: t('Phase „Idee“'), fn: makeSong }, 'sep' as const] : []),
      { icon: 'trash', label: t('Idee löschen'), danger: true, fn: async () => {
        if (!(await host.confirm(t('{x} löschen?', { x: it.title || t('Idee') })))) return;
        if (it.audio) await dbDelete(audioKey(it.id));
        b.ideas = b.ideas.filter((x) => x !== it);
        save();
        rerender();
      } },
    ],
  });

  // content
  if (it.kind === 'riff' && it.clip) {
    card(d, t('Riff')).appendChild(el('pre', 'asciiTab', esc(it.preview || asciiTab(it.clip))));
  }
  if (it.audio) {
    const box = el('div', 'audioBox');
    card(d, t('Aufnahme')).appendChild(box);
    const au = el('audio');
    au.controls = true;
    box.appendChild(au);
    box.appendChild(el('span', 'hint', esc(`${it.audio.name}${it.audio.duration ? ' · ' + fmtDur(it.audio.duration) : ''}`)));
    void dbGet<Blob>(audioKey(it.id)).then((blob) => {
      if (blob) au.src = URL.createObjectURL(blob);
      else box.appendChild(el('span', 'hint', esc(t('Audio nicht gefunden (nur auf dem Gerät gespeichert, wo es aufgenommen wurde)'))));
    });
  }

  const [left, right] = columns(d);
  const sec = (p: HTMLElement, title: string) => card(p, title);
  const field = row;
  const s1 = sec(left, t('Eigenschaften'));
  const tags = el('input', 'pInput');
  tags.placeholder = t('z.B. düster, Drop D, Strophe');
  tags.value = it.tags.join(', ');
  tags.onchange = () => {
    it.tags = [...new Set(tags.value.split(',').map((x) => x.trim()).filter(Boolean))];
    save();
    rerender();
  };
  field(s1, t('Tags'), tags);
  field(s1, t('Tonart'), input(it, 'key', 'z.B. Em'));
  const bpm = input(it, 'bpm', '–', undefined, 'pInput num', 'number');
  if (!it.bpm) bpm.value = '';
  field(s1, t('BPM'), bpm);
  const mood = input(it, 'mood', t('z.B. treibend, ruhig'));
  mood.setAttribute('list', 'moodList');
  field(s1, t('Stimmung'), mood);
  const ml = el('datalist');
  ml.id = 'moodList';
  for (const m of [t('treibend'), t('ruhig'), t('düster'), t('fröhlich'), t('episch'), t('groovig'), t('aggressiv'), t('melancholisch')]) ml.appendChild(Object.assign(el('option'), { value: m }));
  s1.appendChild(ml);
  field(s1, t('Song'), select([['', t('Kein Song')], ...b.songs.map((s) => [s.id, s.title || t('Ohne Titel')] as [string, string])], it.song, (v) => { it.song = v; save(); rerender(); }));

  const s2 = sec(right, it.kind === 'text' ? t('Text') : t('Notiz'));
  const ta = el('textarea', 'pInput notes' + (it.kind === 'text' ? ' big' : ''));
  ta.placeholder = it.kind === 'text' ? t('Textzeilen, Reime, Titel-Ideen …') : t('Was ist daran gut? Wo könnte es hin?');
  ta.value = it.kind === 'text' ? it.text : it.note;
  const count = el('div', 'hint syl');
  const upd = () => {
    if (it.kind !== 'text') return;
    count.textContent = ta.value.split('\n').map((l) => (l.trim() ? `${syllables(l)}` : '')).join(' · ');
  };
  ta.oninput = () => {
    if (it.kind === 'text') it.text = ta.value;
    else it.note = ta.value;
    save();
    upd();
  };
  s2.appendChild(ta);
  if (it.kind === 'text') {
    s2.appendChild(count);
    count.dataset.tip = t('Silben pro Zeile (ungefähr)');
    upd();
  }
  return d;
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
      b.ideas.unshift(it);
      sel = it.id;
      save();
      rerender();
    };
    recorder = r;
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
      b.ideas.unshift(it);
      sel = it.id;
    }
    save();
    rerender();
    host.flash(t('Audio importiert'));
  };
  inp.click();
}

function audioDuration(f: Blob): Promise<number> {
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
export async function collectAudio(b: Band): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const it of b.ideas) {
    if (!it.audio) continue;
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
