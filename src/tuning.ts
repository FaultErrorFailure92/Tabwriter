// Tuning text <-> MIDI helpers. Text is written low -> high, e.g. "D A D G B E" or "D2 A2 D3 G3 B3 E4".
import * as alphaTab from '@coderline/alphatab';
import { t } from './i18n';

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, H: 11, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi: number, withOctave = true): string {
  return NAMES[midi % 12] + (withOctave ? String(Math.floor(midi / 12) - 1) : '');
}

/** tunings high->low  =>  "E2 A2 D3 G3 B3 E4" */
export function tuningToText(tunings: number[]): string {
  return tunings.slice().reverse().map((m) => noteName(m)).join(' ');
}

/**
 * Parse low->high text. Notes without octave are placed just above the previous string;
 * the lowest one is placed closest to `lowestHint`.
 * Returns high->low array or an error string.
 */
export function parseTuning(text: string, lowestHint: number): number[] | string {
  const tokens = text.trim().split(/[\s,;-]+/).filter(Boolean);
  if (tokens.length < 1) return t('Keine Töne angegeben');
  if (tokens.length > 10) return t('Maximal 10 Saiten');
  const out: number[] = [];
  for (const tok of tokens) {
    const m = tok.match(/^([A-Ha-h])([#♯b♭]?)(-?\d)?$/);
    if (!m) return t('„{x}" ist kein Ton', { x: tok });
    let pc = PC[m[1].toUpperCase()];
    if (m[2] === '#' || m[2] === '♯') pc += 1;
    if (m[2] === 'b' || m[2] === '♭') pc -= 1;
    pc = (pc + 12) % 12;
    let midi: number;
    if (m[3] !== undefined) {
      midi = (parseInt(m[3]) + 1) * 12 + pc;
    } else if (out.length === 0) {
      // closest to hint
      midi = pc + 12 * Math.round((lowestHint - pc) / 12);
    } else {
      const prev = out[out.length - 1];
      midi = pc;
      while (midi <= prev) midi += 12;
    }
    if (midi < 12 || midi > 100) return t('„{x}" liegt außerhalb des Bereichs', { x: tok });
    out.push(midi);
  }
  return out.reverse();
}

export interface TuningPreset {
  name: string;
  tunings: number[]; // high -> low
}

/** Presets for the given string count first, then other common counts. */
export function tuningPresets(): { group: string; presets: TuningPreset[] }[] {
  const groups: { group: string; presets: TuningPreset[] }[] = [];
  for (const n of [6, 7, 4, 5]) {
    const list = alphaTab.model.Tuning.getPresetsFor(n).map((t) => ({ name: t.name, tunings: t.tunings.slice() }));
    // a few additions alphaTab doesn't list
    if (n === 7) {
      list.push({ name: 'Guitar 7 strings Drop A', tunings: [64, 59, 55, 50, 45, 40, 33] });
    }
    if (n === 6) {
      list.splice(1, 0, { name: 'Guitar Drop C#', tunings: [63, 58, 54, 49, 44, 37] });
      list.splice(1, 0, { name: 'Guitar D Standard', tunings: [62, 57, 53, 48, 43, 38] });
      list.splice(1, 0, { name: 'Guitar C Standard', tunings: [60, 55, 51, 46, 41, 36] });
      list.splice(1, 0, { name: 'Guitar Drop B', tunings: [61, 56, 52, 47, 42, 35] });
    }
    groups.push({ group: t('{n} Saiten', { n }), presets: list });
  }
  return groups;
}

export function findPresetName(tunings: number[]): string {
  for (const g of tuningPresets()) {
    for (const p of g.presets) {
      if (p.tunings.length === tunings.length && p.tunings.every((v, i) => v === tunings[i])) return p.name;
    }
  }
  return '';
}
