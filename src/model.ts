// Score building helpers on top of the alphaTab model.
import * as alphaTab from '@coderline/alphatab';
import { t as tr } from './i18n';

const m = alphaTab.model;
export type Score = alphaTab.model.Score;
export type Track = alphaTab.model.Track;
export type Beat = alphaTab.model.Beat;
export type Bar = alphaTab.model.Bar;

export type Kind = 'guitar' | 'bass' | 'drums' | 'synth';

export interface Preset {
  kind: Kind;
  label: string;
  name: string;
  program: number;
  tuning: number[]; // high -> low (alphaTab order)
}

export const PRESETS: Preset[] = [
  { kind: 'guitar', label: 'Gitarre (clean)', name: 'Gitarre', program: 27, tuning: [64, 59, 55, 50, 45, 40] },
  { kind: 'guitar', label: 'Gitarre (verzerrt)', name: 'Gitarre', program: 30, tuning: [64, 59, 55, 50, 45, 40] },
  { kind: 'guitar', label: 'Gitarre (akustisch)', name: 'Akustik', program: 25, tuning: [64, 59, 55, 50, 45, 40] },
  { kind: 'bass', label: 'Bass (4 Saiten)', name: 'Bass', program: 33, tuning: [43, 38, 33, 28] },
  { kind: 'bass', label: 'Bass (5 Saiten)', name: 'Bass', program: 33, tuning: [43, 38, 33, 28, 23] },
  { kind: 'drums', label: 'Drums', name: 'Drums', program: 0, tuning: [] },
  { kind: 'synth', label: 'Synth Lead', name: 'Synth', program: 81, tuning: [64, 59, 55, 50, 45, 40] },
  { kind: 'synth', label: 'Synth Pad', name: 'Pad', program: 89, tuning: [64, 59, 55, 50, 45, 40] },
  { kind: 'synth', label: 'Piano', name: 'Piano', program: 0, tuning: [64, 59, 55, 50, 45, 40] },
];

// Drum lanes, top -> bottom (GM drum note numbers).
export const DRUM_LANES: { name: string; midi: number }[] = [
  { name: 'Crash', midi: 49 },
  { name: 'Ride', midi: 51 },
  { name: 'Hi-Hat offen', midi: 46 },
  { name: 'Hi-Hat zu', midi: 42 },
  { name: 'Tom hoch', midi: 48 },
  { name: 'Tom mittel', midi: 45 },
  { name: 'Snare', midi: 38 },
  { name: 'Tom tief', midi: 41 },
  { name: 'Kick', midi: 36 },
  { name: 'Hi-Hat Pedal', midi: 44 },
];

export function drumLaneName(midi: number): string {
  return DRUM_LANES.find((l) => l.midi === midi)?.name ?? `Drum ${midi}`;
}

/** empty = placeholder beat (not a rest), like an untouched position in GP5 */
export function newBeat(duration: number, empty = false): Beat {
  const b = new m.Beat();
  b.duration = duration as alphaTab.model.Duration;
  b.isEmpty = empty;
  return b;
}

export function newBar(duration = 4): Bar {
  const bar = new m.Bar();
  const v = new m.Voice();
  bar.addVoice(v);
  v.addBeat(newBeat(duration, true));
  return bar;
}

function usedChannels(score: Score): Set<number> {
  const s = new Set<number>();
  for (const t of score.tracks) {
    s.add(t.playbackInfo.primaryChannel);
    s.add(t.playbackInfo.secondaryChannel);
  }
  return s;
}

function freeChannel(used: Set<number>): number {
  for (let c = 0; c < 16; c++) {
    if (c === 9) continue;
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
  }
  return 0;
}

