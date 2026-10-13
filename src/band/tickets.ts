// Ticket presale per gig: contingent from the venue, tickets passed between sellers,
// buyer lists per seller, money flow (seller -> band cash) and the band/venue split.
import { t } from '../i18n';
import { icon } from '../icons';
import { el, iconBtn, input, select, esc, save } from './dom';
import { card, row, hint, columns, searchField } from './kit';
import { openPrintDialog } from '../print';
import { readXlsx } from './xlsx';
import { importTicketWorkbook, looksLikeTicketWorkbook } from './ticketsImport';
import {
  type Band, type Gig, type Buyer, type Holder,
  newBuyer, newMove, ticketStats, ticketTotals, fmtMoney,
} from './model';

let sellerFilter: Holder | '' = '';
let query = '';

function holders(b: Band, g: Gig): Holder[] {
  const ids = g.lineup.length ? g.lineup : b.members.map((m) => m.id);
  return ['band', ...ids.filter((id) => b.members.some((m) => m.id === id))];
}

export function holderName(b: Band, h: Holder): string {
  if (h === 'venue') return t('Veranstalter');
  if (h === 'band') return t('Bandkasse');
  return b.members.find((m) => m.id === h)?.name || '?';
}

const pct = (a: number, z: number) => (z > 0 ? Math.min(100, Math.round((a / z) * 100)) : 0);

