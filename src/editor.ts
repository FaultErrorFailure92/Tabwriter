// Editing logic: cursor + operations on the alphaTab model.
import * as alphaTab from '@coderline/alphatab';
import { t } from './i18n';
import {
  type Score, type Beat, type Bar, type Preset,
  DRUM_LANES, newBar, newBeat, newMasterBar, addTrack, rebuild, snapshot, restore,
  beatTicks, barTicks, voiceTicks,
} from './model';

const m = alphaTab.model;
const DURATIONS = [1, 2, 4, 8, 16, 32, 64];

export interface Pos { bar: number; beat: number }

export interface Cursor {
  track: number;
  bar: number;
  beat: number;
  row: number; // stringed: 0 = highest string (top line). drums: lane index.
}

export class Editor {
  score: Score;
  cursor: Cursor = { track: 0, bar: 0, beat: 0, row: 0 };
  duration = 4;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastDigit: { time: number; key: string; value: number } | null = null;
  onChange: (structural: boolean) => void = () => {};
  dirty = false;

  constructor(score: Score, private settings: alphaTab.Settings) {
    this.score = rebuild(score, settings);
  }

  setScore(score: Score) {
    this.score = rebuild(score, this.settings);
    this.cursor = { track: 0, bar: 0, beat: 0, row: 0 };
    this.selAnchor = null;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.clamp();
  }

  // ---------- accessors ----------
  get track() { return this.score.tracks[this.cursor.track]; }
  get staff() { return this.track.staves[0]; }
  get isDrums() { return this.staff.isPercussion; }
  get stringCount() { return this.staff.tuning.length; }
  get rowCount() { return this.isDrums ? DRUM_LANES.length : this.stringCount; }
  get bar(): Bar { return this.staff.bars[this.cursor.bar]; }
  get voice() { return this.bar.voices[0]; }
  get beat(): Beat { return this.voice.beats[this.cursor.beat]; }
  get masterBar() { return this.score.masterBars[this.cursor.bar]; }
  /** alphaTab string number (1 = lowest) for current row */
  get string() { return this.stringCount - this.cursor.row; }

  noteAtCursor() {
    const b = this.beat;
    if (this.isDrums) {
      const midi = DRUM_LANES[this.cursor.row].midi;
      return b.notes.find((n) => n.percussionArticulation === midi) ?? null;
    }
    return b.notes.find((n) => n.string === this.string) ?? null;
  }

  barHasContent() {
    return this.voice.beats.some((b) => !b.isEmpty);
  }

  barFill(): { used: number; total: number } {
    return { used: voiceTicks(this.bar), total: barTicks(this.masterBar) };
  }

  clamp() {
    const c = this.cursor;
    c.track = Math.max(0, Math.min(c.track, this.score.tracks.length - 1));
    c.bar = Math.max(0, Math.min(c.bar, this.score.masterBars.length - 1));
    if (this.voice.beats.length === 0) this.voice.addBeat(newBeat(this.duration, true));
    c.beat = Math.max(0, Math.min(c.beat, this.voice.beats.length - 1));
    c.row = Math.max(0, Math.min(c.row, this.rowCount - 1));
  }

  // ---------- undo ----------
  private begin() {
    this.undoStack.push(snapshot(this.score));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  /** hammer-ons typed before their target note exists (alphaTab drops them until then) */
  private pendingHammer = new Set<number>();

  private forEachNote(fn: (n: alphaTab.model.Note) => void) {
    for (const t of this.score.tracks)
      for (const st of t.staves) for (const bar of st.bars) for (const v of bar.voices) for (const b of v.beats) for (const n of b.notes) fn(n);
  }

  private commit(structural = false) {
    if (this.pendingHammer.size) this.forEachNote((n) => { if (this.pendingHammer.has(n.id)) n.isHammerPullOrigin = true; });
    this.score = rebuild(this.score, this.settings);
    if (this.pendingHammer.size) {
      const alive = new Set<number>();
      this.forEachNote((n) => { if (this.pendingHammer.has(n.id) && !n.isHammerPullOrigin) alive.add(n.id); });
      this.pendingHammer = alive;
    }
    this.dirty = true;
    this.clamp();
    this.onChange(structural);
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(snapshot(this.score));
    this.score = restore(s, this.settings);
    this.selAnchor = null;
    this.clamp();
    this.onChange(true);
  }

  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(snapshot(this.score));
    this.score = restore(s, this.settings);
    this.selAnchor = null;
    this.clamp();
    this.onChange(true);
  }

