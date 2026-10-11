// Track/bar overview (like Guitar Pro's bottom panel): one row per track, one cell per bar.
import type * as alphaTab from '@coderline/alphatab';
import { trackKind } from './model';
import { icon, type IconName } from './icons';

const KIND_ICON: Record<string, IconName> = { guitar: 'guitar', bass: 'bass', drums: 'drum', synth: 'synth' };

export interface OverviewState {
  score: alphaTab.model.Score;
  track: number;
  bar: number;
  sel: { start: number; end: number } | null; // bar range of the selection (current track)
  playingBar: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function barHasNotes(bar: alphaTab.model.Bar | undefined): 'full' | 'rest' | 'empty' {
  if (!bar) return 'empty';
  let rest = false;
  for (const v of bar.voices) {
    for (const b of v.beats) {
      if (b.notes.length) return 'full';
      if (!b.isEmpty) rest = true;
    }
  }
  return rest ? 'rest' : 'empty';
}

export function renderOverview(root: HTMLElement, s: OverviewState, labels: { tracks: string; bar: (n: number) => string }) {
  const bars = s.score.masterBars;
  let head = `<div class="ovNames"><div class="ovCorner"></div>`;
  s.score.tracks.forEach((tr, i) => {
    head += `<div class="ovName${i === s.track ? ' on' : ''}" data-t="${i}"><span class="ovIcon trackIcon ${trackKind(tr)}">${icon(KIND_ICON[trackKind(tr)] ?? 'music', 12)}</span><span class="ovLabel">${esc(tr.name)}</span></div>`;
  });
  head += '</div>';

  let grid = '<div class="ovGrid"><div class="ovRow ovHead">';
  bars.forEach((mb, b) => {
    const cls = ['ovNum'];
    if (b === s.bar) cls.push('cur');
    if (b === s.playingBar) cls.push('play');
    if (mb.section && b > 0) cls.push('secStart');
    const marks = (mb.isRepeatStart ? '‖:' : '') + (mb.repeatCount > 0 ? ':‖' : '');
    const sec = mb.section?.text ? `<span class="ovSec">${esc(mb.section.text)}</span>` : '';
    grid += `<div class="${cls.join(' ')}" data-b="${b}" title="${esc(labels.bar(b + 1))}">${sec}${b + 1}${marks ? `<span class="ovRep">${marks}</span>` : ''}</div>`;
  });
  grid += '</div>';
  s.score.tracks.forEach((tr, i) => {
    const kind = trackKind(tr);
    grid += `<div class="ovRow">`;
    const st = tr.staves[0];
    bars.forEach((_mb, b) => {
      const state = barHasNotes(st?.bars[b]);
      const cls = ['ovCell', kind, state];
      if (b === s.bar) cls.push('col');
      if (b === s.playingBar) cls.push('play');
      if (i === s.track && b === s.bar) cls.push('cur');
      if (i === s.track && s.sel && b >= s.sel.start && b <= s.sel.end) cls.push('sel');
      if (bars[b].section && b > 0) cls.push('secStart');
      grid += `<div class="${cls.join(' ')}" data-t="${i}" data-b="${b}"></div>`;
    });
    grid += '</div>';
  });
  grid += '</div>';
  const scroller = root.querySelector('.ovScroll') as HTMLElement | null;
  const keep = scroller?.scrollLeft ?? 0;
  const keepY = root.scrollTop;
  root.innerHTML = head + `<div class="ovScroll">${grid}</div>`;
  const sc = root.querySelector('.ovScroll') as HTMLElement;
  sc.scrollLeft = keep;
  root.scrollTop = keepY;
  // keep the current bar in view
  const cell = sc.querySelector(`.ovNum[data-b="${s.playingBar >= 0 ? s.playingBar : s.bar}"]`) as HTMLElement | null;
  if (cell) {
    const l = cell.offsetLeft;
    if (l < sc.scrollLeft + 30) sc.scrollLeft = Math.max(0, l - 90);
    else if (l > sc.scrollLeft + sc.clientWidth - 60) sc.scrollLeft = l - sc.clientWidth + 120;
  }
}
