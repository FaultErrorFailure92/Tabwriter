// Guitar Pro 5 (v5.00) binary writer for the alphaTab model.
// Byte layout follows the reference implementations of PyGuitarPro / TuxGuitar
// and is verified against alphaTab's own GP3-5 importer.
import * as alphaTab from '@coderline/alphatab';

type Score = alphaTab.model.Score;
type Track = alphaTab.model.Track;
type Beat = alphaTab.model.Beat;
type Note = alphaTab.model.Note;
type MasterBar = alphaTab.model.MasterBar;

const M = alphaTab.model;

// ---------- byte writer ----------
class Writer {
  private buf = new Uint8Array(64 * 1024);
  private pos = 0;
  private dv = new DataView(this.buf.buffer);

  private ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf);
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v: number) { this.ensure(1); this.dv.setUint8(this.pos++, v & 0xff); }
  i8(v: number) { this.ensure(1); this.dv.setInt8(this.pos++, Math.max(-128, Math.min(127, v | 0))); }
  bool(v: boolean) { this.u8(v ? 1 : 0); }
  i16(v: number) { this.ensure(2); this.dv.setInt16(this.pos, v, true); this.pos += 2; }
  i32(v: number) { this.ensure(4); this.dv.setInt32(this.pos, v | 0, true); this.pos += 4; }
  zeros(n: number) { this.ensure(n); this.pos += n; } // buffer is zero-initialised
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.pos); this.pos += b.length; }

  /** byte length + fixed size padding */
  byteSizeString(s: string, size: number) {
    const e = cp1252(s).slice(0, size);
    this.u8(e.length);
    this.bytes(e);
    this.zeros(size - e.length);
  }
  /** int32 length + bytes */
  intSizeString(s: string) {
    const e = cp1252(s);
    this.i32(e.length);
    this.bytes(e);
  }
  /** int32 (len+1) + byte len + bytes */
  intByteSizeString(s: string) {
    const e = cp1252(s).slice(0, 255);
    this.i32(e.length + 1);
    this.u8(e.length);
    this.bytes(e);
  }
  color(r: number, g: number, b: number) {
    this.u8(r); this.u8(g); this.u8(b); this.u8(0);
  }
  result() { return this.buf.slice(0, this.pos); }
}

// Windows-1252 encoding (what Guitar Pro 5 uses)
const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
function cp1252(s: string | null | undefined): Uint8Array {
  const str = s ?? '';
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out[i] = c;
    else out[i] = CP1252_EXTRA[c] ?? 0x3f; // '?'
  }
  return out;
}

// ---------- helpers ----------
const DIRECTION_ORDER: string[] = [
  'TargetCoda', 'TargetDoubleCoda', 'TargetSegno', 'TargetSegnoSegno', 'TargetFine',
  'JumpDaCapo', 'JumpDaCapoAlCoda', 'JumpDaCapoAlDoubleCoda', 'JumpDaCapoAlFine',
  'JumpDalSegno', 'JumpDalSegnoAlCoda', 'JumpDalSegnoAlDoubleCoda', 'JumpDalSegnoAlFine',
  'JumpDalSegnoSegno', 'JumpDalSegnoSegnoAlCoda', 'JumpDalSegnoSegnoAlDoubleCoda', 'JumpDalSegnoSegnoAlFine',
  'JumpDaCoda', 'JumpDaDoubleCoda',
];

function durationValue(d: number): number {
  // whole=-2, half=-1, quarter=0, eighth=1 ...
  switch (d) {
    case 1: return -2;
    case 2: return -1;
    case 4: return 0;
    case 8: return 1;
    case 16: return 2;
    case 32: return 3;
    case 64: return 4;
    default: return d < 1 ? -2 : 4;
  }
}

function beams(num: number, den: number): number[] {
  const eighths = Math.max(1, Math.round((num * 8) / den));
  const group = den === 8 && num % 3 === 0 ? 3 : 2;
  const out: number[] = [];
  let rest = eighths;
  while (rest > 0 && out.length < 4) {
    const g = out.length === 3 ? rest : Math.min(group, rest);
    out.push(Math.min(g, 255));
    rest -= g;
  }
  while (out.length < 4) out.push(0);
  return out;
}

