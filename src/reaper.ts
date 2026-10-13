// Export for Reaper (or any DAW): one ZIP with
//  - tempo map + section markers as MIDI (Reaper: "Import tempo map" + markers)
//  - one MIDI file per track
//  - click track as WAV
// Repeats are played out, so everything lines up with the playback.
import * as alphaTab from '@coderline/alphatab';
import { exportMidi } from './midi';
import { zip } from './zip';

const PPQ = 960;

interface BarTime {
  index: number;
  start: number; // ticks
  end: number;
  num: number;
  den: number;
  section: string;
  tempos: { tick: number; bpm: number }[];
}

/** played order of bars with ticks and tempo (repeats expanded by alphaTab's generator) */
export function playedBars(score: alphaTab.model.Score, settings: alphaTab.Settings): BarTime[] {
  const mf = new alphaTab.midi.MidiFile();
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(mf, true);
  const gen = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
  gen.generate();
  return gen.tickLookup.masterBars.map((l) => ({
    index: l.masterBar.index,
    start: l.start,
    end: l.end,
    num: l.masterBar.timeSignatureNumerator,
    den: l.masterBar.timeSignatureDenominator,
    section: l.masterBar.section?.text ?? '',
    tempos: l.tempoChanges.map((c) => ({ tick: c.tick, bpm: c.tempo })),
  }));
}

// ---------- tiny SMF writer ----------
function vlq(n: number): number[] {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return out;
}

function track(events: { tick: number; data: number[] }[]): Uint8Array {
  events.sort((a, b) => a.tick - b.tick);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(Math.max(0, Math.round(e.tick - last))), ...e.data);
    last = Math.round(e.tick);
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  const out = new Uint8Array(8 + body.length);
  out.set([0x4d, 0x54, 0x72, 0x6b]);
  new DataView(out.buffer).setUint32(4, body.length);
  out.set(body, 8);
  return out;
}

function text(type: number, s: string): number[] {
  const b = Array.from(new TextEncoder().encode(s)).slice(0, 127);
  return [0xff, type, b.length, ...b];
}

/** tempo map, time signatures and markers in one MIDI file */
export function tempoMarkerMidi(bars: BarTime[], name: string): Uint8Array {
  const ev: { tick: number; data: number[] }[] = [{ tick: 0, data: text(0x03, name) }];
  let lastSig = '';
  let lastBpm = -1;
  for (const b of bars) {
    const sig = `${b.num}/${b.den}`;
    if (sig !== lastSig) {
      ev.push({ tick: b.start, data: [0xff, 0x58, 0x04, b.num, Math.round(Math.log2(b.den)), 24, 8] });
      lastSig = sig;
    }
    for (const t of b.tempos) {
      if (t.bpm === lastBpm) continue;
      const us = Math.round(60000000 / t.bpm);
      ev.push({ tick: t.tick, data: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] });
      lastBpm = t.bpm;
    }
    // a marker at every section start (again when a repeat plays it twice)
    if (b.section) ev.push({ tick: b.start, data: text(0x06, b.section) });
  }
  const head = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff]);
  const tr = track(ev);
  const out = new Uint8Array(head.length + tr.length);
  out.set(head);
  out.set(tr, head.length);
  return out;
}

// ---------- click ----------
/** seconds at a tick, using the tempo changes */
function timeline(bars: BarTime[]) {
  const changes = bars.flatMap((b) => b.tempos).sort((a, b) => a.tick - b.tick);
  if (!changes.length) changes.push({ tick: 0, bpm: 120 });
  return (tick: number) => {
    let sec = 0;
    let t0 = 0;
    let bpm = changes[0].bpm;
    for (const c of changes) {
      if (c.tick > tick) break;
      sec += ((c.tick - t0) / PPQ) * (60 / bpm);
      t0 = c.tick;
      bpm = c.bpm;
    }
    return sec + ((tick - t0) / PPQ) * (60 / bpm);
  };
}

export function clickWav(bars: BarTime[], sampleRate = 44100): Uint8Array {
  const at = timeline(bars);
  const endSec = at(bars.length ? bars[bars.length - 1].end : 0) + 0.5;
  const n = Math.ceil(endSec * sampleRate);
  const pcm = new Int16Array(n);
  const blip = (sec: number, hz: number, vol: number) => {
    const s0 = Math.round(sec * sampleRate);
    const len = Math.round(0.035 * sampleRate);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const env = Math.exp((-i / len) * 5);
      pcm[s0 + i] = Math.max(-32767, Math.min(32767, pcm[s0 + i] + Math.sin((2 * Math.PI * hz * i) / sampleRate) * env * vol * 32767));
    }
  };
  for (const b of bars) {
    const beat = (PPQ * 4) / b.den;
    for (let k = 0; k < b.num; k++) blip(at(b.start + k * beat), k === 0 ? 1600 : 1100, k === 0 ? 0.9 : 0.6);
  }
  const data = new Uint8Array(pcm.buffer);
  const out = new Uint8Array(44 + data.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data.length, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data.length, true);
  out.set(data, 44);
  return out;
}

// ---------- package ----------
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Song';

/** score with only one track (keeps the tempo and structure) */
function onlyTrack(score: alphaTab.model.Score, i: number, settings: alphaTab.Settings): alphaTab.model.Score {
  const o = JSON.parse(alphaTab.model.JsonConverter.scoreToJson(score));
  o.tracks = [o.tracks[i]];
  const s = alphaTab.model.JsonConverter.jsonToScore(JSON.stringify(o), settings);
  return s;
}

export function reaperZip(score: alphaTab.model.Score, settings: alphaTab.Settings, name: string): Uint8Array {
  const base = safe(name);
  const bars = playedBars(score, settings);
  const files: { name: string; data: Uint8Array }[] = [];
  files.push({ name: `${base}/${base} - Tempo & Marker.mid`, data: tempoMarkerMidi(bars, base) });
  score.tracks.forEach((t, i) => {
    const one = onlyTrack(score, i, settings);
    files.push({ name: `${base}/${String(i + 1).padStart(2, '0')} ${safe(t.name || `Spur ${i + 1}`)}.mid`, data: exportMidi(one, settings) });
  });
  files.push({ name: `${base}/${base} - Click.wav`, data: clickWav(bars) });
  return zip(files);
}
