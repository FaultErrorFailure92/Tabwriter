// Sync of band data with Supabase, entry by entry (song, gig, setlist …).
// Local data stays the working copy; changes are pushed after saving and pulled on start, on realtime events and every few minutes.
// Conflicts: per entry, the later write wins.
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { Band } from '../band/model';
import { dbGet, dbPut } from '../library';
import { audioKey, fileIds } from '../band/ideas';
import { cloudClient } from './cloud';

type Any = Record<string, unknown> & { id: string };
type List = [kind: string, get: (b: Band) => Any[], set: (b: Band, v: Any[]) => void];

const LISTS: List[] = [
  ['member', (b) => b.members as unknown as Any[], (b, v) => (b.members = v as never)],
  ['song', (b) => b.songs as unknown as Any[], (b, v) => (b.songs = v as never)],
  ['setlist', (b) => b.setlists as unknown as Any[], (b, v) => (b.setlists = v as never)],
  ['gig', (b) => b.gigs as unknown as Any[], (b, v) => (b.gigs = v as never)],
  ['idea', (b) => b.ideas as unknown as Any[], (b, v) => (b.ideas = v as never)],
  ['todo', (b) => b.todos as unknown as Any[], (b, v) => (b.todos = v as never)],
  ['crew', (b) => b.crew as unknown as Any[], (b, v) => (b.crew = v as never)],
  ['away', (b) => b.away as unknown as Any[], (b, v) => (b.away = v as never)],
  ['link', (b) => b.links as unknown as Any[], (b, v) => (b.links = v as never)],
  ['tour', (b) => b.tours as unknown as Any[], (b, v) => (b.tours = v as never)],
  ['rehearsal', (b) => b.rehearsals as unknown as Any[], (b, v) => (b.rehearsals = v as never)],
  ['gear', (b) => b.gear.items as unknown as Any[], (b, v) => (b.gear.items = v as never)],
  ['input', (b) => b.gear.inputs as unknown as Any[], (b, v) => (b.gear.inputs = v as never)],
  ['monitor', (b) => b.gear.monitors as unknown as Any[], (b, v) => (b.gear.monitors = v as never)],
  ['cable', (b) => b.gear.cables as unknown as Any[], (b, v) => (b.gear.cables = v as never)],
];

type Single = [id: string, get: (b: Band) => unknown, set: (b: Band, d: Record<string, unknown>) => void];
const SINGLES: Single[] = [
  ['band', (b) => ({ name: b.name, logo: b.logo ?? null, contact: b.contact }), (b, d) => {
    if (typeof d.name === 'string') b.name = d.name;
    b.logo = (d.logo as string) || undefined;
    if (d.contact) b.contact = { ...b.contact, ...(d.contact as object) };
  }],
  ['stage', (b) => b.gear.stage, (b, d) => (b.gear.stage = d as never)],
  ['rider', (b) => b.rider, (b, d) => (b.rider = { ...b.rider, ...(d as object) })],
];

const key = (kind: string, id: string) => `${kind}\u0000${id}`;
const splitKey = (k: string) => k.split('\u0000') as [string, string];

/** JSON with sorted keys: the database (jsonb) does not keep key order */
function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
}

/** FNV-1a over canonical JSON: cheap change detection */
const hash = (v: unknown) => fnv(canon(v));
function fnv(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}

/** band -> entries; list entries get their position as `_o` */
export function explode(b: Band): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [kind, get] of LISTS) get(b).forEach((it, i) => it?.id && m.set(key(kind, it.id), { ...it, _o: i }));
  for (const [id, get] of SINGLES) m.set(key('meta', id), get(b));
  return m;
}

/** apply remote entries (data = null means deleted) onto the band */
export function applyRemote(b: Band, rows: { kind: string; id: string; data: unknown }[]) {
  const touched = new Set<string>();
  for (const r of rows) {
    if (r.kind === 'meta') {
      const s = SINGLES.find(([id]) => id === r.id);
      if (s && r.data) s[2](b, r.data as Record<string, unknown>);
      continue;
    }
    const l = LISTS.find(([k]) => k === r.kind);
    if (!l) continue;
    const arr = l[1](b);
    const at = arr.findIndex((x) => x.id === r.id);
    if (r.data == null) {
      if (at >= 0) arr.splice(at, 1);
    } else if (at >= 0) arr[at] = r.data as Any;
    else arr.push(r.data as Any);
    touched.add(r.kind);
  }
  // restore order from `_o` and strip it
  for (const [kind, get, set] of LISTS) {
    const arr = get(b);
    if (touched.has(kind)) arr.sort((x, y) => ((x._o as number) ?? 1e9) - ((y._o as number) ?? 1e9));
    set(b, arr.map((x) => {
      if (!('_o' in x)) return x;
      const { _o, ...rest } = x;
      void _o;
      return rest as Any;
    }));
  }
}

interface State {
  since: string; // last seen server time (ISO)
  hashes: Record<string, string>; // key -> hash of what the server has
  files: string[]; // file ids known to be uploaded
}

export interface SyncHost {
  band(): Band;
  /** the band changed by a pull: save locally (without pushing) and redraw */
  changed(): void;
  status(s: SyncStatus): void;
  canWrite(): boolean;
}
export type SyncStatus = 'off' | 'syncing' | 'ok' | 'offline' | 'error';

const PAGE = 500;
const OVERLAP_MS = 5000;

export class BandSync {
  private c: SupabaseClient | null = null;
  private st: State = { since: '1970-01-01T00:00:00Z', hashes: {}, files: [] };
  private timer = 0;
  private poll = 0;
  private running: Promise<void> | null = null;
  private again = false;
  private channel: RealtimeChannel | null = null;
  lastError = '';