  // ---------- navigation ----------
  moveRow(d: number) {
    this.cursor.row = (this.cursor.row + d + this.rowCount) % this.rowCount;
    this.lastDigit = null;
  }

  next() {
    this.lastDigit = null;
    const c = this.cursor;
    if (c.beat < this.voice.beats.length - 1) {
      c.beat++;
      return;
    }
    const fill = this.barFill();
    const b = this.beat;
    // GP5 behaviour: extend bar with a new beat as long as it isn't full
    if (fill.used < fill.total && !b.isEmpty) {
      this.begin();
      const nb = newBeat(this.duration, true);
      nb.duration = b.duration;
      this.voice.addBeat(nb);
      c.beat++;
      this.commit();
      return;
    }
    if (c.bar < this.score.masterBars.length - 1) {
      c.bar++;
      c.beat = 0;
      return;
    }
    // last bar: create a new one only if this one has content
    if (this.barHasContent()) {
      this.begin();
      this.appendBar();
      c.bar++;
      c.beat = 0;
      this.commit(true);
    }
  }

  prev() {
    this.lastDigit = null;
    const c = this.cursor;
    if (c.beat > 0) {
      c.beat--;
    } else if (c.bar > 0) {
      c.bar--;
      c.beat = this.voice.beats.length - 1;
    }
  }

  nextBar() {
    this.lastDigit = null;
    const c = this.cursor;
    if (c.bar < this.score.masterBars.length - 1) {
      c.bar++;
      c.beat = 0;
    } else if (this.barHasContent()) {
      this.begin();
      this.appendBar();
      c.bar++;
      c.beat = 0;
      this.commit(true);
    }
  }

  prevBar() {
    this.lastDigit = null;
    if (this.cursor.beat > 0) {
      this.cursor.beat = 0;
    } else if (this.cursor.bar > 0) {
      this.cursor.bar--;
      this.cursor.beat = 0;
    }
  }

  home() { this.cursor.bar = 0; this.cursor.beat = 0; }
  end() { this.cursor.bar = this.score.masterBars.length - 1; this.cursor.beat = 0; this.clamp(); }

  gotoTrack(i: number) {
    if (i !== this.cursor.track) this.selAnchor = null;
    this.cursor.track = i;
    this.clamp();
  }

  // ---------- bar structure ----------
  private appendBar() {
    this.insertBarAt(this.score.masterBars.length);
  }

  private insertBarAt(index: number) {
    const s = this.score;
    const ref = s.masterBars[Math.max(0, index - 1)] ?? null;
    const mb = newMasterBar(ref);
    s.masterBars.splice(index, 0, mb);
    mb.score = s;
    for (const t of s.tracks) {
      for (const st of t.staves) {
        const refBar = st.bars[Math.max(0, index - 1)];
        const bar = newBar(this.duration);
        if (refBar) {
          bar.clef = refBar.clef;
          bar.clefOttava = refBar.clefOttava;
          bar.keySignature = refBar.keySignature;
          bar.keySignatureType = refBar.keySignatureType;
        }
        bar.staff = st;
        st.bars.splice(index, 0, bar);
      }
    }
    this.reindex();
  }

  private reindex() {
    // rebuild() re-links everything; keep indices sane for the JSON roundtrip
    this.score.masterBars.forEach((mb, i) => (mb.index = i));
    for (const t of this.score.tracks) for (const st of t.staves) st.bars.forEach((b, i) => (b.index = i));
  }

  insertBar() {
    this.begin();
    this.insertBarAt(this.cursor.bar);
    this.cursor.beat = 0;
    this.commit(true);
  }

  deleteBar() {
    const s = this.score;
    this.begin();
    if (s.masterBars.length <= 1) {
      // just clear
      for (const t of s.tracks) for (const st of t.staves) {
        const nb = newBar(this.duration);
        nb.clef = st.bars[0].clef;
        nb.staff = st;
        st.bars[0] = nb;
      }
    } else {
      const i = this.cursor.bar;
      const removed = s.masterBars.splice(i, 1)[0];
      // keep tempo of first bar
      if (i === 0 && removed.tempoAutomations.length && !s.masterBars[0].tempoAutomations.length) {
        s.masterBars[0].tempoAutomations = removed.tempoAutomations;
      }
      for (const t of s.tracks) for (const st of t.staves) st.bars.splice(i, 1);
      this.reindex();
    }
    this.cursor.beat = 0;
    this.commit(true);
  }

