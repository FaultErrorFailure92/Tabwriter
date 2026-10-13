// Arrangement: parts (Intro, Strophe, Refrain …) as blocks on a timeline.
// The song stays linear (what the editor shows and GP5/MIDI exports). Blocks that
// point to the same part are linked copies: an edit in one is copied to the others.
// All bar operations work on the alphaTab JSON form of the score.

export interface Part {
  id: string;
  name: string;
  color: number; // index into PART_COLORS
}

export interface Block {
  id: string;
  part: string; // Part.id
  len: number; // bars
  times: number; // 1 = once, >1 = repeat signs around the block
  comment: string;
  muted: number[]; // track indices that are silent (empty) in this block
  from?: Record<string, string>; // track index -> Part.id: this track plays that part's material
  stash?: Record<string, unknown[][]>; // track -> staves -> bars, kept while muted
}

export interface Arrangement {
  parts: Part[];
  blocks: Block[];
}

export const PART_COLORS = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a', '#ac8e68'];

type Obj = Record<string, any>;

let seq = 0;
export const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

/** deep copy without alphaTab ids (new ids are assigned on load) */
function stripIds<T>(o: T): T {
  return JSON.parse(JSON.stringify(o, (k, v) => (k === 'id' ? undefined : v)));
}

export function starts(arr: Arrangement): number[] {
  const s: number[] = [];
  let b = 0;
  for (const bl of arr.blocks) {
    s.push(b);
    b += bl.len;
  }
  return s;
}

export function blockAt(arr: Arrangement, bar: number): number {
  let b = 0;
  for (let i = 0; i < arr.blocks.length; i++) {
    b += arr.blocks[i].len;
    if (bar < b) return i;
  }
  return arr.blocks.length - 1;
}

export function partOf(arr: Arrangement, bl: Block): Part {
  return arr.parts.find((p) => p.id === bl.part)!;
}

export function siblings(arr: Arrangement, bl: Block): Block[] {
  return arr.blocks.filter((b) => b.part === bl.part);
}

/** remove parts no block points to */
export function prune(arr: Arrangement) {
  const used = new Set(arr.blocks.map((b) => b.part));
  arr.parts = arr.parts.filter((p) => used.has(p.id));
}

function nextColor(arr: Arrangement): number {
  const used = arr.parts.map((p) => p.color);
  for (let c = 0; c < PART_COLORS.length; c++) if (!used.includes(c)) return c;
  return arr.parts.length % PART_COLORS.length;
}

export function addPart(arr: Arrangement, name: string): Part {
  const p: Part = { id: newId('p'), name, color: nextColor(arr) };
  arr.parts.push(p);
  return p;
}

export function newBlock(part: string, len: number): Block {
  return { id: newId('b'), part, len, times: 1, comment: '', muted: [] };
}

// ---------------- bar helpers (JSON level) ----------------

function staves(o: Obj): Obj[] {
  const r: Obj[] = [];
  for (const t of o.tracks) for (const st of t.staves) r.push(st);
  return r;
}

function hasNotes(bar: Obj): boolean {
  for (const v of bar.voices ?? []) for (const b of v.beats ?? []) if ((b.notes ?? []).length) return true;
  return false;
}

/** empty placeholder bar with the same clef etc. */
function emptyBar(like: Obj): Obj {
  const b = stripIds(like);
  const n = Math.max(1, (like.voices ?? []).length);
  b.voices = Array.from({ length: n }, () => ({ beats: [{ isempty: true, duration: 4, notes: [], automations: [] }] }));
  return b;
}

const MB_SKIP = new Set(['start', 'section', 'isrepeatstart', 'repeatcount']);

function mbNorm(mb: Obj, first: boolean): Obj {
  const r: Obj = {};
  for (const k of Object.keys(mb)) {
    if (MB_SKIP.has(k)) continue;
    if (k === 'tempoautomations' && first) continue;
    r[k] = mb[k];
  }
  return r;
}

function trackHash(o: Obj, t: number, s: number, len: number): string {
  return JSON.stringify(o.tracks[t].staves.map((st: Obj) => st.bars.slice(s, s + len)), (k, v) => (k === 'id' ? undefined : v));
}

/** track handled outside the block link (muted or taken from another part) */
const local = (bl: Block, t: number) => bl.muted.includes(t) || !!bl.from?.[t];