export function renderTickets(d: HTMLElement, b: Band, g: Gig, rerender: () => void, confirm: (m: string) => Promise<boolean>) {
  const tk = g.tickets;
  const tot = ticketTotals(tk);

  // ---- summary ----
  const sum = el('div', 'tkSummary');
  const tile = (label: string, value: string, sub = '', cls = '') => sum.appendChild(el('div', 'tkTile ' + cls, `<span>${esc(label)}</span><b>${esc(value)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}`));
  tile(t('Verkauft'), String(tot.sold), t('{n} auf der Türliste', { n: tot.doorList }));
  tile(t('Personen'), String(tot.people), tk.doorSold ? t('inkl. {n} Abendkasse', { n: tk.doorSold }) : t('ohne Abendkasse'));
  tile(t('Kontingent'), String(tot.contingent), tot.needed > 0 ? t('{n} Karten fehlen', { n: tot.needed }) : t('{n} übrig', { n: -tot.needed }), tot.needed > 0 ? 'warn' : '');
  tile(t('Geld'), fmtMoney(tot.money), t('{a} eingesammelt · {b} in der Kasse', { a: fmtMoney(tot.paid), b: fmtMoney(tot.cash) }));
  tile(t('Bandanteil'), fmtMoney(tot.share), t('Veranstalter: {x}', { x: fmtMoney(tot.venue) }), 'accent');
  d.appendChild(sum);
  const bar = el('div', 'tkProgress', `<div style="width:${pct(tot.paid, tot.money)}%"></div><div class="cash" style="width:${pct(tot.cash, tot.money)}%"></div>`);
  bar.dataset.tip = t('Hell: eingesammelt · Dunkel: in der Bandkasse');
  d.appendChild(bar);

  const [left, right] = columns(d);

  // ---- prices & split ----
  const num = (obj: any, key: string, step = '1') => {
    const i = input(obj, key, '0', () => {}, 'pInput num', 'number');
    i.step = step;
    i.onchange = () => {
      save();
      rerender();
    };
    return i;
  };
  const sp = card(left, t('Preise & Aufteilung'), {
    addTip: t('Stufe hinzufügen'),
    add: () => {
      const last = tk.tiers[tk.tiers.length - 1];
      tk.tiers.push({ from: (last?.from ?? 0) + 30, share: last?.share ?? 3 });
      save();
      rerender();
    },
  });
  row(sp, t('VVK'), num(tk, 'presale', '0.5'), el('span', 'unit', '€'));
  row(sp, t('Abendkasse'), num(tk, 'door', '0.5'), el('span', 'unit', '€'));
  tk.tiers.sort((a, z) => a.from - z.from);
  tk.tiers.forEach((tr, i) => {
    const r = el('div', 'tkRow');
    r.append(el('span', '', esc(t('ab Karte'))), num(tr, 'from'), el('span', '', esc(t('→'))), num(tr, 'share', '0.5'), el('span', 'unit', esc(t('€ je Karte'))));
    if (tk.tiers.length > 1) r.appendChild(iconBtn('xmark', t('Stufe entfernen'), () => { tk.tiers.splice(i, 1); save(); rerender(); }, 'tb'));
    row(sp, i === 0 ? t('Bandanteil') : '', r);
  });
  hint(sp, t('Ab welcher Karte die Band wie viel bekommt. Der Rest des VVK-Gelds geht an den Veranstalter.'));
  row(sp, t('Abendkasse verkauft'), num(tk, 'doorSold'), el('span', 'unit', esc(t('Karten'))));

  // ---- sellers ----
  const ss = card(right, t('Verkäufer'));
  const tbl = el('div', 'tkSellers');
  tbl.appendChild(el('div', 'row head', `<span>${t('Wer')}</span><span>${t('erhalten')}</span><span>${t('verfügbar')}</span><span>${t('verkauft')}</span><span>${t('Geld')}</span>`));
  for (const h of holders(b, g)) {
    const s = ticketStats(tk, h);
    if (h === 'band' && !s.received && !s.sold && !s.given) continue;
    const r = el('div', 'row' + (sellerFilter === h ? ' on' : ''));
    r.innerHTML = `<span class="nm">${esc(holderName(b, h))}</span><span>${s.received - s.given}</span><span class="${s.available < 0 ? 'neg' : ''}">${s.available}</span><span>${s.sold}${s.doorList ? ` <i>+${s.doorList}</i>` : ''}</span><span class="money">${fmtMoney(s.money)}<i style="--p:${pct(s.paid, s.money)}%;--c:${pct(s.cash, s.money)}%"></i></span>`;
    r.dataset.tip = t('{a} eingesammelt, {b} in der Kasse', { a: fmtMoney(s.paid), b: fmtMoney(s.cash) });
    r.onclick = () => {
      sellerFilter = sellerFilter === h ? '' : h;
      rerender();
    };
    tbl.appendChild(r);
  }
  ss.appendChild(tbl);
  hint(ss, t('Klick filtert die Käuferliste.'));

  // ---- moves ----
  const sm = card(d, t('Kartenbewegungen'), {
    addTip: t('Kartenbewegung hinzufügen'),
    add: () => {
      const hs = holders(b, g);
      tk.moves.push(tk.moves.length ? newMove('band', hs[1] ?? 'band', 10) : newMove('venue', 'band', 50));
      save();
      rerender();
    },
  });
  if (!tk.moves.length) hint(sm, t('Zuerst: Kontingent vom Veranstalter an die Bandkasse. Dann an die Verkäufer verteilen.'));
  const opts: [string, string][] = [['venue', t('Veranstalter')], ...holders(b, g).map((h) => [h, holderName(b, h)] as [string, string])];
  for (const mv of tk.moves) {
    const r = el('div', 'moveRow');
    r.appendChild(input(mv, 'date', '', undefined, 'pInput', 'date'));
    const c = input(mv, 'count', '0', undefined, 'pInput num', 'number');
    c.onchange = () => { save(); rerender(); };
    r.appendChild(c);
    r.appendChild(select(opts, mv.from, (v) => { mv.from = v; save(); rerender(); }));
    r.appendChild(el('span', 'arrow', '→'));
    r.appendChild(select(opts, mv.to, (v) => { mv.to = v; save(); rerender(); }));
    r.appendChild(iconBtn('xmark', t('Entfernen'), () => { tk.moves = tk.moves.filter((x) => x !== mv); save(); rerender(); }, 'tb'));
    sm.appendChild(r);
  }

  // ---- buyers ----
  const q = searchField(query, (v) => {
    query = v;
    rerender();
  }, 'buyerSearch');
  const sb = card(d, sellerFilter ? t('Käufer von {x}', { x: holderName(b, sellerFilter) }) : t('Käufer'), {
    cls: 'tkBuyers',
    extra: [q],
    addTip: t('Käufer hinzufügen'),
    add: () => {
      const by = newBuyer(sellerFilter || holders(b, g)[1] || 'band');
      tk.buyers.push(by);
      save();
      rerender();
      const rows = document.querySelectorAll<HTMLInputElement>('#band .buyerRow input.name');
      rows[rows.length - 1]?.focus();
    },
  });
  const ql = query.trim().toLowerCase();
  const list = tk.buyers.filter((x) => (!sellerFilter || x.seller === sellerFilter) && (!ql || [x.name, x.note].join(' ').toLowerCase().includes(ql)));
  if (!tk.buyers.length) hint(sb, t('Pro Käufer: Name, Verkäufer und wie viele Karten – normal (Karte in der Hand), hinterlegt (an der Kassa) oder Türliste (zahlt vor Ort).'));
  else {
    sb.appendChild(el('div', 'buyerRow head', `<span>${t('Name')}</span><span>${t('Verkäufer')}</span><span data-tip="${esc(t('Karte wird übergeben'))}">${t('normal')}</span><span data-tip="${esc(t('an der Kassa hinterlegt'))}">${t('hinterl.')}</span><span data-tip="${esc(t('steht auf der Liste, zahlt an der Tür'))}">${t('Tür')}</span><span>${t('Betrag')}</span><span data-tip="${esc(t('Karte übergeben · Geld erhalten · Geld in der Bandkasse'))}">${t('Status')}</span><span></span>`));
    const sOpts = holders(b, g).map((h) => [h, holderName(b, h)] as [string, string]);
    for (const by of list) sb.appendChild(buyerRow(b, g, by, sOpts, rerender, confirm));
    const shown = list.reduce((a, x) => a + x.normal + x.held, 0);
    sb.appendChild(el('div', 'bandSum', esc(t('{n} Käufer · {k} Karten · {m}', { n: list.length, k: shown, m: fmtMoney(shown * tk.presale) }))));
  }
}