  setTimeSignature(num: number, den: number) {
    this.begin();
    const start = this.cursor.bar;
    const old = { n: this.masterBar.timeSignatureNumerator, d: this.masterBar.timeSignatureDenominator };
    // apply to this bar and following bars that had the same signature
    for (let i = start; i < this.score.masterBars.length; i++) {
      const mb = this.score.masterBars[i];
      if (i > start && (mb.timeSignatureNumerator !== old.n || mb.timeSignatureDenominator !== old.d)) break;
      mb.timeSignatureNumerator = num;
      mb.timeSignatureDenominator = den;
    }
    this.commit(true);
  }

  // ---------- bar properties ----------
  setRepeatStart(on: boolean) {
    this.begin();
    this.masterBar.isRepeatStart = on;
    this.commit(true);
  }

  /** 0 = no repeat end, otherwise total number of plays */
  setRepeatCount(n: number) {
    this.begin();
    this.masterBar.repeatCount = Math.max(0, Math.min(16, n));
    this.commit(true);
  }

  setAlternateEndings(mask: number) {
    this.begin();
    this.masterBar.alternateEndings = mask & 0xff;
    this.commit(true);
  }

  setSection(text: string, bar = this.cursor.bar) {
    this.begin();
    const mb = this.score.masterBars[bar];
    if (text.trim()) {
      const sec = mb.section ?? new alphaTab.model.Section();
      sec.text = text.trim();
      sec.marker = sec.marker || '';
      mb.section = sec;
    } else {
      mb.section = null;
    }
    this.commit(true);
  }

  /** replace targets (Segno, Coda, Fine …) or jumps (D.C., D.S. …) of the current bar */
  setDirection(kind: 'target' | 'jump', value: number | null) {
    const D = alphaTab.model.Direction;
    const targets = [D.TargetFine, D.TargetSegno, D.TargetSegnoSegno, D.TargetCoda, D.TargetDoubleCoda] as number[];
    this.begin();
    const mb = this.masterBar;
    const keep = Array.from(mb.directions ?? []).filter((d) => (kind === 'target' ? !targets.includes(d as number) : targets.includes(d as number)));
    mb.directions = null;
    for (const d of keep) mb.addDirection(d);
    if (value !== null) mb.addDirection(value as alphaTab.model.Direction);
    this.commit(true);
  }

  setKeySignature(key: number, minor: boolean) {
    this.begin();
    const start = this.cursor.bar;
    const ks = key as alphaTab.model.KeySignature;
    const kt = (minor ? 1 : 0) as alphaTab.model.KeySignatureType;
    const old = this.staff.bars[start].keySignature;
    const oldT = this.staff.bars[start].keySignatureType;
    for (const tr of this.score.tracks) {
      for (const st of tr.staves) {
        for (let i = start; i < st.bars.length; i++) {
          const bar = st.bars[i];
          if (i > start && (bar.keySignature !== old || bar.keySignatureType !== oldT)) break;
          bar.keySignature = ks;
          bar.keySignatureType = kt;
        }
      }
    }
    this.commit(true);
  }

  // ---------- overflow ----------
  /** move beats that don't fit into the following bars (current track only) */
  autoReflow = true;

  private reflowCurrent() {
    if (!this.autoReflow || this.isDrums === undefined) return;
    const cur = this.beat;
    const st = this.staff;
    let b = this.cursor.bar;
    let guard = 0;
    while (b < st.bars.length && guard++ < 2000) {
      const voice = st.bars[b].voices[0];
      const total = barTicks(this.score.masterBars[b]);
      let acc = 0;
      let cut = -1;
      for (let k = 0; k < voice.beats.length; k++) {
        if (acc >= total - 0.5) {
          cut = k;
          break;
        }
        acc += beatTicks(voice.beats[k]);
      }
      if (cut < 0) break;
      const moved = voice.beats.splice(cut).filter((x) => !x.isEmpty);
      if (!voice.beats.length) voice.addBeat(newBeat(this.duration, true));
      if (!moved.length) break;
      if (b + 1 >= this.score.masterBars.length) this.appendBar();
      const next = st.bars[b + 1].voices[0];
      if (next.beats.every((x) => x.isEmpty)) next.beats.splice(0);
      next.beats.unshift(...moved);
      for (const m of moved) m.voice = next;
      b++;
    }
    // keep the cursor on the beat it was on
    for (let bi = 0; bi < st.bars.length; bi++) {
      const k = st.bars[bi].voices[0].beats.indexOf(cur);
      if (k >= 0) {
        this.cursor.bar = bi;
        this.cursor.beat = k;
        break;
      }
    }
  }

