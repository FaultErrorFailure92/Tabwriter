// Idea library: riffs (from the editor), voice memos / audio files and text ideas,
// with tags, key, tempo and mood. Audio is kept in IndexedDB.
import { t } from '../i18n';
import { icon, type IconName } from '../icons';
import { dbGet, dbPut, dbDelete } from '../library';
import { el, iconBtn, input, select, esc, save } from './dom';
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

export function renderIdeas(main: HTMLElement, b: Band, host: IdeaHost, rerender: () => void) {
  // actions
  const bar = el('div', 'subBar');
  const riff = el('button', 'btn', `${icon('guitar', 14)}<span>${esc(t('Riff aus Auswahl'))}</span>`);
  riff.dataset.tip = t('Markiere im Editor Takte oder Schläge, dann hier speichern');
  riff.onclick = () => {
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
  };
  const rec = el('button', 'btn' + (recorder ? ' recording' : ''), recorder ? `${icon('stop', 14)}<span class="recTime">0:00</span>` : `${icon('mic', 14)}<span>${esc(t('Sprachmemo'))}</span>`);
  rec.dataset.tip = recorder ? t('Aufnahme beenden') : t('Mit dem Mikrofon aufnehmen');
  rec.onclick = () => void (recorder ? stopRecording() : startRecording(b, rerender, host));
  const imp = el('button', 'btn', `${icon('waveform', 14)}<span>${esc(t('Audio importieren'))}</span>`);
  imp.onclick = () => importAudio(b, rerender, host);
  const txt = el('button', 'btn', `${icon('textInfo', 14)}<span>${esc(t('Text-Idee'))}</span>`);
  txt.onclick = () => {
    const it = newIdea('text', t('Neue Idee'));
    b.ideas.unshift(it);
    sel = it.id;
    save();
    rerender();
    (document.querySelector('.bandDetail .bandTitle') as HTMLInputElement | null)?.select();
  };
  bar.append(riff, rec, imp, txt);
  bar.appendChild(el('span', 'spacer'));
  const q = el('input', 'pInput search');
  q.type = 'search';
  q.placeholder = t('Suchen …');
  q.value = query;
  q.oninput = () => {
    query = q.value;
    const pos = q.selectionStart;
    rerender();
    const nq = document.querySelector('#band .subBar .search') as HTMLInputElement;
    nq.focus();
    nq.setSelectionRange(pos, pos);
  };
  bar.appendChild(q);
  main.appendChild(bar);
  if (recorder) recTick();

  if (!b.ideas.length) {
    main.appendChild(el('div', 'bandEmpty', esc(t('Noch keine Ideen. Speichere ein Riff aus dem Editor, nimm ein Memo auf oder notiere eine Textzeile.'))));
    return;
  }

  // tag chips
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
    main.appendChild(tb);
  }

  const ql = query.trim().toLowerCase();
  const shown = b.ideas.filter((x) => (!tagFilter || x.tags.includes(tagFilter)) && (!ql || [x.title, x.key, x.mood, x.note, x.text, x.tags.join(' ')].join(' ').toLowerCase().includes(ql)));
  if (!shown.some((x) => x.id === sel)) sel = shown[0]?.id ?? '';
  const split = el('div', 'bandSplit');
  const list = el('div', 'bandList');
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
  const top = el('div', 'detailTop');
  top.appendChild(el('span', 'kindBig', icon(KIND_ICON[it.kind], 16)));
  top.appendChild(input(it, 'title', t('Titel'), () => {
    const x = document.querySelector('#band .bandItem.on .t');
    if (x) x.lastChild!.textContent = it.title || t('Ohne Titel');
  }, 'bandTitle'));
  if (!it.song) {
    const mk = el('button', 'btn', `${icon('music', 13)}<span>${esc(t('Zu Song machen'))}</span>`);
    mk.dataset.tip = t('Legt einen Song in der Phase „Idee“ an');
    mk.onclick = () => {
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
    top.appendChild(mk);
  }
  top.appendChild(iconBtn('trash', t('Idee löschen'), async () => {
    if (!(await host.confirm(t('{x} löschen?', { x: it.title || t('Idee') })))) return;
    if (it.audio) await dbDelete(audioKey(it.id));
    b.ideas = b.ideas.filter((x) => x !== it);
    save();
    rerender();
  }));
  d.appendChild(top);

  // content
  if (it.kind === 'riff' && it.clip) {
    const pre = el('pre', 'asciiTab', esc(it.preview || asciiTab(it.clip)));
    d.appendChild(pre);
    const use = el('button', 'btn', `${icon('pencil', 13)}<span>${esc(t('In den Editor kopieren'))}</span>`);
    use.onclick = () => host.useClip(it.clip!);
    d.appendChild(use);
  }
  if (it.audio) {
    const box = el('div', 'audioBox');
    const au = el('audio');
    au.controls = true;
    box.appendChild(au);
    box.appendChild(el('span', 'hint', esc(`${it.audio.name}${it.audio.duration ? ' · ' + fmtDur(it.audio.duration) : ''}`)));
    d.appendChild(box);
    void dbGet<Blob>(audioKey(it.id)).then((blob) => {
      if (blob) au.src = URL.createObjectURL(blob);
      else box.appendChild(el('span', 'hint', esc(t('Audio nicht gefunden (nur auf dem Gerät gespeichert, wo es aufgenommen wurde)'))));
    });
  }

  const cols = el('div', 'gigCols');
  const left = el('div');
  const right = el('div');
  cols.append(left, right);
  d.appendChild(cols);
  const sec = (p: HTMLElement, title: string) => {
    const s = el('section', 'gigSec', `<div class="secTop"><h3>${esc(title)}</h3></div>`);
    p.appendChild(s);
    return s;
  };
  const field = (p: HTMLElement, label: string, ctl: HTMLElement) => {
    const r = el('label', 'gigField', `<span>${esc(label)}</span>`);
    r.appendChild(ctl);
    p.appendChild(r);
  };
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