function buyerRow(b: Band, g: Gig, by: Buyer, sOpts: [string, string][], rerender: () => void, confirm: (m: string) => Promise<boolean>): HTMLElement {
  const tk = g.tickets;
  const r = el('div', 'buyerRow');
  r.appendChild(input(by, 'name', t('Name'), undefined, 'pInput name'));
  r.appendChild(select(sOpts, by.seller, (v) => { by.seller = v; save(); rerender(); }));
  for (const k of ['normal', 'held', 'door'] as const) {
    const i = input(by, k, '0', undefined, 'pInput num', 'number');
    if (!by[k]) i.value = '';
    i.min = '0';
    i.onchange = () => { by[k] = Math.max(0, Number(i.value) || 0); save(); rerender(); };
    r.appendChild(i);
  }
  r.appendChild(el('span', 'amt', fmtMoney((by.normal + by.held) * tk.presale)));
  const st = el('span', 'status');
  const tog = (key: 'handed' | 'paid' | 'cash', ic: Parameters<typeof icon>[0], tip: string, disabled = false) => {
    const btn = el('button', 'stat' + (by[key] ? ' on' : ''), icon(ic, 13));
    btn.dataset.tip = tip;
    btn.disabled = disabled;
    btn.onclick = () => {
      by[key] = !by[key];
      if (key === 'cash' && by.cash) {
        by.paid = true;
        if (!by.cashDate) by.cashDate = new Date().toISOString().slice(0, 10);
      }
      save();
      rerender();
    };
    st.appendChild(btn);
  };
  tog('handed', 'ticket', by.handed ? t('Karte übergeben') : t('Karte noch nicht übergeben'), !by.normal);
  tog('paid', 'euro', by.paid ? t('Geld erhalten') : t('Geld noch offen'), by.normal + by.held === 0);
  tog('cash', 'cashbox', by.cash ? t('in der Bandkasse seit {d}', { d: by.cashDate || '–' }) : t('noch nicht in der Bandkasse'), by.normal + by.held === 0);
  r.appendChild(st);
  r.appendChild(iconBtn('xmark', t('Entfernen'), async () => {
    if ((by.paid || by.handed) && !(await confirm(t('{x} entfernen?', { x: by.name || t('Käufer') })))) return;
    tk.buyers = tk.buyers.filter((x) => x !== by);
    save();
    rerender();
  }, 'tb'));
  const note = input(by, 'note', t('Notiz, z.B. „legt Benni aus“'), undefined, 'pInput note');
  r.appendChild(note);
  return r;
}