  // ---------- transpose ----------
  /**
   * Transpose by semitones. scope: current selection (or beat), current track, or all tracks.
   * Notes stay on their string when possible, otherwise move to the nearest string that fits.
   */
  transpose(semitones: number, scope: 'selection' | 'track' | 'song'): number {
    if (!semitones) return 0;
    const jobs: { staff: alphaTab.model.Staff; beats: Beat[] }[] = [];
    if (scope === 'selection') {
      const beats: Beat[] = [];
      const { start, end } = this.selection();
      for (let b = start.bar; b <= end.bar; b++) {
        const bs = this.staff.bars[b].voices[0].beats;
        const from = b === start.bar ? start.beat : 0;
        const to = b === end.bar ? end.beat : bs.length - 1;
        beats.push(...bs.slice(from, to + 1));
      }
      jobs.push({ staff: this.staff, beats });
    } else {
      const tracks = scope === 'track' ? [this.track] : this.score.tracks;
      for (const tr of tracks) {
        const st = tr.staves[0];
        const beats: Beat[] = [];
        for (const bar of st.bars) for (const v of bar.voices) beats.push(...v.beats);
        jobs.push({ staff: st, beats });
      }
    }
    this.begin();
    let count = 0;
    for (const { staff, beats } of jobs) {
      if (staff.isPercussion) continue;
      const tun = staff.tuning;
      const n = tun.length;
      const pitchOf = (s: number) => tun[n - s];
      for (const b of beats) {
        const used = new Set<number>();
        // higher notes first when going up (and vice versa) so strings don't collide
        const notes = b.notes.slice().sort((a, c) => (semitones > 0 ? c.string - a.string : a.string - c.string));
        for (const note of notes) {
          const target = pitchOf(note.string) + note.fret + semitones;
          let s = note.string;
          let f = target - pitchOf(s);
          if (f < 0 || f > 29 || used.has(s)) {
            let best = -1;
            for (let c = 1; c <= n; c++) {
              const ff = target - pitchOf(c);
              if (ff >= 0 && ff <= 29 && !used.has(c) && (best < 0 || Math.abs(c - note.string) < Math.abs(best - note.string))) best = c;
            }
            if (best > 0) {
              s = best;
              f = target - pitchOf(s);
            } else {
              f = Math.max(0, Math.min(29, f));
            }
          }
          note.string = s;
          note.fret = f;
          used.add(s);
          count++;
        }
      }
    }
    this.commit(true);
    return count;
  }

  toggleRepeatStart() {
    this.begin();
    this.masterBar.isRepeatStart = !this.masterBar.isRepeatStart;
    this.commit(true);
  }

  toggleRepeatEnd() {
    this.begin();
    this.masterBar.repeatCount = this.masterBar.repeatCount > 0 ? 0 : 2;
    this.commit(true);
  }

  // ---------- beat ops ----------
  private ensureNotRest(b: Beat) {
    b.isEmpty = false;
  }

  typeDigit(d: number): alphaTab.model.Note | null {
    if (this.isDrums) return null;
    const now = performance.now();
    const key = `${this.cursor.track}/${this.cursor.bar}/${this.cursor.beat}/${this.cursor.row}`;
    let fret = d;
    if (this.lastDigit && this.lastDigit.key === key && now - this.lastDigit.time < 1000) {
      const combined = this.lastDigit.value * 10 + d;
      if (combined <= 29) fret = combined;
    }
    this.lastDigit = { time: now, key, value: fret };
    return this.setFret(fret);
  }

  setFret(fret: number) {
    this.begin();
    const b = this.beat;
    this.ensureNotRest(b);
    let n = b.notes.find((x) => x.string === this.string);
    if (!n) {
      n = new m.Note();
      n.string = this.string;
      b.addNote(n);
    }
    n.fret = fret;
    n.isTieDestination = false;
    n.isDead = false;
    this.commit();
    return this.noteAtCursor();
  }