function blockHash(o: Obj, bl: Block, s: number, skip: number[] = []): string {
  const mbs = o.masterbars.slice(s, s + bl.len).map((mb: Obj, i: number) => mbNorm(mb, i === 0));
  const tr = o.tracks.map((_: Obj, t: number) => (local(bl, t) || skip.includes(t) ? '-' : trackHash(o, t, s, bl.len)));
  return JSON.stringify(mbs) + '|' + tr.join('|');
}

/** replace the bars of `dst` (all tracks) with a copy of `src` */
function copyBlock(o: Obj, arr: Arrangement, src: Block, dst: Block) {
  const st = starts(arr);
  const s = st[arr.blocks.indexOf(src)];
  const d = st[arr.blocks.indexOf(dst)];
  const n = src.len;
  const oldLen = dst.len;
  // master bars
  const mbs = o.masterbars.slice(s, s + n).map((mb: Obj, i: number) => {
    const c = stripIds(mb);
    const keep = o.masterbars[d + Math.min(i, oldLen - 1)];
    c.section = null;
    c.isrepeatstart = false;
    c.repeatcount = 0;
    if (i === 0) c.tempoautomations = keep?.tempoautomations ?? [];
    return c;
  });
  // keep inner repeat signs of the source
  for (let i = 1; i < n; i++) mbs[i].isrepeatstart = o.masterbars[s + i].isrepeatstart;
  for (let i = 0; i < n - 1; i++) mbs[i].repeatcount = o.masterbars[s + i].repeatcount;
  const newTracks = o.tracks.map((tr: Obj, t: number) =>
    tr.staves.map((stf: Obj) => {
      const own = stf.bars.slice(d, d + oldLen);
      const fit = (bars: Obj[]) => Array.from({ length: n }, (_, i) => (bars[i] ? bars[i] : emptyBar(bars[bars.length - 1] ?? stf.bars[0])));
      if (dst.muted.includes(t)) return fit([]).map((b) => emptyBar(b));
      if (src.muted.includes(t) || dst.from?.[t] || src.from?.[t]) return fit(own);
      return stf.bars.slice(s, s + n).map((b: Obj) => stripIds(b));
    }),
  );
  // muted tracks of dst: keep the source content as stash for unmuting
  for (const t of dst.muted) {
    if (src.muted.includes(t) || src.from?.[t]) continue;
    dst.stash = dst.stash ?? {};
    dst.stash[t] = o.tracks[t].staves.map((stf: Obj) => stf.bars.slice(s, s + n).map(stripIds));
  }
  o.masterbars.splice(d, oldLen, ...mbs);
  o.tracks.forEach((tr: Obj, t: number) => tr.staves.forEach((stf: Obj, k: number) => stf.bars.splice(d, oldLen, ...newTracks[t][k])));
  dst.len = n;
}

/** empty or restore bars of a muted track */
function applyMute(o: Obj, arr: Arrangement, bl: Block, t: number, on: boolean) {
  const s = starts(arr)[arr.blocks.indexOf(bl)];
  const tr = o.tracks[t];
  if (!tr) return;
  if (on) {
    bl.stash = bl.stash ?? {};
    bl.stash[t] = tr.staves.map((st: Obj) => st.bars.slice(s, s + bl.len).map(stripIds));
    for (const st of tr.staves) for (let i = 0; i < bl.len; i++) st.bars[s + i] = emptyBar(st.bars[s + i]);
  } else {
    // prefer a linked block where this track plays, else the stash
    const st0 = starts(arr);
    const sib = siblings(arr, bl).find((b) => b !== bl && !b.muted.includes(t) && b.len === bl.len);
    const from: Obj[][] | undefined = sib
      ? tr.staves.map((st: Obj) => st.bars.slice(st0[arr.blocks.indexOf(sib)], st0[arr.blocks.indexOf(sib)] + bl.len).map(stripIds))
      : (bl.stash?.[t] as Obj[][] | undefined);
    tr.staves.forEach((st: Obj, k: number) => {
      for (let i = 0; i < bl.len; i++) {
        const b = from?.[k]?.[i];
        if (b) st.bars[s + i] = stripIds(b);
      }
    });
    if (bl.stash) delete bl.stash[t];
  }
}

// ---------------- sync ----------------

export interface SyncState {
  hashes: Map<string, string>;
  tracks: Map<string, string>; // "<blockId>:<track>" -> hash
}

export function newSyncState(): SyncState {
  return { hashes: new Map(), tracks: new Map() };
}

