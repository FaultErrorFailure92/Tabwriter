// Track/bar overview (like Guitar Pro's bottom panel): one row per track, one cell per bar.
import type * as alphaTab from '@coderline/alphatab';
import { trackKind } from './model';
import { icon, type IconName } from './icons';
import { type Arrangement, PART_COLORS, starts, partOf, siblings } from './arrangement';

const KIND_ICON: Record<string, IconName> = { guitar: 'guitar', bass: 'bass', drums: 'drum', synth: 'synth' };

export interface OverviewState {
  score: alphaTab.model.Score;
  track: number;
  bar: number;
  sel: { start: number; end: number } | null; // bar range of the selection (current track)
  playingBar: number;
  arr: Arrangement | null;
}

const BAR_W = 33; // cell width + gap
const SEC_GAP = 8;

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

function arrRow(s: OverviewState, labels: { linked: (n: number) => string; times: (n: number) => string }): string {
  const arr = s.arr!;
  const st = starts(arr);
  let h = '<div class="ovRow ovArr">';
  arr.blocks.forEach((bl, i) => {
    const p = partOf(arr, bl);
    const n = siblings(arr, bl).length;
    const w = bl.len * BAR_W - 3;
    const cur = s.bar >= st[i] && s.bar < st[i] + bl.len;
    const tip = [p.name, n > 1 ? labels.linked(n) : '', bl.times > 1 ? labels.times(bl.times) : '', bl.comment].filter(Boolean).join(' · ');
    h += `<div class="arBlock${cur ? ' cur' : ''}${n > 1 ? ' linked' : ''}" data-blk="${i}" style="width:${w}px;--c:${PART_COLORS[p.color % PART_COLORS.length]}${i > 0 ? `;margin-left:${SEC_GAP}px` : ''}" data-tip="${esc(tip)}">`;
    if (n > 1 && bl.len > 2) h += `<span class="arLink">${icon('link', 11)}</span>`;
    h += `<span class="arName">${esc(p.name)}</span>`;
    if (bl.times > 1) h += `<span class="arTimes">×${bl.times}</span>`;
    if (bl.comment) h += `<span class="arNote">${icon('comment', 11)}</span>`;
    h += '</div>';
  });
  return h + '</div>';
}

export interface OverviewLabels {
  tracks: string;
  bar: (n: number) => string;
  arrangement: string;
  linked: (n: number) => string;
  times: (n: number) => string;
  from: (part: string) => string;
}

export function renderOverview(root: HTMLElement, s: OverviewState, labels: OverviewLabels) {
  const bars = s.score.masterBars;
  // muted cells per track (bar index set)
  const muted = new Set<string>();
  const refs = new Map<string, string>(); // "track:bar" -> part name
  if (s.arr) {
    const st = starts(s.arr);
    s.arr.blocks.forEach((bl, i) => {
      for (const t of bl.muted) for (let k = 0; k < bl.len; k++) muted.add(`${t}:${st[i] + k}`);
      for (const [t, p] of Object.entries(bl.from ?? {})) {
        const name = s.arr!.parts.find((x) => x.id === p)?.name ?? '';
        for (let k = 0; k < bl.len; k++) refs.set(`${t}:${st[i] + k}`, name);
      }
    });
  }
  let head = `<div class="ovNames">${s.arr ? `<div class="ovArrHead">${esc(labels.arrangement)}</div>` : ''}<div class="ovCorner"></div>`;
  s.score.tracks.forEach((tr, i) => {
    head += `<div class="ovName${i === s.track ? ' on' : ''}" data-t="${i}"><span class="ovIcon trackIcon ${trackKind(tr)}">${icon(KIND_ICON[trackKind(tr)] ?? 'music', 12)}</span><span class="ovLabel">${esc(tr.name)}</span></div>`;
  });
  head += '</div>';

  let grid = `<div class="ovGrid${s.arr ? ' hasArr' : ''}">${s.arr ? arrRow(s, labels) : ''}<div class="ovRow ovHead">`;
  bars.forEach((mb, b) => {
    const cls = ['ovNum'];
    if (b === s.bar) cls.push('cur');
    if (b === s.playingBar) cls.push('play');
    if (mb.section && b > 0) cls.push('secStart');
    const marks = (mb.isRepeatStart ? '‖:' : '') + (mb.repeatCount > 0 ? ':‖' : '');
    const sec = mb.section?.text && !s.arr ? `<span class="ovSec">${esc(mb.section.text)}</span>` : '';
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
      if (muted.has(`${i}:${b}`)) cls.push('muted');
      const ref = refs.get(`${i}:${b}`);
      if (ref) cls.push('ref');
      if (b === s.bar) cls.push('col');
      if (b === s.playingBar) cls.push('play');
      if (i === s.track && b === s.bar) cls.push('cur');
      if (i === s.track && s.sel && b >= s.sel.start && b <= s.sel.end) cls.push('sel');
      if (bars[b].section && b > 0) cls.push('secStart');
      grid += `<div class="${cls.join(' ')}" data-t="${i}" data-b="${b}"${ref ? ` data-tip="${esc(labels.from(ref))}"` : ''}></div>`;
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