  toggleDrum() {
    if (!this.isDrums) return null;
    this.begin();
    const b = this.beat;
    const midi = DRUM_LANES[this.cursor.row].midi;
    const existing = b.notes.find((n) => n.percussionArticulation === midi);
    if (existing) {
      b.removeNote(existing);
    } else {
      const n = new m.Note();
      n.percussionArticulation = midi;
      n.string = -1;
      n.fret = -1;
      b.addNote(n);
    }
    this.ensureNotRest(b);
    this.commit();
    return this.noteAtCursor();
  }

  deleteNote() {
    const n = this.noteAtCursor();
    this.begin();
    if (n) {
      this.beat.removeNote(n);
    } else if (this.voice.beats.length > 1) {
      // empty position: remove whole beat
      this.voice.beats.splice(this.cursor.beat, 1);
      if (this.cursor.beat >= this.voice.beats.length) this.cursor.beat = this.voice.beats.length - 1;
    } else {
      this.undoStack.pop();
      return;
    }
    this.commit();
  }

  deleteBeat() {
    this.begin();
    if (this.voice.beats.length > 1) {
      this.voice.beats.splice(this.cursor.beat, 1);
    } else {
      this.beat.notes.splice(0);
    }
    this.commit();
  }

  insertBeat() {
    this.begin();
    const nb = newBeat(this.duration);
    nb.duration = this.beat.duration;
    this.voice.beats.splice(this.cursor.beat, 0, nb);
    nb.voice = this.voice;
    this.reflowCurrent();
    this.commit();
  }

  toggleRest() {
    this.begin();
    const b = this.beat;
    b.notes.splice(0);
    b.isEmpty = false;
    this.commit();
  }

  changeDuration(dir: 1 | -1) {
    // dir +1: shorter note (8 -> 16), -1: longer
    const b = this.beat;
    const i = DURATIONS.indexOf(b.duration as number);
    const ni = Math.max(0, Math.min(DURATIONS.length - 1, (i < 0 ? 2 : i) + dir));
    this.begin();
    b.duration = DURATIONS[ni] as alphaTab.model.Duration;
    this.duration = DURATIONS[ni];
    this.reflowCurrent();
    this.commit();
  }

  setDuration(d: number) {
    this.begin();
    this.beat.duration = d as alphaTab.model.Duration;
    this.duration = d;
    this.reflowCurrent();
    this.commit();
  }

  toggleDot() {
    this.begin();
    this.beat.dots = this.beat.dots === 1 ? 0 : 1;
    this.reflowCurrent();
    this.commit();
  }

  toggleTriplet() {
    this.begin();
    const b = this.beat;
    if (b.tupletNumerator === 3) {
      b.tupletNumerator = -1;
      b.tupletDenominator = -1;
    } else {
      b.tupletNumerator = 3;
      b.tupletDenominator = 2;
    }
    this.reflowCurrent();
    this.commit();
  }

  // ---------- note effects ----------
  private findPrevNoteOnString(): alphaTab.model.Note | null {
    let b: Beat | null = this.beat.previousBeat;
    while (b) {
      const n = b.notes.find((x) => x.string === this.string);
      if (n) return n;
      if (!b.isRest) return null;
      b = b.previousBeat;
    }
    return null;
  }

  toggleTie() {
    if (this.isDrums) return;
    const n = this.noteAtCursor();
    const prev = this.findPrevNoteOnString();
    this.begin();
    if (n) {
      n.isTieDestination = !n.isTieDestination;
      if (n.isTieDestination && prev) n.fret = prev.fret;
    } else if (prev) {
      const nn = new m.Note();
      nn.string = this.string;
      nn.fret = prev.fret;
      nn.isTieDestination = true;
      this.ensureNotRest(this.beat);
      this.beat.addNote(nn);
    } else {
      this.undoStack.pop();
      return;
    }
    this.commit();
  }

  private toggleNoteFlag(fn: (n: alphaTab.model.Note) => void) {
    const n = this.noteAtCursor();
    if (!n) return;
    this.begin();
    fn(n);
    this.commit();
  }

