// Import of the old "Karten VVK" Excel workbook into a gig's presale.
// Sheets: Information (prices, tiers, event), Ticket-Log (moves), one sheet per seller (buyers).
import { type Band, type Gig, type Holder, type Buyer, type TicketMove, type PriceTier, newBuyer, newMember, newMove } from './model';
import { type Sheet, type Cell, excelDate } from './xlsx';

const str = (v: Cell) => (v == null ? '' : String(v).trim());
const num = (v: Cell) => (typeof v === 'number' ? v : Number(str(v).replace(',', '.')) || 0);
const yes = (v: Cell) => /^(yes|ja|j|y|x|true|1|done|erledigt)$/i.test(str(v));
const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface ImportResult {
  members: string[]; // newly created
  moves: number;
  buyers: number;
  skipped: number; // rows without tickets
}

/** seller sheet = a sheet with a header row "Name | Karten normal | ..." */
function sellerHeader(s: Sheet): number {
  return s.rows.findIndex((r) => key(str(r[0])) === 'name' && /karten normal|tickets/i.test(str(r[1])));
}

export function looksLikeTicketWorkbook(sheets: Sheet[]): boolean {
  return sheets.some((s) => sellerHeader(s) >= 0) || sheets.some((s) => /ticket-log/i.test(s.name));
}

export function importTicketWorkbook(sheets: Sheet[], b: Band, g: Gig): ImportResult {
  const res: ImportResult = { members: [], moves: 0, buyers: 0, skipped: 0 };
  const tk = g.tickets;

  // ---- Information ----
  const info = sheets.find((s) => /^info/i.test(s.name));
  let event = '';
  let venue = '';
  let date = '';
  if (info) {
    const rows = info.rows;
    for (let i = 0; i < rows.length; i++) {
      const k = key(str(rows[i][0]));
      const v = rows[i][1];
      if (k === 'vvk-preis' || k === 'vvk') tk.presale = num(v) || tk.presale;
      else if (k === 'ak-preis' || k === 'ak') tk.door = num(v) || tk.door;
      else if (k === 'eventname' || k === 'event') event = str(v);
      else if (k === 'venue' || k === 'location') venue = str(v);
      else if (k === 'date' || k === 'datum') date = excelDate(v);
      else if (/graduation|staffel/.test(k)) {
        const tiers: PriceTier[] = [];
        for (let j = i + 1; j < rows.length && typeof rows[j][0] === 'number'; j++) {
          const t = { from: num(rows[j][0]), share: num(rows[j][1]) };
          if (!tiers.some((x) => x.from === t.from)) tiers.push(t);
        }
        if (tiers.length) tk.tiers = tiers;
      }
    }
  }
  if (!g.title && event) g.title = event;
  if (!g.venue && venue) g.venue = venue;
  if (date && (!g.title || g.title === event)) g.date = date;

  // ---- sellers -> members ----
  const sellerSheets = sheets.filter((s) => sellerHeader(s) >= 0);
  const holderOf = new Map<string, Holder>();
  for (const s of sellerSheets) {
    const name = s.name.trim();
    const n = key(name);
    let m = b.members.find((x) => key(x.name) === n) ?? b.members.find((x) => x.name && key(x.name).split(' ')[0] === n);
    if (!m) {
      m = newMember();
      m.name = name;
      b.members.push(m);
      res.members.push(name);
    }
    if (g.lineup.length && !g.lineup.includes(m.id)) g.lineup.push(m.id);
    holderOf.set(n, m.id);
  }
  const venueKeys = new Set([key(event), key(venue), 'veranstalter', 'venue'].filter(Boolean));
  const holder = (name: string): Holder => {
    const k = key(name);
    if (holderOf.has(k)) return holderOf.get(k)!;
    if (venueKeys.has(k)) return 'venue';
    return 'band';
  };

  // ---- Ticket-Log ----
  const moves: TicketMove[] = [];
  const log = sheets.find((s) => /ticket.?log|karten.?log/i.test(s.name));
  if (log) {
    const h = log.rows.findIndex((r) => /tickets|karten/i.test(str(r[1])) && /from|von/i.test(str(r[2])));
    for (const r of log.rows.slice(h + 1)) {
      const count = num(r[1]);
      const from = str(r[2]);
      const to = str(r[3]);
      if (!count || !from || !to) continue;
      const mv = newMove(holder(from), holder(to), count);
      mv.date = excelDate(r[0]);
      mv.note = str(r[4]);
      if (mv.from !== mv.to) moves.push(mv);
    }
  }

  // ---- buyers per seller sheet ----
  const buyers: Buyer[] = [];
  for (const s of sellerSheets) {
    const h = sellerHeader(s);
    const head = s.rows[h].map((c) => key(str(c)));
    const col = (re: RegExp, fb: number) => {
      const i = head.findIndex((x) => re.test(x));
      return i >= 0 ? i : fb;
    };
    const c = {
      normal: col(/karten normal/, 1),
      held: col(/hinterlegt/, 2),
      door: col(/vvk-liste|türliste/, 3),
      handed: col(/übergeben/, 5),
      paid: col(/geld erhalten/, 6),
      cash: col(/an kassa/, 7),
      date: col(/datum/, 8),
      note: col(/kommentar|comment/, -1),
    };
    const seller = holderOf.get(key(s.name))!;
    for (const r of s.rows.slice(h + 1)) {
      const name = str(r[0]);
      if (!name) continue;
      const by = newBuyer(seller);
      by.name = name;
      by.normal = num(r[c.normal]);
      by.held = num(r[c.held]);
      by.door = num(r[c.door]);
      by.note = c.note >= 0 ? str(r[c.note]) : '';
      if (!by.normal && !by.held && !by.door) {
        res.skipped++;
        continue;
      }
      by.handed = yes(r[c.handed]);
      by.cash = yes(r[c.cash]);
      by.paid = by.cash || yes(r[c.paid]);
      by.cashDate = by.cash ? excelDate(r[c.date]) : '';
      buyers.push(by);
    }
  }

  tk.moves = moves;
  tk.buyers = buyers;
  res.moves = moves.length;
  res.buyers = buyers.length;
  return res;
}