export function rememberHashes(o: Obj, arr: Arrangement, ss: SyncState) {
  ss.hashes.clear();
  ss.tracks.clear();
  const st = starts(arr);
  arr.blocks.forEach((bl, i) => {
    ss.hashes.set(bl.id, blockHash(o, bl, st[i]));
    o.tracks.forEach((_: Obj, t: number) => ss.tracks.set(`${bl.id}:${t}`, trackHash(o, t, st[i], bl.len)));
  });
}

/** copy one track's bars from block src into block dst (lengths may differ) */
function copyTrack(o: Obj, arr: Arrangement, src: Block, dst: Block, t: number) {
  const st = starts(arr);
  const s = st[arr.blocks.indexOf(src)];
  const d = st[arr.blocks.indexOf(dst)];
  const tr = o.tracks[t];
  if (!tr || src === dst) return;
  tr.staves.forEach((stf: Obj) => {
    for (let i = 0; i < dst.len; i++) {
      const b = stf.bars[s + i];
      stf.bars[d + i] = b ? stripIds(b) : emptyBar(stf.bars[d + i]);
    }
  });
}

/** tracks taken from another part: keep them in step with that part (both directions) */
function syncTrackRefs(o: Obj, arr: Arrangement, ss: SyncState, focus: number) {
  const st = starts(arr);
  const pairs = new Map<string, { part: string; t: number }>();
  for (const bl of arr.blocks) for (const [k, p] of Object.entries(bl.from ?? {})) pairs.set(`${p}:${k}`, { part: p, t: Number(k) });
  for (const { part, t } of pairs.values()) {
    const group = arr.blocks.filter((b) => !b.muted.includes(t) && ((b.part === part && !b.from?.[t]) || b.from?.[t] === part));
    if (group.length < 2) continue;
    const dirty = group.filter((b) => ss.tracks.get(`${b.id}:${t}`) !== trackHash(o, t, st[arr.blocks.indexOf(b)], b.len));
    const own = group.find((b) => b.part === part);
    const src = dirty.includes(arr.blocks[focus]) ? arr.blocks[focus] : dirty[0] ?? own;
    if (!src) continue;
    for (const b of group) if (b !== src) copyTrack(o, arr, src, b, t);
  }
}

/** let track t of block i play the material of part `part` ('' = its own again) */
export function setTrackFrom(o: Obj, arr: Arrangement, i: number, t: number, part: string) {
  const bl = arr.blocks[i];
  if (!part || part === bl.part) {
    if (bl.from) delete bl.from[t];
    return;
  }
  bl.from = { ...(bl.from ?? {}), [t]: part };
  bl.muted = bl.muted.filter((x) => x !== t);
  const src = arr.blocks.find((b) => b.part === part && !b.from?.[t]);
  if (src) copyTrack(o, arr, src, bl, t);
}

/** section markers + repeat signs at block borders */
function decorate(o: Obj, arr: Arrangement) {
  const st = starts(arr);
  arr.blocks.forEach((bl, i) => {
    const s = st[i];
    for (let k = 0; k < bl.len; k++) {
      const mb = o.masterbars[s + k];
      if (!mb) continue;
      if (k === 0) mb.section = { text: partOf(arr, bl)?.name ?? '', marker: '' };
      else mb.section = null;
    }
    if (bl.times > 1) {
      o.masterbars[s].isrepeatstart = true;
      o.masterbars[s + bl.len - 1].repeatcount = bl.times;
    }
  });
}

/**
 * After an edit: fix block lengths, auto-unmute tracks that got notes,
 * copy the edited block to its linked blocks, refresh markers.
 * editBar = bar where the edit happened (before the edit), focusBar = cursor bar now.
 */
