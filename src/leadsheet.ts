// Lead sheet: sections, chord names and lyrics only. Used as rehearsal view and for printing.
import type * as alphaTab from '@coderline/alphatab';
import { chordOf, lyricOf, joinSyllables } from './chords';
import { barTicks } from './model';

export interface LeadBar {
  index: number;
  section: string;
  chords: { name: string; pos: number }[]; // pos 0..1 within the bar
  lyric: string;
  repeatStart: boolean;
  repeatEnd: number; // plays, 0 = none
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** chords: from the first track that has a chord in that bar; lyrics: first track with lyrics */
export function leadBars(score: alphaTab.model.Score): LeadBar[] {
  const lyricTrack = score.tracks.find((t) => t.staves[0]?.bars.some((b) => b.voices[0]?.beats.some((x) => lyricOf(x))));
  return score.masterBars.map((mb, i) => {
    let chords: LeadBar['chords'] = [];
    const total = barTicks(mb);
    for (const t of score.tracks) {
      const bar = t.staves[0]?.bars[i];
      if (!bar) continue;
      const found: LeadBar['chords'] = [];
      let tick = 0;
      for (const b of bar.voices[0]?.beats ?? []) {
        const c = chordOf(b);
        if (c) found.push({ name: c, pos: Math.min(0.95, tick / total) });
        tick += b.playbackDuration || b.displayDuration || 0;
      }
      if (found.length) {
        chords = found;
        break;
      }
    }
    const lb = lyricTrack?.staves[0]?.bars[i];
    const lyric = lb ? joinSyllables((lb.voices[0]?.beats ?? []).map(lyricOf)) + ((lb.voices[0]?.beats ?? []).map(lyricOf).filter(Boolean).pop()?.endsWith('-') ? '-' : '') : '';
    return {
      index: i,
      section: mb.section?.text ?? '',
      chords,
      lyric,
      repeatStart: mb.isRepeatStart,
      repeatEnd: mb.repeatCount,
    };
  });
}

export interface LeadOptions {
  perRow: number;
  current: number; // cursor bar
  playing: number; // playing bar or -1
  title: string;
  artist: string;
  tempo: number;
}

export function renderLeadSheet(score: alphaTab.model.Score, o: LeadOptions): string {
  const bars = leadBars(score);
  let h = `<div class="lsHead"><h1>${esc(o.title)}</h1>${o.artist ? `<div class="lsArtist">${esc(o.artist)}</div>` : ''}<div class="lsTempo">${Math.round(o.tempo)} bpm</div></div>`;
  let row: string[] = [];
  const flush = () => {
    if (!row.length) return;
    while (row.length < o.perRow) row.push('<div class="lsBar empty"></div>');
    h += `<div class="lsRow" style="--n:${o.perRow}">${row.join('')}</div>`;
    row = [];
  };
  let lastChord = '';
  for (const b of bars) {
    if (b.section) {
      flush();
      h += `<div class="lsSec">${esc(b.section)}</div>`;
    }
    const cls = ['lsBar'];
    if (b.index === o.current) cls.push('cur');
    if (b.index === o.playing) cls.push('play');
    if (b.repeatStart) cls.push('repS');
    if (b.repeatEnd > 0) cls.push('repE');
    let chords = '';
    if (b.chords.length) {
      // spacers shrink when chords get tight, so names never overlap
      let prev = 0;
      for (const c of b.chords) {
        chords += `<i style="flex-basis:${((c.pos - prev) * 100).toFixed(1)}%"></i><span class="lsChord">${esc(c.name)}</span>`;
        prev = c.pos;
      }
      lastChord = b.chords[b.chords.length - 1].name;
    } else if (lastChord) chords = `<span class="lsChord sim">%</span>`;
    const rep = b.repeatEnd > 1 ? `<span class="lsRep">×${b.repeatEnd}</span>` : '';
    row.push(`<div class="${cls.join(' ')}" data-bar="${b.index}"><div class="lsChords">${chords}</div><div class="lsLyric">${esc(b.lyric) || '&nbsp;'}</div>${rep}</div>`);
    if (row.length === o.perRow) flush();
  }
  flush();
  return h;
}
