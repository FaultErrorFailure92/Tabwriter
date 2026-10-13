// Fretboard panel: shows the notes of the cursor beat, scale tones, click to enter notes,
// and a small library of chord shapes.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];
export const NOTE_NAMES_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES: { id: string; label: string; steps: number[] }[] = [
  { id: 'major', label: 'Dur', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', label: 'Moll', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'pentaMaj', label: 'Pentatonik Dur', steps: [0, 2, 4, 7, 9] },
  { id: 'pentaMin', label: 'Pentatonik Moll', steps: [0, 3, 5, 7, 10] },
  { id: 'blues', label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  { id: 'dorian', label: 'Dorisch', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixo', label: 'Mixolydisch', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'harmMin', label: 'Harmonisch Moll', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'phryg', label: 'Phrygisch', steps: [0, 1, 3, 5, 7, 8, 10] },
];

/** chord shapes for standard tuning, frets high E -> low E, -1 = muted */
export const CHORDS: { name: string; frets: number[] }[] = [
  { name: 'C', frets: [0, 1, 0, 2, 3, -1] },
  { name: 'D', frets: [2, 3, 2, 0, -1, -1] },
  { name: 'E', frets: [0, 0, 1, 2, 2, 0] },
  { name: 'F', frets: [1, 1, 2, 3, 3, 1] },
  { name: 'G', frets: [3, 0, 0, 0, 2, 3] },
  { name: 'A', frets: [0, 2, 2, 2, 0, -1] },
  { name: 'H', frets: [2, 4, 4, 4, 2, -1] },
  { name: 'Am', frets: [0, 1, 2, 2, 0, -1] },
  { name: 'Dm', frets: [1, 3, 2, 0, -1, -1] },
  { name: 'Em', frets: [0, 0, 0, 2, 2, 0] },
  { name: 'Fm', frets: [1, 1, 1, 3, 3, 1] },
  { name: 'Gm', frets: [3, 3, 3, 5, 5, 3] },
  { name: 'Hm', frets: [2, 3, 4, 4, 2, -1] },
  { name: 'C7', frets: [0, 1, 3, 2, 3, -1] },
  { name: 'D7', frets: [2, 1, 2, 0, -1, -1] },
  { name: 'E7', frets: [0, 0, 1, 0, 2, 0] },
  { name: 'G7', frets: [1, 0, 0, 0, 2, 3] },
  { name: 'A7', frets: [0, 2, 0, 2, 0, -1] },
  { name: 'H7', frets: [2, 0, 2, 1, 2, -1] },
  { name: 'Am7', frets: [0, 1, 0, 2, 0, -1] },
  { name: 'Em7', frets: [0, 3, 0, 2, 2, 0] },
  { name: 'Dm7', frets: [1, 1, 2, 0, -1, -1] },
  { name: 'Cmaj7', frets: [0, 0, 0, 2, 3, -1] },
  { name: 'Fmaj7', frets: [0, 1, 2, 3, -1, -1] },
  { name: 'Dsus4', frets: [3, 3, 2, 0, -1, -1] },
  { name: 'Asus2', frets: [0, 0, 2, 2, 0, -1] },
  { name: 'E5', frets: [-1, -1, -1, -1, 2, 0] },
  { name: 'A5', frets: [-1, -1, -1, 2, 0, -1] },
  { name: 'D5', frets: [-1, -1, 7, 7, 5, -1] },
  { name: 'G5', frets: [-1, -1, -1, 5, 5, 3] },
];

export const STANDARD = [64, 59, 55, 50, 45, 40];

export interface FretState {
  tuning: number[]; // MIDI, high -> low
  frets: number;
  notes: { row: number; fret: number }[]; // cursor beat
  row: number; // cursor string
  root: number; // -1 = no scale
  scale: string;
  names: boolean;
  en: boolean;
}

const MARKS = [3, 5, 7, 9, 15, 17, 19, 21];

export function fretboardSvg(s: FretState, width: number): string {
  const n = s.tuning.length;
  const left = 34;
  const right = 12;
  const top = 14;
  const gap = 22;
  const h = top * 2 + gap * (n - 1) + 14;
  const fw = (width - left - right) / (s.frets + 0.6);
  const X = (f: number) => (f === 0 ? left + fw * 0.3 : left + fw * 0.6 + (f - 0.5) * fw);
  const Y = (r: number) => top + r * gap;
  const steps = SCALES.find((x) => x.id === s.scale)?.steps ?? [];
  const names = s.en ? NOTE_NAMES_EN : NOTE_NAMES;
  let o = `<svg class="fbSvg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" xmlns="http://www.w3.org/2000/svg">`;
  // fret dots
  for (const f of MARKS) if (f <= s.frets) o += `<circle class="fbDot" cx="${X(f)}" cy="${h - 7}" r="2.6"/>`;
  if (s.frets >= 12) o += `<circle class="fbDot" cx="${X(12) - 4}" cy="${h - 7}" r="2.6"/><circle class="fbDot" cx="${X(12) + 4}" cy="${h - 7}" r="2.6"/>`;
  if (s.frets >= 24) o += `<circle class="fbDot" cx="${X(24) - 4}" cy="${h - 7}" r="2.6"/><circle class="fbDot" cx="${X(24) + 4}" cy="${h - 7}" r="2.6"/>`;
  // frets
  o += `<rect class="fbNut" x="${left + fw * 0.6 - 2}" y="${Y(0) - 6}" width="4" height="${gap * (n - 1) + 12}" rx="1"/>`;
  for (let f = 1; f <= s.frets; f++) {
    const x = left + fw * 0.6 + f * fw;
    o += `<line class="fbFret" x1="${x}" y1="${Y(0) - 6}" x2="${x}" y2="${Y(n - 1) + 6}"/>`;
  }
  // strings + labels
  for (let r = 0; r < n; r++) {
    o += `<line class="fbString${r === s.row ? ' cur' : ''}" x1="${left}" y1="${Y(r)}" x2="${width - right}" y2="${Y(r)}" style="stroke-width:${0.8 + (r / Math.max(1, n - 1)) * 1.4}"/>`;
    o += `<text class="fbLabel${r === s.row ? ' cur' : ''}" x="${left - 10}" y="${Y(r) + 4}" text-anchor="end">${names[s.tuning[r] % 12]}</text>`;
  }
  // scale tones
  if (s.root >= 0 && steps.length) {
    for (let r = 0; r < n; r++) {
      for (let f = 0; f <= s.frets; f++) {
        const pc = (s.tuning[r] + f) % 12;
        const iv = (pc - s.root + 12) % 12;
        if (!steps.includes(iv)) continue;
        o += `<g class="fbScale${iv === 0 ? ' root' : ''}"><circle cx="${X(f)}" cy="${Y(r)}" r="7.5"/>${s.names ? `<text x="${X(f)}" y="${Y(r) + 3}" text-anchor="middle">${names[pc]}</text>` : ''}</g>`;
      }
    }
  }
  // notes of the cursor beat
  for (const nt of s.notes) {
    if (nt.fret > s.frets) continue;
    o += `<g class="fbNote"><circle cx="${X(nt.fret)}" cy="${Y(nt.row)}" r="9"/><text x="${X(nt.fret)}" y="${Y(nt.row) + 3.5}" text-anchor="middle">${nt.fret}</text></g>`;
  }
  // hit areas
  for (let r = 0; r < n; r++) {
    for (let f = 0; f <= s.frets; f++) {
      const x0 = f === 0 ? left - 6 : left + fw * 0.6 + (f - 1) * fw;
      const w = f === 0 ? fw * 0.6 + 6 : fw;
      o += `<rect class="fbHit" data-r="${r}" data-f="${f}" x="${x0}" y="${Y(r) - gap / 2}" width="${w}" height="${gap}"><title>${names[(s.tuning[r] + f) % 12]}${Math.floor((s.tuning[r] + f) / 12) - 1} · ${f}</title></rect>`;
    }
  }
  return o + '</svg>';
}

/** shape for a chord on the given tuning: standard shapes only fit standard-like tunings */
export function shapeFor(name: string, tuning: number[]): number[] | null {
  const c = CHORDS.find((x) => x.name === name);
  if (!c || tuning.length !== 6) return null;
  if (!tuning.every((v, i) => v === STANDARD[i])) return null;
  return c.frets;
}
