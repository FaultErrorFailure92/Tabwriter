// Tours: optional grouping of gigs with a small summary.
import { t } from '../i18n';
import { icon } from '../icons';
import { el, esc, save } from './dom';
import { popMenu, wizard, wizField, wizInput, type MenuItem } from './kit';
import { type Band, type Gig, type Tour, uid, settle, fmtMoney, ticketTotals } from './model';

export const NEW_TOUR = '\u0001new';

export async function tourWizard(b: Band, tour?: Tour): Promise<Tour | null> {
  const r = await wizard<{ name: string; note: string }>({
    title: t('Tour'),
    state: { name: tour?.name ?? '', note: tour?.note ?? '' },
    finish: tour ? t('Speichern') : t('Anlegen'),
    steps: [{
      title: tour ? t('Tour bearbeiten') : t('Neue Tour'),
      text: t('Gigs lassen sich einer Tour zuordnen. In der Gig-Liste kannst du dann nach Tour filtern und siehst die Summen.'),
      ok: (s) => !!s.name.trim(),
      body: (box, s, redraw) => {
        wizField(box, t('Name'), wizInput(s.name, t('z.B. Frühjahrstour 2027'), (v) => { s.name = v; redraw(); }));
        wizField(box, t('Notiz'), wizInput(s.note, t('optional, z.B. Booking über …'), (v) => (s.note = v)));
      },
    }],
  });
  if (!r) return null;
  const x = tour ?? { id: uid('tour'), name: '', note: '' };
  x.name = r.name.trim();
  x.note = r.note.trim();
  if (!tour) b.tours.push(x);
  save();
  return x;
}

export const tourOf = (b: Band, g: Gig) => (g.tour ? b.tours.find((x) => x.id === g.tour) : undefined);

/** select options for a gig's tour; the last entry creates a new tour */
export function tourOptions(b: Band): [string, string][] {
  return [['', t('Keine Tour')], ...b.tours.map((x) => [x.id, x.name] as [string, string]), [NEW_TOUR, t('Neue Tour …')]];
}

/** summary block on top of the gig list when filtered by a tour */
export function tourSummary(b: Band, tour: Tour, rerender: () => void, confirm: (m: string) => Promise<boolean>, onDelete: () => void): HTMLElement {
  const gigs = b.gigs.filter((g) => g.tour === tour.id).sort((a, z) => (a.date || '9').localeCompare(z.date || '9'));
  const dated = gigs.filter((g) => g.date);
  const fmt = (d: string, y: boolean) => new Date(d + 'T12:00').toLocaleDateString(undefined, y ? { day: '2-digit', month: '2-digit', year: 'numeric' } : { day: '2-digit', month: '2-digit' });
  const a = dated[0]?.date ?? '';
  const z = dated[dated.length - 1]?.date ?? '';
  const span = !a ? '' : a === z ? fmt(a, true) : `${fmt(a, a.slice(0, 4) !== z.slice(0, 4))} – ${fmt(z, true)}`;
  const fee = gigs.reduce((a, g) => a + (g.money.fee || 0), 0);
  const open = gigs.filter((g) => !g.money.paid).reduce((a, g) => a + (g.money.fee || 0), 0);
  const net = gigs.reduce((a, g) => a + settle(b, g).net, 0);
  const sold = gigs.reduce((a, g) => a + ticketTotals(g.tickets).sold, 0);
  const box = el('div', 'tourSum');
  const head = el('div', 'tourHead', `${icon('route', 14)}<b>${esc(tour.name)}</b>`);
  const more = el('button', 'tb', icon('ellipsis', 14));
  more.dataset.tip = t('Tour bearbeiten');
  more.onclick = () => popMenu(more, [
    { icon: 'pencil', label: t('Umbenennen …'), fn: async () => { if (await tourWizard(b, tour)) rerender(); } },
    'sep',
    { icon: 'trash', label: t('Tour löschen'), danger: true, fn: async () => {
      if (!(await confirm(t('Tour „{x}“ löschen? Die Gigs bleiben erhalten.', { x: tour.name })))) return;
      b.tours = b.tours.filter((x) => x !== tour);
      for (const g of b.gigs) if (g.tour === tour.id) g.tour = '';
      save();
      onDelete();
    } },
  ] as MenuItem[]);
  head.appendChild(more);
  box.appendChild(head);
  const stats: [string, string][] = [
    [t('Gigs'), String(gigs.length)],
    [t('Zeitraum'), span || '–'],
    [t('Gagen'), fmtMoney(fee)],
  ];
  if (open) stats.push([t('davon offen'), fmtMoney(open)]);
  stats.push([t('Netto nach Kosten'), fmtMoney(net)]);
  if (sold) stats.push([t('Vorverkauf'), t('{n} Karten', { n: sold })]);
  box.appendChild(el('div', 'tourStats', stats.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('')));
  if (tour.note) box.appendChild(el('div', 'tourNote', esc(tour.note)));
  return box;
}