function strokeValue(ticks: number): number {
  if (ticks <= 30) return 2;
  if (ticks <= 60) return 3;
  if (ticks <= 120) return 4;
  if (ticks <= 240) return 5;
  return 6;
}

function dynamicFile(d: number): number {
  return d + 1; // PPP=0 -> 1 ... FFF=7 -> 8
}

function tempoAt(mb: MasterBar): number | null {
  const a = mb.tempoAutomations?.[0];
  return a ? Math.round(a.value) : null;
}

// ---------- writer ----------
export function writeGp5(score: Score): Uint8Array {
  const w = new Writer();
  const tracks = score.tracks;
  const masterBars = score.masterBars;

  // version
  w.byteSizeString('FICHIER GUITAR PRO v5.00', 30);

  // info
  w.intByteSizeString(score.title);
  w.intByteSizeString(score.subTitle);
  w.intByteSizeString(score.artist);
  w.intByteSizeString(score.album);
  w.intByteSizeString(score.words);
  w.intByteSizeString(score.music);
  w.intByteSizeString(score.copyright);
  w.intByteSizeString(score.tab);
  w.intByteSizeString(score.instructions);
  const notice = (score.notices ?? '').split(/\r?\n/).filter((l, i, a) => l.length || i < a.length - 1);
  w.i32(notice.length);
  for (const l of notice) w.intByteSizeString(l);

  // lyrics: first track that has some
  let lyr: { start: number; text: string } | null = null;
  let lyrTrack = -1;
  for (let i = 0; i < tracks.length && !lyr; i++) {
    lyr = lyricsText(tracks[i]);
    if (lyr) lyrTrack = i;
  }
  w.i32(lyr ? lyrTrack + 1 : 0);
  for (let i = 0; i < 5; i++) {
    w.i32(i === 0 && lyr ? lyr.start + 1 : 1);
    w.intSizeString(i === 0 && lyr ? lyr.text : '');
  }

  // page setup
  w.i32(210); w.i32(297); // page size
  w.i32(10); w.i32(10); w.i32(15); w.i32(10); // margins l r t b
  w.i32(100); // score size %
  w.u8(0xff); // header/footer flags
  w.u8(0x01);
  w.intByteSizeString('%TITLE%');
  w.intByteSizeString('%SUBTITLE%');
  w.intByteSizeString('%ARTIST%');
  w.intByteSizeString('%ALBUM%');
  w.intByteSizeString('Words by %WORDS%');
  w.intByteSizeString('Music by %MUSIC%');
  w.intByteSizeString('Words & Music by %WORDSMUSIC%');
  w.intByteSizeString('Copyright %COPYRIGHT%');
  w.intByteSizeString('All Rights Reserved - International Copyright Secured');
  w.intByteSizeString('Page %N%/%P%');

  // tempo, key
  w.intByteSizeString(score.masterBars[0]?.tempoAutomations?.[0]?.text || 'Moderate');
  w.i32(tempoAt(masterBars[0]) ?? 120);
  w.i8(masterBars[0] ? (masterBars[0].keySignature as number) : 0);
  w.i32(0); // octave

  // midi channel table (4 ports x 16 channels). Channels are re-allocated:
  // every track gets its own pair, drums use channel 10.
  const chans = allocateChannels(tracks);
  const table = new Map<number, Track>();
  tracks.forEach((t, i) => {
    table.set(chans[i][0], t);
    table.set(chans[i][1], t);
  });
  for (let ch = 0; ch < 64; ch++) {
    const t = table.get(ch);
    if (t) {
      const pi = t.playbackInfo;
      w.i32(t.staves[0]?.isPercussion ? 0 : Math.max(0, pi.program));
      w.i8(pi.volume);
      w.i8(pi.balance);
    } else {
      w.i32(25);
      w.i8(13);
      w.i8(8);
    }
    w.i8(0); w.i8(0); w.i8(0); w.i8(0); // chorus reverb phaser tremolo
    w.zeros(2);
  }

  // directions
  for (const name of DIRECTION_ORDER) {
    const dirVal = (M.Direction as any)[name];
    let bar = -1;
    if (dirVal !== undefined) {
      const idx = masterBars.findIndex((mb) => mb.directions?.has(dirVal));
      if (idx >= 0) bar = idx + 1;
    }
    w.i16(bar);
  }
  w.i32(0); // master reverb

  w.i32(masterBars.length);
  w.i32(tracks.length);

  // measure headers
  masterBars.forEach((mb, i) => {
    const prev = i > 0 ? masterBars[i - 1] : null;
    if (prev) w.zeros(1);
    let flags = 0;
    if (!prev || mb.timeSignatureNumerator !== prev.timeSignatureNumerator) flags |= 0x01;
    if (!prev || mb.timeSignatureDenominator !== prev.timeSignatureDenominator) flags |= 0x02;
    if (mb.isRepeatStart) flags |= 0x04;
    if (mb.repeatCount > 0) flags |= 0x08;
    if (mb.alternateEndings) flags |= 0x10;
    if (mb.section) flags |= 0x20;
    const key = mb.keySignature as number;
    const keyType = mb.keySignatureType as number;
    if (!prev || key !== (prev.keySignature as number) || keyType !== (prev.keySignatureType as number)) flags |= 0x40;
    if (mb.isDoubleBar) flags |= 0x80;
    // beams must be written whenever the time signature is
    if (flags & 0x03) flags |= 0x03;

    w.u8(flags);
    if (flags & 0x01) w.i8(mb.timeSignatureNumerator);
    if (flags & 0x02) w.i8(mb.timeSignatureDenominator);
    if (flags & 0x08) w.i8(mb.repeatCount);
    if (flags & 0x20) {
      w.intByteSizeString(mb.section!.text || mb.section!.marker || '');
      w.color(255, 0, 0);
    }
    if (flags & 0x40) {
      w.i8(key);
      w.i8(keyType);
    }
    // order as written by Guitar Pro 5 itself: beams, then the alternate-ending byte
    if (flags & 0x03) for (const b of beams(mb.timeSignatureNumerator, mb.timeSignatureDenominator)) w.u8(b);
    w.u8(flags & 0x10 ? mb.alternateEndings & 0xff : 0);
    const tf = mb.tripletFeel as number;
    const TF = alphaTab.model.TripletFeel;
    w.u8(tf === TF.Triplet8th ? 1 : tf === TF.Triplet16th ? 2 : 0);
  });

  // tracks
  const tempoMap = buildTempoMap(score);
  tracks.forEach((t, i) => writeTrack(w, t, chans[i]));
  w.zeros(2);

  // bars
  for (let b = 0; b < masterBars.length; b++) {
    for (const t of tracks) {
      const bar = t.staves[0]?.bars[b];
      for (let v = 0; v < 2; v++) {
        const voice = bar?.voices[v];
        const beats = voice ? voice.beats : [];
        writeVoice(w, t, beats, tempoMap, b, v);
      }
      w.u8(0); // line break
    }
  }

  return w.result();
}

