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
  phase: Phase;
  album: string; // album / EP / collection
  todos: Todo[];
  sounds: SoundCue[]; // e.g. Helix patch per part
}

export type Phase = 'idea' | 'writing' | 'arrangement' | 'production' | 'released' | 'live';

export const PHASES: { id: Phase; label: string; color: string }[] = [
  { id: 'idea', label: 'Idee', color: '#8e8e93' },
  { id: 'writing', label: 'Writing', color: '#ff9f0a' },
  { id: 'arrangement', label: 'Arrangement', color: '#bf5af2' },
  { id: 'production', label: 'Production', color: '#0a84ff' },
  { id: 'released', label: 'Released', color: '#30d158' },
  { id: 'live', label: 'Live', color: '#ff375f' },
];

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

export interface SoundCue {
  id: string;
  part: string; // "Intro", "Refrain", "ganzer Song"
  member: string; // who switches
  patch: string; // e.g. "02B Crunch"
  note: string;
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
  tickets: Tickets;
}

// ---------- ticket presale (Vorverkauf) ----------
// Successor of the "Karten VVK" Excel: the band gets a contingent from the venue,
// hands tickets to sellers (members), sellers keep buyer lists and collect the money.

/** "venue" = organizer, "band" = band cash box, otherwise Member.id */
export type Holder = string;

export interface TicketMove {
  id: string;
  date: string;
  count: number;
  from: Holder;
  to: Holder;
  note: string;
}

export interface Buyer {
  id: string;
  name: string;
  seller: Holder; // who sold it
  normal: number; // tickets handed out (paid in advance)
  held: number; // deposited at the box office ("hinterlegt", paid in advance)
  door: number; // on the presale list at the door (pays there, presale price)
  handed: boolean; // tickets given to the buyer
  paid: boolean; // money received by the seller
  cash: boolean; // money passed on to the band cash
  cashDate: string;
  note: string;
}

export interface PriceTier {
  from: number; // from this many sold tickets on …
  share: number; // … the band gets this much per ticket
}

export interface Tickets {
  presale: number; // VVK price
  door: number; // Abendkasse price
  tiers: PriceTier[];
  moves: TicketMove[];
  buyers: Buyer[];
  doorSold: number; // sold at the box office on the night (optional, after the gig)
}

export function newTickets(): Tickets {
  return { presale: 15, door: 17, tiers: [{ from: 0, share: 3 }], moves: [], buyers: [], doorSold: 0 };
}

export function newBuyer(seller: Holder): Buyer {
  return { id: uid('v'), name: '', seller, normal: 1, held: 0, door: 0, handed: false, paid: false, cash: false, cashDate: '', note: '' };
}

export function newMove(from: Holder, to: Holder, count: number): TicketMove {
  return { id: uid('w'), date: new Date().toISOString().slice(0, 10), count, from, to, note: '' };
}

/** band share for n sold tickets: tiers apply per ticket from their threshold on */
export function bandShare(tiers: PriceTier[], n: number): number {
  const ts = [...tiers].sort((a, b) => a.from - b.from);
  let sum = 0;
  for (let i = 0; i < ts.length; i++) {
    const a = Math.max(0, ts[i].from);
    const z = i + 1 < ts.length ? ts[i + 1].from : Infinity;
    const k = Math.max(0, Math.min(n, z) - a);
    sum += k * (ts[i].share || 0);
  }
  return sum;
}

export interface HolderStats {
  holder: Holder;
  received: number; // via moves
  given: number; // via moves
  sold: number; // normal + held of their buyers
  doorList: number;
  handed: number; // tickets physically given to buyers (normal, handed)
  available: number; // received - given - handed
  money: number;
  paid: number;
  cash: number;
}