  toggleHammer() {
    this.toggleNoteFlag((n) => {
      const on = !(n.isHammerPullOrigin || this.pendingHammer.has(n.id));
      n.isHammerPullOrigin = on;
      if (on) this.pendingHammer.add(n.id);
      else this.pendingHammer.delete(n.id);
    });
  }
  toggleDead() { this.toggleNoteFlag((n) => (n.isDead = !n.isDead)); }
  toggleGhost() { this.toggleNoteFlag((n) => (n.isGhost = !n.isGhost)); }
  toggleLetRing() { this.toggleNoteFlag((n) => (n.isLetRing = !n.isLetRing)); }
  toggleVibrato() {
    this.toggleNoteFlag((n) => (n.vibrato = n.vibrato ? alphaTab.model.VibratoType.None : alphaTab.model.VibratoType.Slight));
  }
  toggleSlide() {
    this.toggleNoteFlag((n) => (n.slideOutType = n.slideOutType ? alphaTab.model.SlideOutType.None : alphaTab.model.SlideOutType.Legato));
  }
  toggleBend() {
    this.toggleNoteFlag((n) => {
      if (n.hasBend) {
        n.bendPoints = null;
        n.bendType = alphaTab.model.BendType.None;
      } else {
        // full step bend
        n.addBendPoint(new m.BendPoint(0, 0));
        n.addBendPoint(new m.BendPoint(15, 4));
        n.addBendPoint(new m.BendPoint(60, 4));
        n.bendType = alphaTab.model.BendType.Bend;
      }
    });
  }
  togglePalmMute() {
    const b = this.beat;
    if (!b.notes.length) return;
    this.begin();
    const on = !b.notes.every((n) => n.isPalmMute);
    b.notes.forEach((n) => (n.isPalmMute = on));
    this.commit();
  }
  toggleAccent() {
    this.toggleNoteFlag((n) => (n.accentuated = n.accentuated ? alphaTab.model.AccentuationType.None : alphaTab.model.AccentuationType.Normal));
  }

  transposeNote(d: number) {
    const n = this.noteAtCursor();
    if (!n || this.isDrums) return;
    this.begin();
    n.fret = Math.max(0, Math.min(29, n.fret + d));
    this.commit();
    return this.noteAtCursor();
  }

  // ---------- selection ----------
  selAnchor: { bar: number; beat: number } | null = null;

  get hasSelection() {
    return !!this.selAnchor;
  }

  /** normalized selection (inclusive); falls back to the cursor beat */
  selection(): { start: Pos; end: Pos } {
    const c = { bar: this.cursor.bar, beat: this.cursor.beat };
    const a = this.selAnchor ?? c;
    const before = a.bar < c.bar || (a.bar === c.bar && a.beat <= c.beat);
    return before ? { start: { ...a }, end: c } : { start: c, end: { ...a } };
  }

  clearSelection() {
    this.selAnchor = null;
  }

  private startSel() {
    if (!this.selAnchor) this.selAnchor = { bar: this.cursor.bar, beat: this.cursor.beat };
  }

  selNext() {
    this.startSel();
    const c = this.cursor;
    if (c.beat < this.voice.beats.length - 1) c.beat++;
    else if (c.bar < this.score.masterBars.length - 1) { c.bar++; c.beat = 0; }
  }

  selPrev() {
    this.startSel();
    const c = this.cursor;
    if (c.beat > 0) c.beat--;
    else if (c.bar > 0) { c.bar--; c.beat = this.voice.beats.length - 1; }
  }

  selNextBar() {
    this.startSel();
    const c = this.cursor;
    const last = this.voice.beats.length - 1;
    if (c.beat < last) c.beat = last;
    else if (c.bar < this.score.masterBars.length - 1) { c.bar++; c.beat = this.voice.beats.length - 1; }
  }

  selPrevBar() {
    this.startSel();
    const c = this.cursor;
    if (c.beat > 0) c.beat = 0;
    else if (c.bar > 0) { c.bar--; c.beat = 0; }
  }

  selectAll() {
    this.selAnchor = { bar: 0, beat: 0 };
    this.cursor.bar = this.score.masterBars.length - 1;
    this.cursor.beat = this.voice.beats.length - 1;
  }

  /** beats of the current track covered by the selection, per bar */
  private forSelection(fn: (bar: Bar, from: number, to: number) => void) {
    const { start, end } = this.selection();
    for (let b = start.bar; b <= end.bar; b++) {
      const bar = this.staff.bars[b];
      const n = bar.voices[0].beats.length;
      const from = b === start.bar ? start.beat : 0;
      const to = b === end.bar ? end.beat : n - 1;
      fn(bar, Math.min(from, n - 1), Math.min(to, n - 1));
    }
  }

  // ---------- clipboard ----------
  private clip: { json: string; track: number; start: Pos; end: Pos; fullBars: boolean; drums: boolean; strings: number } | null = null;

  get hasClip() { return !!this.clip; }