export function addTrack(score: Score, preset: Preset): Track {
  const t = new m.Track();
  t.name = tr(preset.name);
  t.shortName = t.name.substring(0, 4);
  const pi = t.playbackInfo;
  pi.program = preset.program;
  pi.volume = 13;
  pi.balance = 8;
  if (preset.kind === 'drums') {
    pi.primaryChannel = 9;
    pi.secondaryChannel = 9;
  } else {
    const used = usedChannels(score);
    pi.primaryChannel = freeChannel(used);
    pi.secondaryChannel = freeChannel(used);
  }
  const st = new m.Staff();
  if (preset.kind === 'drums') {
    st.isPercussion = true;
    st.showTablature = false;
    st.showStandardNotation = true;
    st.stringTuning = new m.Tuning('', [], false);
  } else {
    st.stringTuning = new m.Tuning('', preset.tuning.slice(), true);
    st.showTablature = true;
    st.showStandardNotation = true;
    if (preset.kind === 'bass') {
      st.transpositionPitch = 0;
      st.displayTranspositionPitch = -12;
    } else if (preset.kind === 'guitar') {
      st.displayTranspositionPitch = -12;
    }
  }
  t.addStaff(st);
  score.addTrack(t);
  if (preset.kind === 'bass') {
    // bass clef
    for (let i = 0; i < score.masterBars.length; i++) {
      const bar = newBar();
      bar.clef = alphaTab.model.Clef.F4;
      st.addBar(bar);
    }
  } else {
    for (let i = 0; i < score.masterBars.length; i++) {
      const bar = newBar();
      if (preset.kind === 'drums') bar.clef = alphaTab.model.Clef.Neutral;
      st.addBar(bar);
    }
  }
  return t;
}

export function newMasterBar(prev: alphaTab.model.MasterBar | null): alphaTab.model.MasterBar {
  const mb = new m.MasterBar();
  mb.timeSignatureNumerator = prev?.timeSignatureNumerator ?? 4;
  mb.timeSignatureDenominator = prev?.timeSignatureDenominator ?? 4;
  return mb;
}

export function createEmptyScore(): Score {
  const score = new m.Score();
  score.title = tr('Neuer Song');
  const mb = newMasterBar(null);
  const tempo = new m.Automation();
  tempo.type = alphaTab.model.AutomationType.Tempo;
  tempo.value = 120;
  tempo.isLinear = false;
  tempo.ratioPosition = 0;
  mb.tempoAutomations.push(tempo);
  score.addMasterBar(mb);
  addTrack(score, PRESETS[0]);
  return score;
}

export function getTempo(score: Score): number {
  const a = score.masterBars[0]?.tempoAutomations?.[0];
  return a ? a.value : 120;
}

export function setTempo(score: Score, bpm: number) {
  const mb = score.masterBars[0];
  let a = mb.tempoAutomations[0];
  if (!a) {
    a = new m.Automation();
    a.type = alphaTab.model.AutomationType.Tempo;
    a.ratioPosition = 0;
    mb.tempoAutomations.push(a);
  }
  a.value = bpm;
}

export function trackKind(t: Track): Kind {
  if (t.staves[0]?.isPercussion) return 'drums';
  const p = t.playbackInfo.program;
  if (p >= 32 && p <= 39) return 'bass';
  if (p >= 24 && p <= 31) return 'guitar';
  return 'synth';
}

/** Deep copy + finish via JSON roundtrip. Gives a clean, consistent model. */
export function rebuild(score: Score, settings: alphaTab.Settings): Score {
  const json = alphaTab.model.JsonConverter.scoreToJsObject(score);
  return alphaTab.model.JsonConverter.jsObjectToScore(json, settings);
}

export function snapshot(score: Score): string {
  return alphaTab.model.JsonConverter.scoreToJson(score);
}

export function restore(json: string, settings: alphaTab.Settings): Score {
  return alphaTab.model.JsonConverter.jsonToScore(json, settings);
}

// ---- ticks ----
export const QUARTER = 960;

export function beatTicks(b: Beat): number {
  let t = (QUARTER * 4) / (b.duration as number);
  if (b.dots === 1) t *= 1.5;
  else if (b.dots === 2) t *= 1.75;
  if (b.tupletNumerator > 0 && b.tupletDenominator > 0) t = (t * b.tupletDenominator) / b.tupletNumerator;
  return t;
}

export function barTicks(mb: alphaTab.model.MasterBar): number {
  return (QUARTER * 4 * mb.timeSignatureNumerator) / mb.timeSignatureDenominator;
}

export function voiceTicks(bar: Bar): number {
  return bar.voices[0].beats.reduce((s, b) => s + beatTicks(b), 0);
}
