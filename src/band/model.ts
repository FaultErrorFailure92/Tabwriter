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
  money: GigMoney;
}

export interface Cost {
  id: string;
  label: string; // e.g. "Sprit", "Proberaum"
  amount: number;
  paidBy: string; // Member.id who advanced it, '' = band cash
}

export interface GigMoney {
  fee: number; // agreed fee
  paid: boolean; // fee received
  costs: Cost[];
  note: string; // invoice no., payment terms …
}

// ---------- stage: equipment, inputs, monitors, cables ----------
// Successor of the SwiftUI "Verkabelungsplan" app (Musician, Instrument, SignalChainObject,
// Effectboard, Mixer, FOH, PA, Cable, BOMItem), simplified to what a gig needs.

export type OwnerType = 'band' | 'member' | 'venue' | 'rental';

export type GearKind =
  | 'guitar' | 'bass' | 'keys' | 'drums' | 'vocals' | 'instrument'
  | 'effect' | 'amp' | 'di' | 'mic' | 'wireless' | 'monitor' | 'iem' | 'mixer' | 'pa' | 'power' | 'other';

export interface GearItem {
  id: string;
  name: string; // e.g. "Helix LT", "Marshall JCM800", "SM58"
  kind: GearKind;
  member: string; // Member.id who uses it ('' = shared)
  chain: number; // order within the member's signal chain
  owner: OwnerType;
  ownerMember: string; // Member.id when owner = member
  onStage: boolean; // shows up on the stage plan
  x: number; // m from stage left (as seen from the audience)
  y: number; // m from the front edge
  note: string;
}

export interface InputChannel {
  id: string;
  ch: number;
  source: string; // e.g. "Kick", "Git Benni"
  gear: string; // GearItem.id (optional)
  mic: string; // e.g. "Beta 91", "DI", "Line"
  stand: string; // "groß", "klein", "Clip", ""
  phantom: boolean;
  note: string;
}

export interface MonitorMix {
  id: string;
  name: string; // "Mon 1"
  kind: 'wedge' | 'iem';
  members: string[];
  note: string;
}

export type CableType = 'xlr' | 'jack' | 'jackTRS' | 'speakon' | 'midi' | 'usb' | 'ethernet' | 'power' | 'powerCon' | 'other';

export interface Cable {
  id: string;
  from: string; // GearItem.id or free text
  to: string; // GearItem.id, "ch:<n>" for an input channel, or free text
  type: CableType;
  length: number; // m, 0 = unknown
  count: number;
  owner: OwnerType;
  ownerMember: string;
}

export interface Stage {
  width: number; // m
  depth: number; // m
  members: Record<string, { x: number; y: number }>; // where each member stands
}

export interface Gear {
  items: GearItem[];
  inputs: InputChannel[];
  monitors: MonitorMix[];
  cables: Cable[];
  stage: Stage;
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
  return { items: [], inputs: [], monitors: [], cables: [], stage: { width: 8, depth: 5, members: {} } };
}

export const GEAR_KINDS: [GearKind, string][] = [
  ['guitar', 'Gitarre'], ['bass', 'Bass'], ['keys', 'Keys'], ['drums', 'Drums'], ['vocals', 'Gesang'], ['instrument', 'Instrument'],
  ['effect', 'Effekt / Board'], ['amp', 'Amp / Box'], ['di', 'DI-Box'], ['mic', 'Mikrofon'], ['wireless', 'Funk'],
  ['monitor', 'Monitor'], ['iem', 'In-Ear'], ['mixer', 'Mischpult'], ['pa', 'PA'], ['power', 'Strom'], ['other', 'Sonstiges'],
];

export const CABLE_TYPES: [CableType, string][] = [
  ['xlr', 'XLR'], ['jack', 'Klinke (TS)'], ['jackTRS', 'Klinke (TRS)'], ['speakon', 'Speakon'], ['midi', 'MIDI'],
  ['usb', 'USB'], ['ethernet', 'Netzwerk'], ['power', 'Strom (Schuko)'], ['powerCon', 'powerCON'], ['other', 'Sonstiges'],
];

export const OWNERS: [OwnerType, string][] = [['band', 'Band'], ['member', 'Mitglied'], ['venue', 'Venue'], ['rental', 'Verleih']];

export function newGearItem(kind: GearKind, member = ''): GearItem {
  return { id: uid('e'), name: '', kind, member, chain: 0, owner: member ? 'member' : 'band', ownerMember: member, onStage: false, x: 0, y: 0, note: '' };
}

export function newInput(ch: number): InputChannel {
  return { id: uid('i'), ch, source: '', gear: '', mic: '', stand: '', phantom: false, note: '' };
}

export function newMonitor(n: number): MonitorMix {
  return { id: uid('o'), name: `Mon ${n}`, kind: 'wedge', members: [], note: '' };
}

export function newCable(): Cable {
  return { id: uid('k'), from: '', to: '', type: 'xlr', length: 0, count: 1, owner: 'band', ownerMember: '' };
}

/** stage gear kinds that are placed by default */
export const STAGE_KINDS: GearKind[] = ['drums', 'keys', 'amp', 'monitor', 'di', 'power', 'pa', 'mic'];

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
  b.gigs = (d.gigs ?? []).map((g: Gig) => ({ ...g, money: { ...newMoney(), ...(g.money ?? {}) } }));
  const g = d.gear ?? {};
  const e = emptyGear();
  b.gear = {
    items: Array.isArray(g.items) ? g.items : e.items,
    inputs: Array.isArray(g.inputs) ? g.inputs : e.inputs,
    monitors: Array.isArray(g.monitors) ? g.monitors : e.monitors,
    cables: Array.isArray(g.cables) ? g.cables : e.cables,
    stage: { ...e.stage, ...(g.stage ?? {}) },
  };
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
    money: newMoney(),
  };
}

export function newMoney(): GigMoney {
  return { fee: 0, paid: false, costs: [], note: '' };
}

export function newCost(): Cost {
  return { id: uid('$'), label: '', amount: 0, paidBy: '' };
}

/** fee minus costs, split evenly over the lineup; who advanced costs gets them back */
export function settle(b: Band, g: Gig): { costs: number; net: number; share: number; payout: { member: string; amount: number }[] } {
  const costs = g.money.costs.reduce((a, c) => a + (c.amount || 0), 0);
  const net = (g.money.fee || 0) - costs;
  const people = g.lineup.filter((id) => b.members.some((m) => m.id === id));
  const share = people.length ? net / people.length : 0;
  const payout = people.map((id) => ({
    member: id,
    amount: share + g.money.costs.filter((c) => c.paidBy === id).reduce((a, c) => a + (c.amount || 0), 0),
  }));
  return { costs, net, share, payout };
}

export function fmtMoney(v: number): string {
  return (Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
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