  copy(): string {
    const { start, end } = this.selection();
    const lastOfEnd = this.staff.bars[end.bar].voices[0].beats.length - 1;
    // whole bars only if the selection covers complete, filled bars;
    // everything else (e.g. 2 notes in a half-empty bar) is copied as single beats
    let barsFilled = true;
    for (let b = start.bar; b <= end.bar; b++) {
      if (voiceTicks(this.staff.bars[b]) < barTicks(this.score.masterBars[b])) barsFilled = false;
    }
    const fullBars = this.hasSelection && start.beat === 0 && end.beat >= lastOfEnd && barsFilled;
    this.clip = {
      json: snapshot(this.score),
      track: this.cursor.track,
      start, end, fullBars,
      drums: this.isDrums,
      strings: this.stringCount,
    };
    const bars = end.bar - start.bar + 1;
    if (fullBars) return bars === 1 ? t('1 Takt kopiert') : t('{n} Takte kopiert', { n: bars });
    let count = 0;
    this.forSelection((_b, f, t) => (count += t - f + 1));
    return count === 1 ? t('1 Schlag kopiert') : t('{n} Schläge kopiert', { n: count });
  }

  /** delete the beats in the selection (or the current beat) */
  deleteSelection() {
    this.begin();
    const { start } = this.selection();
    this.forSelection((bar, from, to) => {
      const v = bar.voices[0];
      v.beats.splice(from, to - from + 1);
      if (v.beats.length === 0) v.addBeat(newBeat(this.duration, true));
    });
    this.cursor.bar = start.bar;
    this.cursor.beat = start.beat;
    this.selAnchor = null;
    this.commit();
  }

  cut(): string {
    this.copy();
    const msg = t('Ausgeschnitten');
    this.deleteSelection();
    return msg;
  }

  /** take beats out of the clip snapshot, ready to be inserted into this track */
  private clipBeats(): Beat[][] | string {
    const c = this.clip!;
    if (c.drums !== this.isDrums) return c.drums ? t('Drums lassen sich nur in eine Drum-Spur einfügen') : t('Noten lassen sich nicht in eine Drum-Spur einfügen');
    const src = restore(c.json, this.settings);
    const st = src.tracks[c.track]?.staves[0];
    if (!st) return t('Zwischenablage ist leer');
    const shift = this.stringCount - c.strings;
    const out: Beat[][] = [];
    for (let b = c.start.bar; b <= c.end.bar; b++) {
      const beats = st.bars[b].voices[0].beats;
      const from = b === c.start.bar ? c.start.beat : 0;
      const to = b === c.end.bar ? c.end.beat : beats.length - 1;
      const list: Beat[] = [];
      for (const beat of beats.slice(from, to + 1)) {
        if (beat.isEmpty && !c.fullBars) continue; // skip untouched placeholders
        beat.id = new m.Beat().id; // fresh ids
        for (const n of beat.notes.slice()) {
          n.id = new m.Note().id;
          if (!c.drums && shift !== 0) {
            n.string += shift;
            if (n.string < 1 || n.string > this.stringCount) beat.removeNote(n);
          }
        }
        list.push(beat);
      }
      out.push(list);
    }
    return out;
  }

  /**
   * Paste. Whole bars overwrite bars from the cursor bar on (insertBars: insert them before).
   * Single beats are inserted at the cursor.
   */
  paste(insertBars = false): string | null {
    if (!this.clip) return t('Nichts kopiert');
    const parts = this.clipBeats();
    if (typeof parts === 'string') return parts;
    this.begin();
    const st = this.staff;
    if (this.clip.fullBars) {
      const startBar = this.cursor.bar;
      if (insertBars) {
        for (let k = 0; k < parts.length; k++) this.insertBarAt(startBar);
      }
      for (let k = 0; k < parts.length; k++) {
        const bi = startBar + k;
        if (bi >= this.score.masterBars.length) this.appendBar();
        const v = st.bars[bi].voices[0];
        v.beats.splice(0);
        for (const b of parts[k]) v.addBeat(b);
        if (!v.beats.length) v.addBeat(newBeat(this.duration, true));
      }
      this.cursor.bar = startBar + parts.length - 1;
      this.cursor.beat = 0;
    } else {
      const flat = parts.flat();
      const v = this.voice;
      let at = this.cursor.beat;
      // replace an untouched placeholder
      if (this.beat.isEmpty) v.beats.splice(at, 1);
      for (const b of flat) {
        v.beats.splice(at++, 0, b);
        b.voice = v;
      }
      this.cursor.beat = at - 1;
      this.reflowCurrent();
    }
    this.selAnchor = null;
    this.commit(true);
    return null;
  }