export function sync(o: Obj, arr: Arrangement, ss: SyncState, editBar: number, focusBar: number) {
  if (!arr.blocks.length) return;
  const total = o.masterbars.length;
  let sum = arr.blocks.reduce((a, b) => a + b.len, 0);
  let changed = -1;
  if (sum !== total) {
    let idx = blockAt(arr, Math.min(editBar, sum - 1));
    changed = idx;
    let delta = total - sum;
    if (delta > 0) arr.blocks[idx].len += delta;
    else {
      while (delta < 0 && arr.blocks.length) {
        const bl = arr.blocks[idx];
        const take = Math.min(bl.len, -delta);
        bl.len -= take;
        delta += take;
        if (bl.len === 0) {
          arr.blocks.splice(idx, 1);
          if (idx >= arr.blocks.length) idx = arr.blocks.length - 1;
          changed = -1;
        }
      }
      prune(arr);
    }
    sum = total;
    if (!arr.blocks.length) {
      // everything deleted: one block again
      const p = arr.parts[0] ?? addPart(arr, 'A');
      arr.parts = [p];
      arr.blocks = [newBlock(p.id, total)];
    }
  }
  let st = starts(arr);
  // notes typed into a muted track: unmute it there
  arr.blocks.forEach((bl, i) => {
    bl.muted = bl.muted.filter((t) => {
      const tr = o.tracks[t];
      if (!tr) return false;
      for (const stf of tr.staves) for (let k = 0; k < bl.len; k++) if (stf.bars[st[i] + k] && hasNotes(stf.bars[st[i] + k])) {
        if (bl.stash) delete bl.stash[t];
        return false;
      }
      return true;
    });
  });
  // propagate edits inside linked parts
  const focus = blockAt(arr, focusBar);
  for (const p of arr.parts) {
    const group = arr.blocks.filter((b) => b.part === p.id);
    if (group.length < 2) continue;
    const dirty = group.filter((b) => {
      const i = arr.blocks.indexOf(b);
      return i === changed || ss.hashes.get(b.id) !== blockHash(o, b, st[i]);
    });
    if (!dirty.length) continue;
    const src = dirty.includes(arr.blocks[focus]) ? arr.blocks[focus] : dirty[0];
    for (const b of group) {
      if (b === src) continue;
      copyBlock(o, arr, src, b);
      st = starts(arr);
    }
  }
  // drop references to parts that no longer exist
  for (const bl of arr.blocks) if (bl.from) for (const [k, p] of Object.entries(bl.from)) if (!arr.parts.some((x) => x.id === p) || p === bl.part) delete bl.from[k];
  syncTrackRefs(o, arr, ss, focus);
  decorate(o, arr);
  rememberHashes(o, arr, ss);
}

/** link dst to src's part (replaces dst content) */
export function link(o: Obj, arr: Arrangement, src: Block, dst: Block) {
  dst.part = src.part;
  copyBlock(o, arr, src, dst);
  prune(arr);
}

export function setMute(o: Obj, arr: Arrangement, bl: Block, t: number, on: boolean) {
  if (on === bl.muted.includes(t)) return;
  if (on) bl.muted.push(t);
  else bl.muted = bl.muted.filter((x) => x !== t);
  applyMute(o, arr, bl, t, on);
}

export function setTimes(o: Obj, arr: Arrangement, bl: Block, n: number) {
  const s = starts(arr)[arr.blocks.indexOf(bl)];
  if (bl.times > 1 && n <= 1) {
    o.masterbars[s].isrepeatstart = false;
    o.masterbars[s + bl.len - 1].repeatcount = 0;
  }
  bl.times = Math.max(1, Math.min(16, n));
}

/** insert a copy of block `i` (linked or independent) right after `at` */
export function duplicate(o: Obj, arr: Arrangement, i: number, at: number, linked: boolean): Block {
  const src = arr.blocks[i];
  const st = starts(arr);
  const s = st[i];
  const d = st[at] + arr.blocks[at].len;
  const mbs = o.masterbars.slice(s, s + src.len).map((mb: Obj, k: number) => {
    const c = stripIds(mb);
    c.section = null;
    if (k === 0) c.tempoautomations = [];
    return c;
  });
  o.masterbars.splice(d, 0, ...mbs);
  for (const stf of staves(o)) stf.bars.splice(d, 0, ...stf.bars.slice(s, s + src.len).map((b: Obj) => stripIds(b)));
  let part = src.part;
  if (!linked) part = addPart(arr, partOf(arr, src).name).id;
  const nb: Block = { ...clone(src), id: newId('b'), part };
  arr.blocks.splice(at + 1, 0, nb);
  return nb;
}

/** move block i to position j (index after removal) */
export function move(o: Obj, arr: Arrangement, i: number, j: number) {
  if (i === j) return;
  const st = starts(arr);
  const bl = arr.blocks[i];
  const s = st[i];
  // song tempo always stays on bar 1
  const base = o.masterbars[0].tempoautomations ?? [];
  o.masterbars[0].tempoautomations = [];
  const mbs = o.masterbars.splice(s, bl.len);
  const bars = staves(o).map((stf) => stf.bars.splice(s, bl.len));
  arr.blocks.splice(i, 1);
  arr.blocks.splice(j, 0, bl);
  const d = starts(arr)[j];
  o.masterbars.splice(d, 0, ...mbs);
  staves(o).forEach((stf, k) => stf.bars.splice(d, 0, ...bars[k]));
  if (base.length) o.masterbars[0].tempoautomations = base;
}