function writeTrack(w: Writer, t: Track, chan: [number, number]) {
  const st = t.staves[0];
  const perc = st.isPercussion;
  w.zeros(1); // v5.00: blank byte before every track
  let flags = 0;
  if (perc) flags |= 0x01;
  if (t.isVisibleOnMultiTrack) flags |= 0x08;
  if (t.playbackInfo.isSolo) flags |= 0x10;
  if (t.playbackInfo.isMute) flags |= 0x20;
  flags |= 0x80; // indicate tuning
  w.u8(flags);
  w.byteSizeString(t.name || 'Track', 40);
  const tuning = perc ? [0, 0, 0, 0, 0, 0] : st.tuning.slice(0, 7);
  w.i32(tuning.length);
  for (let i = 0; i < 7; i++) w.i32(i < tuning.length ? tuning[i] : 0);
  w.i32(1); // port
  w.i32(chan[0] + 1);
  w.i32(chan[1] + 1);
  w.i32(24); // fret count
  w.i32(st.capo || 0);
  const c = t.color;
  w.color(c?.r ?? 255, c?.g ?? 0, c?.b ?? 0);

  let flags2 = 0;
  if (st.showTablature && !perc) flags2 |= 0x0001;
  if (st.showStandardNotation || perc) flags2 |= 0x0002;
  w.i16(flags2);
  w.u8(0); // auto accentuation
  w.u8(t.playbackInfo.bank || 0);
  w.u8(0); // humanize
  const low = tuning.length ? tuning[tuning.length - 1] : 40;
  const clefTranspose = !perc && low < 35 ? 12 : 0;
  w.i32(clefTranspose);
  w.i32(clefTranspose);
  w.i32(100);
  w.zeros(12);
  // RSE instrument (5.00)
  w.i32(-1);
  w.i32(0);
  w.i32(0);
  w.i16(0);
  w.zeros(1);
}

