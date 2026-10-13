// Chord names from notes, and helpers to read chords / lyrics of a score.
import type * as alphaTab from '@coderline/alphatab';

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// intervals above the root -> suffix (most specific first)
const SHAPES: [number[], string][] = [
  [[0, 4, 7, 11], 'maj7'],
  [[0, 4, 7, 10], '7'],
  [[0, 3, 7, 10], 'm7'],
  [[0, 3, 6, 10], 'm7b5'],
  [[0, 3, 6, 9], 'dim7'],
  [[0, 4, 7, 9], '6'],
  [[0, 3, 7, 9], 'm6'],
  [[0, 4, 7, 2], 'add9'],
  [[0, 3, 7, 2], 'madd9'],
  [[0, 4, 7], ''],
  [[0, 3, 7], 'm'],
  [[0, 3, 6], 'dim'],
  [[0, 4, 8], 'aug'],
  [[0, 5, 7], 'sus4'],
  [[0, 2, 7], 'sus2'],
  [[0, 7], '5'],
];

/** best guess chord name for a set of MIDI notes, '' if nothing fits */
export function detectChord(midi: number[], flats = false): string {
  if (!midi.length) return '';
  const names = flats ? NAMES_FLAT : NAMES_SHARP;
  const bass = Math.min(...midi) % 12;
  const pcs = [...new Set(midi.map((m) => ((m % 12) + 12) % 12))];
  if (pcs.length === 1) return names[pcs[0]];
  let best: { name: string; score: number } | null = null;
  for (const root of pcs) {
    const iv = new Set(pcs.map((p) => (p - root + 12) % 12));
    for (const [shape, suf] of SHAPES) {
      if (!shape.every((s) => iv.has(s))) continue;
      const extra = iv.size - shape.length;
      // prefer: all notes explained, more notes in the shape, root in the bass
      const score = shape.length * 10 - extra * 15 + (root === bass ? 5 : 0);
      if (!best || score > best.score) {
        const slash = root !== bass ? `/${names[bass]}` : '';
        best = { name: names[root] + suf + slash, score };
      }
    }
  }
  return best && best.score > 0 ? best.name : '';
}

export function beatMidi(b: alphaTab.model.Beat): number[] {
  return b.notes.filter((n) => !n.isDead && !n.isTieDestination).map((n) => n.realValue);
}

export function chordOf(b: alphaTab.model.Beat): string {
  if (!b.chordId) return '';
  return b.voice.bar.staff.getChord(b.chordId)?.name ?? '';
}

export function lyricOf(b: alphaTab.model.Beat): string {
  return b.lyrics?.[0] ?? '';
}

/** joins syllables: "Hal-" + "lo" -> "Hallo", otherwise with spaces */
export function joinSyllables(parts: string[]): string {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    if (out && !out.endsWith('-')) out += ' ';
    if (out.endsWith('-')) out = out.slice(0, -1);
    out += p;
  }
  return out.replace(/-$/, '');
}
