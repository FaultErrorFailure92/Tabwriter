// Rehearsals: planned in the calendar (date, time, place, who, songs to work on).
import { t } from '../i18n';
import { icon } from '../icons';
import { el, esc, save } from './dom';
import { wizard, wizField, wizInput } from './kit';
import { type Band, type Rehearsal, uid } from './model';
import { awayOn, downloadIcs } from './gigextra';

type Ctx = { b: Band; rerender: () => void; confirm: (m: string) => Promise<boolean>; flash: (m: string) => void };

/** new rehearsal on `date`, or edit an existing one */
export async function rehearsalWizard(c: Ctx, at: string | Rehearsal) {
  const b = c.b;
  const old = typeof at === 'string' ? null : at;
  const last = [...b.rehearsals].sort((x, z) => x.date.localeCompare(z.date)).pop();
  const st: Omit<Rehearsal, 'id'> = old
    ? JSON.parse(JSON.stringify({ ...old, id: undefined }))
    : { date: at as string, from: last?.from || '19:00', to: last?.to || '22:00', place: last?.place ?? '', songs: [], lineup: b.members.map((m) => m.id), note: '' };
  let del = false;
  const r = await wizard<typeof st>({
    title: t('Probe'),
    state: st,
    finish: old ? t('Speichern') : t('Eintragen'),
    extra: old ? (foot, close) => {
      const d = el('button', 'btn plain danger', `${icon('trash', 13)}<span>${esc(t('Löschen'))}</span>`);
      d.type = 'button';
      d.onclick = () => { del = true; close(); };
      foot.appendChild(d);
      const ics = el('button', 'btn plain', `${icon('calendar', 13)}<span>.ics</span>`);
      ics.type = 'button';
      ics.dataset.tip = t('Kalendereinladung (.ics)');
      ics.onclick = () => void downloadIcs(b, [], `${t('Probe')} ${old.date}`, c.flash, [old]);
      foot.appendChild(ics);
    } : undefined,
    steps: [
      {
        title: t('Wann und wo?'),
        ok: (s) => !!s.date,
        body: (box, s, redraw) => {
          wizField(box, t('Datum'), wizInput(s.date, '', (v) => { s.date = v; redraw(); }, 'date'));
          const times = el('div', 'wizTimes');
          times.append(wizInput(s.from, '', (v) => (s.from = v), 'time'), el('span', '', '–'), wizInput(s.to, '', (v) => (s.to = v), 'time'));
          wizField(box, t('Zeit'), times);
          const pl = wizInput(s.place, t('z.B. Proberaum'), (v) => (s.place = v));
          const places = [...new Set(b.rehearsals.map((x) => x.place).filter(Boolean))];
          if (places.length) {
            const dl = el('datalist');
            dl.id = 'rehPlaces';
            for (const p of places) dl.appendChild(Object.assign(el('option'), { value: p }));
            box.appendChild(dl);
            pl.setAttribute('list', 'rehPlaces');
          }
          wizField(box, t('Ort'), pl);
          if (!b.members.length) return;
          const away = awayOn(b, s.date);
          const lineup = el('div', 'lineup');
          for (const m of b.members) {
            const ch = el('button', 'chipBtn' + (s.lineup.includes(m.id) ? ' on' : '') + (away.includes(m.id) ? ' away' : ''), esc(m.name || '?'));
            if (away.includes(m.id)) ch.dataset.tip = t('{x} hat an diesem Tag keine Zeit', { x: m.name });
            ch.type = 'button';
            ch.onclick = () => {
              s.lineup = s.lineup.includes(m.id) ? s.lineup.filter((x) => x !== m.id) : [...s.lineup, m.id];
              ch.classList.toggle('on');
            };
            lineup.appendChild(ch);
          }
          wizField(box, t('Wer'), lineup);
        },
      },
      {
        title: t('Was wird geprobt?'),
        text: b.songs.length ? t('Songs anklicken, an denen ihr arbeiten wollt.') : undefined,
        optional: true,
        body: (box, s) => {
          if (b.songs.length) {
            const list = el('div', 'wizPick');
            for (const so of b.songs) {
              const on = () => s.songs.includes(so.id);
              const row = el('button', 'wizPickRow' + (on() ? ' on' : ''), `<span class="n">${icon('checkmark', 11)}</span><span>${esc(so.title || t('Ohne Titel'))}</span><span class="d">${esc(so.tuning || '')}</span>`);
              row.type = 'button';
              row.onclick = () => {
                s.songs = on() ? s.songs.filter((x) => x !== so.id) : [...s.songs, so.id];
                row.classList.toggle('on', on());
              };
              list.appendChild(row);
            }
            box.appendChild(list);
          }
          const ta = el('textarea', 'pInput notes small');
          ta.placeholder = t('Notiz, z.B. Bridge von „X“ festlegen, neue Snare testen …');
          ta.value = s.note;
          ta.oninput = () => (s.note = ta.value);
          wizField(box, t('Notiz'), ta);
        },
      },
    ],
  });
  if (del && old) {
    if (!(await c.confirm(t('Probe am {x} löschen?', { x: new Date(old.date + 'T12:00').toLocaleDateString() })))) return;
    b.rehearsals = b.rehearsals.filter((x) => x !== old);
    save();
    c.rerender();
    return;
  }
  if (!r) return;
  if (old) Object.assign(old, r, { id: old.id });
  else b.rehearsals.push({ ...r, id: uid('r') });
  b.rehearsals.sort((x, z) => (x.date + x.from).localeCompare(z.date + z.from));
  save();
  c.rerender();
}

export function nextRehearsal(b: Band, today: string): Rehearsal | undefined {
  return b.rehearsals.filter((r) => r.date >= today).sort((x, z) => (x.date + x.from).localeCompare(z.date + z.from))[0];
}