// ---------------- printing ----------------

export function importExcel(b: Band, g: Gig, rerender: () => void, confirm: (m: string) => Promise<boolean>, flash: (m: string) => void) {
  const inp = el('input');
  inp.type = 'file';
  inp.accept = '.xlsx';
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const sheets = await readXlsx(new Uint8Array(await f.arrayBuffer()));
      if (!looksLikeTicketWorkbook(sheets)) return flash(t('Keine Karten-VVK-Liste erkannt'));
      const tk = g.tickets;
      if ((tk.buyers.length || tk.moves.length) && !(await confirm(t('Vorverkauf dieses Gigs durch „{x}“ ersetzen?', { x: f.name })))) return;
      const r = importTicketWorkbook(sheets, b, g);
      save();
      rerender();
      flash(t('Importiert: {b} Käufer, {m} Bewegungen', { b: r.buyers, m: r.moves }) + (r.members.length ? ' · ' + t('neue Mitglieder: {x}', { x: r.members.join(', ') }) : ''));
    } catch (e) {
      console.error(e);
      flash(t('Datei konnte nicht gelesen werden'));
    }
  };
  inp.click();
}

export function printDoorList(b: Band, g: Gig) {
  const tk = g.tickets;
  const rows = tk.buyers.filter((x) => x.held || x.door).sort((a, z) => a.name.localeCompare(z.name));
  const body = `<style>
#printArea.sheet{font:12.5px -apple-system,Helvetica,Arial,sans-serif;color:#111;padding:6px}
.sheet h1{font-size:22px;margin:0 0 4px}.sheet .sub{color:#555;margin-bottom:14px}
.sheet table{border-collapse:collapse;width:100%}.sheet td,.sheet th{padding:5px 6px;text-align:left}
.sheet th{font-size:11px;color:#555}.sheet tr+tr td{border-top:0.5px solid #ccc}.sheet .n{text-align:right;width:70px}
.sheet .box{width:28px}.sheet .box::before{content:'';display:inline-block;width:12px;height:12px;border:1px solid #333;border-radius:2px}
</style>
<h1>${esc(t('Einlassliste'))} – ${esc(b.name)}</h1>
<div class="sub">${esc(g.title || g.venue)} · ${esc(g.date)} · ${esc(t('VVK {p} € · Abendkasse {d} €', { p: tk.presale, d: tk.door }))}</div>
<table><tr><th class="box"></th><th>${esc(t('Name'))}</th><th class="n">${esc(t('hinterlegt'))}</th><th class="n">${esc(t('Türliste (zahlt {p} €)', { p: tk.presale }))}</th><th>${esc(t('über'))}</th></tr>
${rows.map((x) => `<tr><td class="box"></td><td>${esc(x.name)}</td><td class="n">${x.held || ''}</td><td class="n">${x.door || ''}</td><td>${esc(holderName(b, x.seller))}</td></tr>`).join('')}
<tr><td></td><td><b>${esc(t('Gesamt'))}</b></td><td class="n"><b>${rows.reduce((a, x) => a + x.held, 0)}</b></td><td class="n"><b>${rows.reduce((a, x) => a + x.door, 0)}</b></td><td></td></tr></table>`;
  document.getElementById('printArea')?.remove();
  const area = el('div', 'sheet', body);
  area.id = 'printArea';
  document.body.appendChild(area);
  window.addEventListener('afterprint', () => setTimeout(() => area.remove(), 500), { once: true });
  void openPrintDialog();
}