/** GP5 notes are attached grace effects; alphaTab keeps grace notes as own beats. */
interface GraceInfo { fret: number; dynamic: number; transition: number; dead: boolean; onBeat: boolean }

function writeVoice(w: Writer, t: Track, beats: Beat[], tempoMap: TempoMap, barIndex: number, voiceIndex: number) {
  // split grace beats off and attach them to the following main beat
  const main: { beat: Beat; graces: Map<number, GraceInfo> }[] = [];
  let pending: Beat[] = [];
  for (const b of beats) {
    if ((b.graceType as number) !== 0) {
      pending.push(b);
      continue;
    }
    const graces = new Map<number, GraceInfo>();
    for (const g of pending) {
      for (const gn of g.notes) {
        graces.set(gn.string, {
          fret: gn.fret,
          dynamic: dynamicFile(gn.dynamics as number),
          transition: gn.isHammerPullOrigin ? 3 : gn.slideOutType ? 1 : 0,
          dead: gn.isDead,
          onBeat: (g.graceType as number) === (alphaTab.model.GraceType.OnBeat as number),
        });
      }
    }
    pending = [];
    main.push({ beat: b, graces });
  }

  const isTempoCarrier = t.index === 0 && voiceIndex === 0;
  if (!main.length) {
    // one empty beat (GP5 always stores at least one)
    const tempos = isTempoCarrier ? tempoMap.byBar.get(barIndex) : undefined;
    const tempo = tempos && tempos.length ? tempos[tempos.length - 1].value : null;
    w.i32(1);
    w.u8(0x40 | (tempo !== null ? 0x10 : 0));
    w.u8(0); // empty
    w.i8(0); // quarter
    if (tempo !== null) writeTempoChange(w, tempo);
    w.u8(0); // no strings
    w.i16(0);
    return;
  }

  w.i32(main.length);
  for (const { beat, graces } of main) {
    const tempo = isTempoCarrier ? tempoMap.byBeat.get(beat) ?? null : null;
    writeBeat(w, t, beat, graces, tempo);
  }
}

function allocateChannels(tracks: Track[]): [number, number][] {
  const used = new Set<number>([9]);
  const next = () => {
    for (let c = 0; c < 64; c++) {
      if (c % 16 === 9) continue;
      if (!used.has(c)) {
        used.add(c);
        return c;
      }
    }
    return 0;
  };
  return tracks.map((t) => {
    if (t.staves[0]?.isPercussion) return [9, 9];
    const a = next();
    const b = next();
    return [a, b];
  });
}

interface TempoMap {
  byBeat: Map<Beat, number>;
  byBar: Map<number, { ratio: number; value: number }[]>;
}

/** tempo automations (except the song tempo at the very start) mapped onto beats of the first track */
function buildTempoMap(score: Score): TempoMap {
  const byBeat = new Map<Beat, number>();
  const byBar = new Map<number, { ratio: number; value: number }[]>();
  const t0 = score.tracks[0];
  score.masterBars.forEach((mb, i) => {
    const list = (mb.tempoAutomations ?? [])
      .filter((a) => !(i === 0 && a.ratioPosition <= 0.0001))
      .map((a) => ({ ratio: a.ratioPosition, value: Math.round(a.value) }))
      .sort((a, b) => a.ratio - b.ratio);
    if (!list.length) return;
    byBar.set(i, list);
    const beats = (t0?.staves[0]?.bars[i]?.voices[0]?.beats ?? []).filter((b) => (b.graceType as number) === 0);
    if (!beats.length) return;
    const total = mb.calculateDuration() || 1;
    for (const a of list) {
      let target = beats[0];
      for (const b of beats) {
        if (b.playbackStart / total <= a.ratio + 0.0001) target = b;
      }
      byBeat.set(target, a.value); // last one on the same beat wins
    }
  });
  return { byBeat, byBar };
}

