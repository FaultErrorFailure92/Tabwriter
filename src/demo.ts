// A small demo song (guitar, bass, drums) for the first start.
import * as alphaTab from '@coderline/alphatab';
import { createEmptyScore, addTrack, PRESETS, newMasterBar, newBar, setTempo, rebuild } from './model';
import { t } from './i18n';

const m = alphaTab.model;
type Chord = [number, number][]; // [string (1 = lowest), fret]

const E5: Chord = [[1, 0], [2, 2]];
const G5: Chord = [[1, 3], [2, 5]];
const A5: Chord = [[1, 5], [2, 7]];
const D5: Chord = [[2, 5], [3, 7]];
const C5: Chord = [[2, 3], [3, 5]];
const B5: Chord = [[2, 2], [3, 4]];

const GUITAR: Chord[][] = [
  [E5, E5, E5, E5, G5, G5, A5, A5],
  [E5, E5, E5, E5, D5, D5, C5, B5],
  [E5, E5, E5, E5, G5, G5, A5, A5],
  [E5, E5, G5, G5, A5, A5, E5, E5],
];
const PALM = [true, true, true, true, false, false, false, false];

function bassOf(c: Chord): Chord {
  // root note one octave down on the bass (E string = 1, A string = 2)
  const [s, f] = c[0];
  return [[s, f]];
}

export function buildDemo(settings: alphaTab.Settings): alphaTab.model.Score {
  const score = createEmptyScore();
  score.title = t('Demo-Song');
  score.artist = 'Tabwriter';
  setTempo(score, 110);
  addTrack(score, PRESETS.find((p) => p.kind === 'bass' && p.tuning.length === 4)!);
  addTrack(score, PRESETS.find((p) => p.kind === 'drums')!);
  score.tracks[0].playbackInfo.program = 30; // distortion

  // 4 bars
  while (score.masterBars.length < GUITAR.length) {
    const mb = newMasterBar(score.masterBars[score.masterBars.length - 1]);
    score.addMasterBar(mb);
    for (const tr of score.tracks) {
      const st = tr.staves[0];
      const bar = newBar(8);
      bar.clef = st.bars[0].clef;
      st.addBar(bar);
    }
  }
  score.masterBars[0].isRepeatStart = true;
  score.masterBars[GUITAR.length - 1].repeatCount = 2;

  GUITAR.forEach((chords, bi) => {
    // guitar
    fillBar(score.tracks[0].staves[0].bars[bi], chords.map((c, k) => ({ notes: c, palm: PALM[k] })));
    // bass
    fillBar(score.tracks[1].staves[0].bars[bi], chords.map((c) => ({ notes: bassOf(c), palm: false })));
    // drums: closed hi-hat 8ths, kick on 1 and 3 (+ "and" of 3), snare on 2 and 4
    const v = score.tracks[2].staves[0].bars[bi].voices[0];
    v.beats.splice(0);
    for (let k = 0; k < 8; k++) {
      const b = new m.Beat();
      b.duration = alphaTab.model.Duration.Eighth;
      const hits = [42];
      if (k === 0 || k === 4 || k === 5) hits.push(36);
      if (k === 2 || k === 6) hits.push(38);
      if (bi === 0 && k === 0) hits[0] = 49; // crash
      for (const h of hits) {
        const n = new m.Note();
        n.percussionArticulation = h;
        n.string = -1;
        n.fret = -1;
        b.addNote(n);
      }
      v.addBeat(b);
    }
  });
  return rebuild(score, settings);
}

function fillBar(bar: alphaTab.model.Bar, beats: { notes: Chord; palm: boolean }[]) {
  const v = bar.voices[0];
  v.beats.splice(0);
  for (const def of beats) {
    const b = new m.Beat();
    b.duration = alphaTab.model.Duration.Eighth;
    for (const [s, f] of def.notes) {
      const n = new m.Note();
      n.string = s;
      n.fret = f;
      n.isPalmMute = def.palm;
      b.addNote(n);
    }
    v.addBeat(b);
  }
}
