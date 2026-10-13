// Stagecraft band data: members, songs, setlists, gigs, gear.
// One band project, stored locally and exportable as a .stagecraft file (JSON).

export interface Member {
  id: string;
  name: string;
  role: string; // e.g. "Gitarre, Gesang"
  phone: string;
  email: string;
}

export interface Song {
  id: string;
  title: string;
  duration: number; // seconds
  bpm: number;
  key: string;
  file: string; // file name or path of the score (optional)
  notes: string;
}

export type SetItem =
  | { id: string; type: 'song'; song: string; note: string }
  | { id: string; type: 'break'; label: string; duration: number };

export interface Setlist {
  id: string;
  name: string;
  items: SetItem[];
}

export interface Contact {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
}

export interface ScheduleItem {
  id: string;
  label: string;
  time: string; // "HH:MM"
}

export interface Gig {
  id: string;
  title: string;
  date: string; // "YYYY-MM-DD"
  venue: string;
  address: string;
  setlist: string; // Setlist.id or ''
  lineup: string[]; // Member.id
  schedule: ScheduleItem[];
  contacts: Contact[];
  notes: string;
}

// ---------- gear / cabling (ported from the SwiftUI Verkabelungsplan app, no UI yet) ----------

export type OwnerType = 'band' | 'musician' | 'venue' | 'thirdParty';
export type PortType = 'xlr' | 'jackTS' | 'jackTRS' | 'speakon' | 'usb' | 'midi' | 'ethernet' | 'other';
export type CableType = 'xlr' | 'jackTS' | 'jackTRS' | 'speakon' | 'ethernet' | 'powerCon' | 'other';

export interface Owner {
  type: OwnerType;
  member?: string; // Member.id when type = musician
  note?: string;
}

export interface Port {
  id: string;
  name: string;
  type: PortType;
  direction: 'input' | 'output';
}

export interface Pos {
  x: number;
  y: number;
}

export interface Instrument {
  id: string;
  name: string;
  member?: string; // who plays it
  owner: Owner;
  inputs: Port[];
  outputs: Port[];
  pos?: Pos;
}

/** effect, amp, DI box, wireless … */
export interface Device {
  id: string;
  name: string;
  owner: Owner;
  inputs: Port[];
  outputs: Port[];
  board?: string; // Effectboard.id
  chainOrder?: number;
  pos?: Pos;
}

export interface Effectboard {
  id: string;
  name: string;
  owner: Owner;
  pos?: Pos;
}

export interface Mixer {
  id: string;
  name: string;
  channels: Port[];
  distanceToFoh?: number; // m
  pos?: Pos;
}

export interface Foh {
  id: string;
  name: string;
  mixer?: string;
  pos?: Pos;
}

export interface PA {
  id: string;
  name: string;
  mixer?: string;
  pos?: Pos;
}

export interface Cable {
  id: string;
  from?: string; // Port.id
  to?: string; // Port.id
  type: CableType;
  length?: number; // m
  color?: string;
}

export interface BomItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  owner: Owner;
}

export interface Gear {
  instruments: Instrument[];
  devices: Device[];
  boards: Effectboard[];
  mixers: Mixer[];
  foh: Foh[];
  pa: PA[];
  cables: Cable[];
  bom: BomItem[];
}

export interface Band {
  app: 'stagecraft';
  version: 1;
  name: string;
  members: Member[];
  songs: Song[];
  setlists: Setlist[];
  gigs: Gig[];
  gear: Gear;
}

// ---------- helpers ----------

let seq = 0;
export const uid = (p = '') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function emptyGear(): Gear {
  return { instruments: [], devices: [], boards: [], mixers: [], foh: [], pa: [], cables: [], bom: [] };
}

export function newBand(name = 'Meine Band'): Band {
  return { app: 'stagecraft', version: 1, name, members: [], songs: [], setlists: [], gigs: [], gear: emptyGear() };
}

/** fill missing fields of older / hand-written files */
export function normalize(d: any): Band {
  if (!d || d.app !== 'stagecraft') throw new Error('Keine Stagecraft-Datei');
  const b = newBand(d.name ?? 'Band');
  b.members = d.members ?? [];
  b.songs = d.songs ?? [];
  b.setlists = d.setlists ?? [];
  b.gigs = d.gigs ?? [];
  b.gear = { ...emptyGear(), ...(d.gear ?? {}) };
  return b;
}

export function newMember(): Member {
  return { id: uid('m'), name: '', role: '', phone: '', email: '' };
}

export function newSong(title = ''): Song {
  return { id: uid('s'), title, duration: 0, bpm: 0, key: '', file: '', notes: '' };
}

export function newSetlist(name: string): Setlist {
  return { id: uid('l'), name, items: [] };
}

export const DEFAULT_SCHEDULE = ['Get-in', 'Soundcheck', 'Einlass', 'Show', 'Ende'];

export function newGig(date: string): Gig {
  return {
    id: uid('g'),
    title: '',
    date,
    venue: '',
    address: '',
    setlist: '',
    lineup: [],
    schedule: DEFAULT_SCHEDULE.map((label) => ({ id: uid('t'), label, time: '' })),
    contacts: [],
    notes: '',
  };
}

export function newContact(): Contact {
  return { id: uid('c'), name: '', role: '', phone: '', email: '' };
}

/** total length of a setlist in seconds */
export function setlistDuration(b: Band, l: Setlist): number {
  let s = 0;
  for (const it of l.items) {
    if (it.type === 'break') s += it.duration;
    else s += b.songs.find((x) => x.id === it.song)?.duration ?? 0;
  }
  return s;
}

/** "3:45" or "1:02:30" */
export function fmtDur(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "3:45", "225", "3.45" → seconds; null if not readable */
export function parseDur(txt: string): number | null {
  const v = txt.trim();
  if (!v) return 0;
  const parts = v.split(/[:.]/).map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((a, p) => a * 60 + Number(p), 0);
}