export function remove(o: Obj, arr: Arrangement, i: number) {
  if (arr.blocks.length <= 1) return;
  const s = starts(arr)[i];
  const bl = arr.blocks[i];
  const firstTempo = s === 0 ? o.masterbars[0].tempoautomations : null;
  o.masterbars.splice(s, bl.len);
  for (const stf of staves(o)) stf.bars.splice(s, bl.len);
  if (firstTempo?.length && !o.masterbars[0].tempoautomations?.length) o.masterbars[0].tempoautomations = firstTempo;
  arr.blocks.splice(i, 1);
  prune(arr);
}

/** new empty part with `len` bars after block `at` (-1 = at the start) */
export function insertNew(o: Obj, arr: Arrangement, at: number, name: string, len: number): Block {
  const st = starts(arr);
  const d = at < 0 ? 0 : st[at] + arr.blocks[at].len;
  const ref = o.masterbars[Math.max(0, Math.min(d - 1, o.masterbars.length - 1))];
  for (let k = 0; k < len; k++) {
    const c = stripIds(ref);
    c.section = null;
    c.tempoautomations = [];
    c.isrepeatstart = false;
    c.repeatcount = 0;
    c.alternateendings = 0;
    c.directions = undefined;
    o.masterbars.splice(d + k, 0, c);
  }
  for (const stf of staves(o)) {
    const like = stf.bars[Math.max(0, Math.min(d - 1, stf.bars.length - 1))];
    stf.bars.splice(d, 0, ...Array.from({ length: len }, () => emptyBar(like)));
  }
  const p = addPart(arr, name);
  const nb = newBlock(p.id, len);
  arr.blocks.splice(at + 1, 0, nb);
  return nb;
}

/** split block i before bar `bar` (absolute); right half becomes its own part */
export function split(o: Obj, arr: Arrangement, i: number, bar: number, name: string): Block | null {
  const bl = arr.blocks[i];
  const s = starts(arr)[i];
  setTimes(o, arr, bl, 1);
  const k = bar - s;
  if (k <= 0 || k >= bl.len) return null;
  if (siblings(arr, bl).length > 1) return null;
  const p = addPart(arr, name);
  const nb = newBlock(p.id, bl.len - k);
  bl.len = k;
  bl.muted.forEach((t) => nb.muted.push(t));
  delete bl.stash;
  arr.blocks.splice(i + 1, 0, nb);
  return nb;
}

/** blocks from section markers; equal name + equal content = linked */
export function fromSections(o: Obj): Arrangement {
  const arr: Arrangement = { parts: [], blocks: [] };
  const mbs: Obj[] = o.masterbars;
  const cuts = mbs.map((mb, i) => (i === 0 || mb.section ? i : -1)).filter((i) => i >= 0);
  cuts.forEach((s, k) => {
    const len = (cuts[k + 1] ?? mbs.length) - s;
    const name: string = mbs[s].section?.text || (cuts.length === 1 ? 'A' : s === 0 ? 'Intro' : 'Teil');
    const bl = newBlock('', len);
    const h = blockHash(o, bl, s);
    const st = starts(arr);
    const twin = arr.blocks.find((b, i) => partOf(arr, b).name === name && b.len === len && blockHash(o, b, st[i]) === h);
    bl.part = twin ? twin.part : addPart(arr, name).id;
    if (mbs[s].isrepeatstart && mbs[s + len - 1].repeatcount > 1) bl.times = mbs[s + len - 1].repeatcount;
    arr.blocks.push(bl);
  });
  return arr;
}

/** shift muted indices after a track was removed */
export function trackRemoved(arr: Arrangement, t: number) {
  for (const bl of arr.blocks) {
    bl.muted = bl.muted.filter((x) => x !== t).map((x) => (x > t ? x - 1 : x));
    if (bl.from) {
      const nf: Record<string, string> = {};
      for (const [k, v] of Object.entries(bl.from)) {
        const n = Number(k);
        if (n !== t) nf[n > t ? n - 1 : n] = v;
      }
      bl.from = nf;
    }
    if (bl.stash) {
      const ns: Record<string, unknown[][]> = {};
      for (const [k, v] of Object.entries(bl.stash)) {
        const n = Number(k);
        if (n !== t) ns[n > t ? n - 1 : n] = v;
      }
      bl.stash = ns;
    }
  }
}