  // ---------- tracks ----------
  addTrack(p: Preset) {
    this.begin();
    addTrack(this.score, p);
    this.commit(true);
    this.cursor.track = this.score.tracks.length - 1;
    this.clamp();
    this.onChange(true);
  }

  removeTrack(i: number) {
    if (this.score.tracks.length <= 1) return;
    this.begin();
    this.score.tracks.splice(i, 1);
    this.score.tracks.forEach((t, k) => (t.index = k));
    if (this.cursor.track >= this.score.tracks.length) this.cursor.track = this.score.tracks.length - 1;
    this.commit(true);
  }

  renameTrack(i: number, name: string) {
    this.begin();
    this.score.tracks[i].name = name;
    this.score.tracks[i].shortName = name.substring(0, 4);
    this.commit(true);
  }

  setTrackProgram(i: number, program: number) {
    this.begin();
    const tr = this.score.tracks[i];
    tr.playbackInfo.program = program;
    // alphaTab keeps an instrument automation on the first beat; it would override the new sound
    const Instrument = alphaTab.model.AutomationType.Instrument;
    for (const st of tr.staves) {
      for (const v of st.bars[0]?.voices ?? []) {
        const first = v.beats[0];
        if (!first) continue;
        for (const a of first.automations) if (a.type === Instrument) a.value = program;
      }
    }
    this.commit(true);
  }

  /**
   * Change tuning of a track. tunings: high -> low (alphaTab order).
   * keepPitch: frets are recalculated so the music sounds the same.
   */
  setTuning(i: number, tunings: number[], keepPitch: boolean, name = '') {
    const t = this.score.tracks[i];
    const st = t.staves[0];
    if (st.isPercussion || !tunings.length) return;
    const oldT = st.tuning.slice();
    const oldN = oldT.length;
    const newN = tunings.length;
    this.begin();
    // string numbers: 1 = lowest. Strings are matched from the top (highest) string.
    const shift = newN - oldN;
    const pitchOf = (n: number, count: number, tun: number[]) => tun[count - n];
    for (const st2 of t.staves) {
      for (const bar of st2.bars) {
        for (const v of bar.voices) {
          for (const b of v.beats) {
            for (const n of b.notes.slice()) {
              if (n.string < 1) continue;
              const oldPitch = pitchOf(n.string, oldN, oldT) + n.fret;
              let s = n.string + shift;
              if (s < 1 || s > newN) {
                if (!keepPitch) {
                  b.removeNote(n);
                  continue;
                }
                s = Math.max(1, Math.min(newN, s));
              }
              let fret = n.fret;
              if (keepPitch) {
                fret = oldPitch - pitchOf(s, newN, tunings);
                if (fret < 0 || fret > 29) {
                  // try another free string that can play this pitch
                  const used = new Set(b.notes.filter((x) => x !== n).map((x) => x.string));
                  let best = -1;
                  for (let c = 1; c <= newN; c++) {
                    const f = oldPitch - pitchOf(c, newN, tunings);
                    if (f >= 0 && f <= 29 && !used.has(c) && (best < 0 || Math.abs(c - s) < Math.abs(best - s))) best = c;
                  }
                  if (best > 0) {
                    s = best;
                    fret = oldPitch - pitchOf(s, newN, tunings);
                  } else {
                    fret = Math.max(0, Math.min(29, fret));
                  }
                }
              }
              n.string = s;
              n.fret = fret;
            }
          }
        }
      }
      st2.stringTuning = new alphaTab.model.Tuning(name, tunings.slice(), false);
    }
    this.cursor.row = Math.min(this.cursor.row, newN - 1);
    this.commit(true);
  }

  setTitle(title: string) {
    this.begin();
    this.score.title = title;
    this.commit(true);
  }

  mutate(fn: (s: Score) => void, structural = true) {
    this.begin();
    fn(this.score);
    this.commit(structural);
  }

  /** absolute tick of the cursor beat (ignores repeats) */
  cursorTick(): number {
    let t = 0;
    for (let i = 0; i < this.cursor.bar; i++) t += barTicks(this.score.masterBars[i]);
    for (let i = 0; i < this.cursor.beat; i++) t += beatTicks(this.voice.beats[i]);
    return t;
  }
}