export function ticketStats(t: Tickets, holder: Holder): HolderStats {
  const received = t.moves.filter((m) => m.to === holder).reduce((a, m) => a + m.count, 0);
  const given = t.moves.filter((m) => m.from === holder).reduce((a, m) => a + m.count, 0);
  const bs = t.buyers.filter((b) => b.seller === holder);
  const sold = bs.reduce((a, b) => a + b.normal + b.held, 0);
  const handed = bs.filter((b) => b.handed).reduce((a, b) => a + b.normal, 0);
  const val = (b: Buyer) => (b.normal + b.held) * t.presale;
  return {
    holder,
    received,
    given,
    sold,
    doorList: bs.reduce((a, b) => a + b.door, 0),
    handed,
    available: received - given - handed,
    money: bs.reduce((a, b) => a + val(b), 0),
    paid: bs.filter((b) => b.paid).reduce((a, b) => a + val(b), 0),
    cash: bs.filter((b) => b.cash).reduce((a, b) => a + val(b), 0),
  };
}

export function ticketTotals(t: Tickets) {
  const sold = t.buyers.reduce((a, b) => a + b.normal + b.held, 0);
  const doorList = t.buyers.reduce((a, b) => a + b.door, 0);
  const contingent = t.moves.filter((m) => m.from === 'venue').reduce((a, m) => a + m.count, 0) - t.moves.filter((m) => m.to === 'venue').reduce((a, m) => a + m.count, 0);
  const money = sold * t.presale;
  const share = bandShare(t.tiers, sold);
  return {
    sold,
    doorList,
    people: sold + doorList + (t.doorSold || 0),
    contingent,
    needed: sold - contingent, // tickets still missing (> 0) or spare (< 0), like the Excel: normal + deposited
    money,
    paid: t.buyers.filter((b) => b.paid).reduce((a, b) => a + (b.normal + b.held) * t.presale, 0),
    cash: t.buyers.filter((b) => b.cash).reduce((a, b) => a + (b.normal + b.held) * t.presale, 0),
    share,
    venue: money - share,
  };
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

// ---------- ideas ----------
export type IdeaKind = 'riff' | 'memo' | 'text';

export interface Idea {
  id: string;
  kind: IdeaKind;
  title: string;
  created: number;
  tags: string[];
  key: string;
  bpm: number;
  mood: string;
  note: string;
  text: string; // lyrics / text ideas
  song: string; // Song.id it belongs to
  clip?: any; // riff: editor clip (one track, selected bars)
  preview?: string; // riff: plain-text tab
  audio?: { name: string; type: string; duration: number }; // blob in IndexedDB
}

export function newIdea(kind: IdeaKind, title = ''): Idea {
  return { id: uid('x'), kind, title, created: Date.now(), tags: [], key: '', bpm: 0, mood: '', note: '', text: '', song: '' };
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
  ideas: Idea[];
  /** set up via the wizard or opened from a file; without it the app runs as plain Tabwriter */
  setup?: boolean;
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
  return { app: 'stagecraft', version: 1, name, members: [], songs: [], setlists: [], gigs: [], gear: emptyGear(), ideas: [] };
}

/** fill missing fields of older / hand-written files */
export function normalize(d: any): Band {
  if (!d || d.app !== 'stagecraft') throw new Error('Keine Stagecraft-Datei');
  const b = newBand(d.name ?? 'Band');
  b.setup = d.setup ?? !!(d.members?.length || d.songs?.length || d.gigs?.length || d.setlists?.length);
  b.members = d.members ?? [];
  b.songs = (d.songs ?? []).map((s: Song) => ({ ...newSong(), ...s, todos: s.todos ?? [], sounds: s.sounds ?? [] }));
  b.setlists = d.setlists ?? [];
  b.gigs = (d.gigs ?? []).map((g: Gig) => ({ ...g, money: { ...newMoney(), ...(g.money ?? {}) }, tickets: { ...newTickets(), ...(g.tickets ?? {}) } }));
  b.ideas = (d.ideas ?? []).map((x: Idea) => ({ ...newIdea(x.kind ?? 'text'), ...x, tags: x.tags ?? [] }));
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
  return { id: uid('s'), title, duration: 0, bpm: 0, key: '', file: '', notes: '', phase: 'writing', album: '', todos: [], sounds: [] };
}

export function newTodo(text = ''): Todo {
  return { id: uid('d'), text, done: false };
}

export function newSound(): SoundCue {
  return { id: uid('h'), part: '', member: '', patch: '', note: '' };
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
    tickets: newTickets(),
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