function writeBeat(w: Writer, t: Track, b: Beat, graces: Map<number, GraceInfo>, tempo: number | null) {
  const st = t.staves[0];
  const perc = st.isPercussion;
  const notes = b.notes.filter((n) => n.isVisible !== false);
  const hasTuplet = b.tupletNumerator > 0 && b.tupletDenominator > 0 && !(b.tupletNumerator === 1 && b.tupletDenominator === 1);

  const brush = (b.brushType as number) !== 0;
  const pick = (b.pickStroke as number) !== 0;
  const whammy = !!(b.whammyBarPoints && b.whammyBarPoints.length);
  const slapType = b.tap ? 1 : b.slap ? 2 : b.pop ? 3 : 0;
  const beatVibrato = (b.vibrato as number) !== 0;
  const fadeIn = (b.fade as number) === 1;
  const hasEffects = brush || pick || whammy || slapType || beatVibrato || fadeIn;

  let flags = 0;
  if (b.dots > 0) flags |= 0x01;
  const chord = b.chordId ? st.getChord(b.chordId) : null;
  if (chord?.name) flags |= 0x02;
  if (b.text) flags |= 0x04;
  if (hasEffects) flags |= 0x08;
  if (tempo !== null) flags |= 0x10;
  if (hasTuplet) flags |= 0x20;
  const isEmpty = b.isEmpty;
  const isRest = !isEmpty && notes.length === 0;
  if (isEmpty || isRest) flags |= 0x40;

  w.u8(flags);
  if (flags & 0x40) w.u8(isEmpty ? 0 : 2);
  w.i8(durationValue(b.duration as number));
  if (flags & 0x20) w.i32(b.tupletNumerator);
  if (flags & 0x02) writeChord(w, chord!);
  if (flags & 0x04) w.intByteSizeString(b.text ?? '');
  if (flags & 0x08) {
    let f1 = 0;
    let f2 = 0;
    if (beatVibrato) f1 |= 0x02;
    if (fadeIn) f1 |= 0x10;
    if (slapType) f1 |= 0x20;
    if (brush) f1 |= 0x40;
    if (pick) f2 |= 0x02;
    if (whammy) f2 |= 0x04;
    w.i8(f1);
    w.i8(f2);
    if (f1 & 0x20) w.i8(slapType);
    if (f2 & 0x04) writeBend(w, b.whammyBarPoints!);
    if (f1 & 0x40) {
      const v = strokeValue(b.brushDuration);
      const up = (b.brushType as number) === (alphaTab.model.BrushType.BrushUp as number) || (b.brushType as number) === (alphaTab.model.BrushType.ArpeggioUp as number);
      // GP5: up first, then down
      w.i8(up ? v : 0);
      w.i8(up ? 0 : v);
    }
    if (f2 & 0x02) w.i8((b.pickStroke as number) === (alphaTab.model.PickStroke.Up as number) ? 1 : 2);
  }
  if (flags & 0x10) writeTempoChange(w, tempo!);

  // notes
  const slots: { slot: number; note: Note }[] = [];
  if (perc) {
    notes.slice(0, 7).forEach((n, k) => slots.push({ slot: k + 1, note: n }));
  } else {
    const count = st.tuning.length;
    for (const n of notes) {
      const slot = count - n.string + 1; // 1 = highest string
      if (slot >= 1 && slot <= 7 && !slots.some((s) => s.slot === slot)) slots.push({ slot, note: n });
    }
  }
  slots.sort((a, c) => a.slot - c.slot);
  let stringFlags = 0;
  for (const s of slots) stringFlags |= 1 << (7 - s.slot);
  w.u8(stringFlags);
  for (const s of slots) writeNote(w, t, s.note, perc, graces.get(s.note.string));

  w.i16(0); // beat flags2 (beaming etc.)
}