  constructor(private bandId: string, private host: SyncHost, private opts: { stateKey?: string; client?: SupabaseClient } = {}) {}

  private get stateKey() {
    return this.opts.stateKey ?? `__sync:${this.bandId}`;
  }

  /** forget what this device knew about the band (the local copy was rebuilt) */
  async reset() {
    this.st = { since: '1970-01-01T00:00:00Z', hashes: {}, files: [] };
    await dbPut(this.stateKey, JSON.stringify(this.st));
  }

  async start() {
    this.c = this.opts.client ?? (await cloudClient());
    const saved = await dbGet<string>(this.stateKey);
    if (saved) try { this.st = { ...this.st, ...JSON.parse(saved) }; } catch {}
    this.channel = this.c
      .channel(`band-${this.bandId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'band_items', filter: `band_id=eq.${this.bandId}` }, () => this.soon(800))
      .subscribe();
    this.poll = window.setInterval(() => this.soon(0), 3 * 60_000);
    window.addEventListener('online', this.onOnline);
    await this.now();
  }

  stop() {
    clearTimeout(this.timer);
    clearInterval(this.poll);
    window.removeEventListener('online', this.onOnline);
    if (this.channel && this.c) void this.c.removeChannel(this.channel);
    this.channel = null;
    this.host.status('off');
  }

  private onOnline = () => this.soon(0);

  /** call after every local save */
  soon(ms = 1500) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.now(), ms);
  }

  /** pull, then push; one run at a time */
  async now(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.cycle();
      } while (this.again);
    })().finally(() => (this.running = null));
    return this.running;
  }

  private async cycle() {
    if (!this.c) return;
    if (!navigator.onLine) return this.host.status('offline');
    this.host.status('syncing');
    try {
      await this.pull();
      if (this.host.canWrite()) {
        await this.push();
        await this.pushFiles();
      }
      await this.pullFiles();
      await dbPut(this.stateKey, JSON.stringify(this.st));
      this.lastError = '';
      this.host.status('ok');
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.host.status(navigator.onLine ? 'error' : 'offline');
    }
  }

  private async pull() {
    const c = this.c!;
    const from = new Date(Math.max(0, Date.parse(this.st.since) - OVERLAP_MS)).toISOString();
    const local = explode(this.host.band());
    const apply: { kind: string; id: string; data: unknown }[] = [];
    let max = this.st.since;
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await c.from('band_items').select('kind, id, data, deleted, updated_at').eq('band_id', this.bandId).gt('updated_at', from).order('updated_at').range(off, off + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { kind: string; id: string; data: unknown; deleted: boolean; updated_at: string }[];
      for (const r of rows) {
        if (r.updated_at > max) max = r.updated_at;
        const k = key(r.kind, r.id);
        const remoteHash = r.deleted ? 'deleted' : hash(r.data);
        if (this.st.hashes[k] === remoteHash) continue; // already known
        const mine = local.get(k);
        const dirty = mine !== undefined ? hash(mine) !== this.st.hashes[k] : !!this.st.hashes[k] && this.st.hashes[k] !== 'deleted';
        // a local change made since the last sync and the remote change: the later push wins.
        // A remote change arriving now is newer than our last sync, so take it unless we changed the entry ourselves.
        if (dirty && this.st.hashes[k] !== undefined && this.host.canWrite()) continue;
        this.st.hashes[k] = remoteHash;
        apply.push({ kind: r.kind, id: r.id, data: r.deleted ? null : r.data });
      }
      if (rows.length < PAGE) break;
    }
    this.st.since = max;
    if (apply.length) {
      applyRemote(this.host.band(), apply);
      this.host.changed();
    }
  }

  private async push() {
    const c = this.c!;
    const local = explode(this.host.band());
    const up: { band_id: string; kind: string; id: string; data: unknown; deleted: boolean }[] = [];
    const hashes: [string, string][] = [];
    for (const [k, v] of local) {
      const h = hash(v);
      if (this.st.hashes[k] === h) continue;
      const [kind, id] = splitKey(k);
      up.push({ band_id: this.bandId, kind, id, data: v, deleted: false });
      hashes.push([k, h]);
    }
    for (const [k, h] of Object.entries(this.st.hashes)) {
      if (h === 'deleted' || local.has(k)) continue;
      const [kind, id] = splitKey(k);
      if (kind === 'meta') continue;
      up.push({ band_id: this.bandId, kind, id, data: {}, deleted: true });
      hashes.push([k, 'deleted']);
    }
    for (let i = 0; i < up.length; i += 200) {
      const { error } = await c.from('band_items').upsert(up.slice(i, i + 200), { onConflict: 'band_id,kind,id' });
      if (error) throw new Error(error.message);
    }
    for (const [k, h] of hashes) this.st.hashes[k] = h;
  }

  private async pushFiles() {
    const c = this.c!;
    const known = new Set(this.st.files);
    for (const id of fileIds(this.host.band())) {
      if (known.has(id)) continue;
      const blob = await dbGet<Blob>(audioKey(id));
      if (!blob) continue;
      const { error } = await c.storage.from('band-files').upload(`${this.bandId}/${id}`, blob, { upsert: true, contentType: blob.type || 'application/octet-stream' });
      if (error && !/exists/i.test(error.message)) throw new Error(error.message);
      this.st.files.push(id);
      known.add(id);
    }
  }

  private async pullFiles() {
    const c = this.c!;
    for (const id of fileIds(this.host.band())) {
      if (await dbGet<Blob>(audioKey(id))) continue;
      const { data, error } = await c.storage.from('band-files').download(`${this.bandId}/${id}`);
      if (error || !data) continue; // not uploaded yet
      await dbPut(audioKey(id), data);
      if (!this.st.files.includes(id)) this.st.files.push(id);
    }
  }
}