/** GP5 chord diagram block (106 bytes, "new format") */
function writeChord(w: Writer, c: alphaTab.model.Chord) {
  w.u8(1); // new format
  w.u8(1); // sharp
  w.zeros(3);
  w.u8(0); // root
  w.u8(0); // type
  w.u8(0); // extension
  w.i32(0); // bass
  w.i32(0); // tonality
  w.u8(0); // add
  w.byteSizeString(c.name, 20);
  w.zeros(2);
  w.u8(0); // fifth
  w.u8(0); // ninth
  w.u8(0); // eleventh
  w.i32(c.strings.length ? c.firstFret : 0);
  for (let i = 0; i < 7; i++) w.i32(i < c.strings.length ? c.strings[i] : -1);
  w.u8(0); // barres
  w.zeros(5 + 5 + 5); // barre frets / starts / ends
  w.zeros(7); // omissions
  w.zeros(1);
  w.zeros(7); // fingering
  w.u8(0); // show fingering
}

/** lyrics of one track in GP syntax: one chunk per note beat, "_" = empty, "Hal-lo" = two syllables */
function lyricsText(t: Track): { start: number; text: string } | null {
  const bars = t.staves[0]?.bars ?? [];
  let start = -1;
  const chunks: string[] = [];
  let lastReal = -1;
  for (let bi = 0; bi < bars.length; bi++) {
    for (const b of bars[bi].voices[0]?.beats ?? []) {
      if (b.isEmpty || b.isRest || !b.notes.length) continue;
      const ly = (b.lyrics?.[0] ?? '').trim();
      if (start < 0) {
        if (!ly && !bars[bi].voices[0].beats.some((x) => x.lyrics?.[0]?.trim())) continue;
        start = bi;
      }
      chunks.push(ly ? ly.replace(/\s+/g, '+') : '_');
      if (ly) lastReal = chunks.length;
    }
  }
  if (start < 0 || lastReal < 0) return null;
  let text = '';
  for (const c of chunks.slice(0, lastReal)) text += text && !text.endsWith('-') ? ' ' + c : c;
  return { start, text };
}

function writeTempoChange(w: Writer, tempo: number) {
  w.i8(-1); // instrument
  // RSE instrument (5.00) + blank
  w.i32(-1); w.i32(0); w.i32(0); w.i16(0); w.zeros(1);
  w.zeros(1);
  w.i8(-1); w.i8(-1); w.i8(-1); w.i8(-1); w.i8(-1); w.i8(-1); // vol bal chorus reverb phaser tremolo
  w.intByteSizeString('');
  w.i32(tempo);
  w.i8(0); // tempo transition duration
  w.u8(0); // apply-to-all flags
  w.i8(-1); // wah: none
}

function percussionMidi(t: Track, n: Note): number {
  const idx = n.percussionArticulation;
  const arts = t.percussionArticulations;
  if (arts && idx >= 0 && idx < arts.length) return arts[idx].outputMidiNumber;
  if (idx >= 0) return idx;
  return n.fret >= 0 ? n.fret : 38;
}

function writeNote(w: Writer, t: Track, n: Note, perc: boolean, grace: GraceInfo | undefined) {
  const AT = alphaTab.model.AccentuationType;
  const hasBend = !!(n.bendPoints && n.bendPoints.length);
  const slide = (n.slideOutType as number) !== 0 || (n.slideInType as number) !== 0;
  const harmonic = (n.harmonicType as number) !== 0;
  const trill = n.isTrill;
  const tremolo = !!n.beat.tremoloPicking;
  const vibrato = (n.vibrato as number) !== 0;
  const hasEffects = hasBend || n.isHammerPullOrigin || n.isLetRing || !!grace || n.isStaccato || n.isPalmMute || tremolo || slide || harmonic || trill || vibrato;
  const dyn = n.dynamics as number;
  const F = alphaTab.model.DynamicValue.F as number;

  let flags = 0x20;
  if ((n.accentuated as number) === (AT.Heavy as number)) flags |= 0x02;
  if (n.isGhost) flags |= 0x04;
  if (hasEffects) flags |= 0x08;
  if (dyn !== F) flags |= 0x10;
  if ((n.accentuated as number) === (AT.Normal as number)) flags |= 0x40;

  w.u8(flags);
  w.u8(n.isDead ? 3 : n.isTieDestination ? 2 : 1);
  if (flags & 0x10) w.i8(dynamicFile(dyn));
  const fret = perc ? percussionMidi(t, n) : n.fret;
  w.i8(Math.max(0, Math.min(127, fret)));
  w.u8(0); // flags2 (swap accidentals)

  if (flags & 0x08) {
    let f1 = 0;
    let f2 = 0;
    if (hasBend) f1 |= 0x01;
    if (n.isHammerPullOrigin) f1 |= 0x02;
    if (n.isLetRing) f1 |= 0x08;
    if (grace) f1 |= 0x10;
    if (n.isStaccato) f2 |= 0x01;
    if (n.isPalmMute) f2 |= 0x02;
    if (tremolo) f2 |= 0x04;
    if (slide) f2 |= 0x08;
    if (harmonic) f2 |= 0x10;
    if (trill) f2 |= 0x20;
    if (vibrato) f2 |= 0x40;
    w.i8(f1);
    w.i8(f2);
    if (f1 & 0x01) writeBend(w, n.bendPoints!);
    if (f1 & 0x10) {
      const g = grace!;
      w.u8(g.fret);
      w.u8(g.dynamic);
      w.u8(g.transition);
      w.u8(2); // 32nd
      w.u8((g.dead ? 0x01 : 0) | (g.onBeat ? 0x02 : 0));
    }
    if (f2 & 0x04) w.i8(Math.max(1, Math.min(3, n.beat.tremoloPicking!.marks || 2)));
    if (f2 & 0x08) {
      const SO = alphaTab.model.SlideOutType;
      const SI = alphaTab.model.SlideInType;
      let s = 0;
      const so = n.slideOutType as number;
      if (so === (SO.Shift as number)) s |= 0x01;
      else if (so === (SO.Legato as number)) s |= 0x02;
      else if (so === (SO.OutDown as number)) s |= 0x04;
      else if (so === (SO.OutUp as number)) s |= 0x08;
      else if (so !== 0) s |= 0x01;
      const si = n.slideInType as number;
      if (si === (SI.IntoFromBelow as number)) s |= 0x10;
      else if (si === (SI.IntoFromAbove as number)) s |= 0x20;
      w.u8(s);
    }
    if (f2 & 0x10) {
      const HT = alphaTab.model.HarmonicType;
      const ht = n.harmonicType as number;
      if (ht === (HT.Artificial as number)) {
        const played = (n.fret + Math.max(0, n.stringTuning)) % 12;
        w.i8(2);
        w.u8(played);
        w.i8(0);
        w.u8(1);
      } else if (ht === (HT.Tap as number)) {
        w.i8(3);
        w.u8(12);
      } else if (ht === (HT.Pinch as number)) w.i8(4);
      else if (ht === (HT.Semi as number)) w.i8(5);
      else w.i8(1);
    }
    if (f2 & 0x20) {
      w.i8(Math.max(0, n.trillValue - n.stringTuning));
      const sp = n.trillSpeed as number;
      w.i8(sp === 16 ? 1 : sp === 64 ? 3 : 2);
    }
  }
}

function writeBend(w: Writer, points: alphaTab.model.BendPoint[]) {
  const max = points.reduce((m, p) => Math.max(m, Math.abs(p.value)), 0);
  w.i8(bendType(points)); // only used by the GP editor
  w.i32(max * 25);
  w.i32(points.length);
  for (const p of points) {
    w.i32(Math.round(p.offset));
    w.i32(Math.round(p.value * 25));
    w.bool(false);
  }
}

/** GP bend type: 1 bend, 2 bend+release, 3 bend+release+bend, 4 prebend, 5 prebend+release */
function bendType(points: alphaTab.model.BendPoint[]): number {
  if (!points.length) return 0;
  const v = points.map((p) => p.value);
  if (v[0] > 0) return v[v.length - 1] < v[0] ? 5 : 4;
  let dir = 0;
  let changes = 0;
  for (let i = 1; i < v.length; i++) {
    const d = Math.sign(v[i] - v[i - 1]);
    if (d !== 0 && d !== dir) {
      if (dir !== 0) changes++;
      dir = d;
    }
  }
  return changes === 0 ? 1 : changes === 1 ? 2 : 3;
}
