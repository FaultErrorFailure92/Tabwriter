// Technical & band rider and stage plot, built from what the band already entered
// (members, instruments, gear with owner, inputs, monitors, stage plan, crew, gig).
// Layout follows the band's own rider template; texts are defaults that can be overridden.
import { t } from '../i18n';
import { icon } from '../icons';
import { el, esc, input, select, iconBtn, save } from './dom';
import { card, row, hint, toggle, columns, type MenuItem } from './kit';
import { openPrintDialog } from '../print';
import { md } from './md';
import { type Band, type Gig, type GearItem, type GearKind, type Rider, GEAR_KINDS, uid } from './model';
import { instrumentOf, GEAR_CATALOG } from './catalog';
import { chainOf, gearLabel } from './gear';

type Lang = 'de' | 'en';

// ---------------- texts ----------------

const TX: Record<string, [string, string]> = {
  title: ['Technical- & Band-Rider', 'Technical- & Band-Rider'],
  event: ['Veranstaltung / Ort', 'Event / Location'],
  date: ['Datum', 'Date'],
  sigEvent: ['Unterschrift (Veranstalter)', 'Signature (Event)'],
  sigBand: ['Unterschrift ({b})', 'Signature ({b})'],
  history: ['Änderungen', 'Change History'],
  version: ['Version', 'Version'],
  changes: ['Änderungen', 'Changes'],
  by: ['Von', 'Written by'],
  agreement: ['Allgemeine Vereinbarung', 'General Agreement'],
  contact: ['Kontakt', 'Contact'],
  topic: ['Thema', 'Related Topics'],
  band: ['Band & Crew', 'Band & Crew'],
  name: ['Name', 'Name'],
  func: ['Funktion', 'Function'],
  equipment: ['Equipment & Backline', 'Used / Needed Equipment & Backline'],
  equipNote: ['Hinweis: Kursiv geschriebenes Equipment bringt {b} mit. Mikrofon-/DI-Verkabelung stellt der Veranstalter!', 'Note: Equipment written in italics will be provided by {b}. Microphone/DI cabling has to be provided by the venue!'],
  person: ['Person / Position', 'Person / Stage Side'],
  needed: ['Equipment', 'Used / Needed Equipment'],
  socket: ['{n}× 230V/16A Steckdose', '{n}x 230V/16A AC socket needed'],
  inputs: ['Kanalliste', 'Input List'],
  ch: ['Kanal', 'Ch'],
  source: ['Quelle', 'Source'],
  mic: ['Mikro / DI', 'Mic / DI'],
  stand: ['Stativ', 'Stand'],
  monitoring: ['Monitoring', 'Monitoring'],
  who: ['Wer', 'Who'],
  mix: ['Monitor-Mix', 'Monitor Mix'],
  foh: ['PA, FOH & Licht', 'Frontline (PA), Front of House (F.O.H.) & Stage Light'],
  check: ['Sound- & Linecheck', 'Sound- & Line-Check'],
  plot: ['Stage Plot', 'Stage Plot'],
  extras: ['Weitere Themen', 'Additional Topics'],
  backstage: ['Lager- / Backstage-Raum', 'Storage- / Backstage-Room'],
  catering: ['Catering', 'Catering'],
  drinks: ['Getränke', 'Drinks'],
  times: ['Vor & nach der Show', 'Before & After the Show'],
  schedule: ['Zeitplan', 'Schedule'],
  merch: ['Merchandise', 'Merchandise'],
  photo: ['Fotos & Crew', 'Photographer & Stage Crew'],
  thanks: ['Zum Schluss', 'Last but not Least'],
  left: ['Bühne links', 'stage left'],
  right: ['Bühne rechts', 'stage right'],
  center: ['Mitte', 'center'],
  front: ['vorne', 'front'],
  back: ['hinten', 'back'],
  noMonitor: ['kein eigener Monitor', 'no extra monitor'],
  plotTitle: ['Stage Plot {v}', 'Stage Plot {v}'],
  audience: ['Publikum', 'Audience'],
  amp: ['AMP', 'AMP'],
};
const L = (lang: Lang, k: string, v: Record<string, string | number> = {}) => (TX[k]?.[lang === 'en' ? 1 : 0] ?? k).replace(/\{(\w+)\}/g, (_, x) => String(v[x] ?? ''));

/** default section texts; {b} = band name, {n} = people, {v} = vehicles */
const DEFAULTS: Record<string, [string, string]> = {
  agreement: [
    'Dieses Dokument ist ausnahmslos Teil jeder Show und jedes Vertrags mit der Band „{b}“. Der Technical Rider ist damit für Veranstalter, deren Vertreter und Mitarbeiter:innen vor Ort verbindlich.\nJe nach Location oder Veranstaltung können sich Anforderungen im Einzelfall ändern. Änderungen gelten nur, wenn sie von {b} und dem Veranstalter schriftlich bestätigt wurden.',
    'Without any exception, this document is part of every show or contract with the band “{b}”. Thus, this technical rider is binding for organizers and their representatives and employees at the venue.\nDepending on the venue or event type, the requirements may change in individual cases. These changes are only effective if agreed and confirmed by {b} and the venue in a written statement.',
  ],
  monitoring: [
    'Die Monitor-Boxen stellt der Veranstalter. Als Richtwert für die Tontechnik gilt folgende Tabelle.',
    'Monitoring cabinets have to be provided by the venue. As a general approach for the sound engineer the following table should be considered.',
  ],
  check: [
    'Vor der Show soll – wenn möglich – ein vollständiger Soundcheck mit {b} stattfinden. Ist das nicht möglich (Running Order, Zeit …), bitte vorher Bescheid geben. Ein Linecheck vor der Show ist in jedem Fall nötig.',
    'As part of the preparation before the show, it is necessary, if possible, to perform a complete sound check by {b}. If this is not possible (due to the running order, time constraints, etc.) this must be reported. Before the show it is necessary to do a line check in any case.',
  ],
  backstage: [
    'Wenn möglich, braucht {b} einen Raum, in dem ungestört von Publikum und Lärm Folgendes möglich ist:',
    'If possible, there has to be a room where {b} can do the following activities without being disturbed by audience, noise, etc.:',
  ],
  drinks: [
    'Die Getränke müssen für die gesamte Dauer der Veranstaltung für Band & Crew ({n} Personen) reichen.',
    'The drinks provided must be sufficient for the duration of the event for the entire band & crew ({n} people).',
  ],
  times: [
    'Wichtige Zeiten bitte rechtzeitig vor dem Showtag an {b} schicken: Ankunft, Aufbau, Sound-/Linecheck, Showzeit, Running Order, Abbau.\n{b} reist mit {v} Fahrzeug(en) an – bitte Parkplatz und Zufahrt zur Location einplanen.',
    'Important times and schedules must be communicated towards {b} in time before the day of the show: arrival, setup, sound/line check, show time, running order, load-out.\n{b} is traveling to the venue with {v} vehicle(s). A corresponding parking space and access to the location is necessary.',
  ],
  thanks: [
    'Danke, dass ihr {b} gebucht habt! Bei Fragen oder wenn etwas davon nicht möglich ist, meldet euch bitte (siehe Kontakt) – wir finden eine Lösung.',
    'Thank you for booking {b}. If there are any questions or if you have trouble providing any of the above mentioned, please get in touch with us (see contact) and we will work out a solution.',
  ],
};

export const BACKSTAGE: [string, string, string][] = [
  ['storage', 'Equipment lagern (wenn möglich absperrbar)', 'Store equipment (if possible: lockable room)'],
  ['warmup', 'Einsingen & Einspielen', 'Vocal and instrument warm-up'],
  ['change', 'Umziehen vor/nach der Show', 'Change clothes before/after the show'],
  ['shower', 'Dusche', 'Shower (nice to have)'],
  ['toilet', 'Eigene Toilette', 'Separate toilet (nice to have)'],
  ['charge', 'Handys, Kameras usw. laden', 'Charge smartphones, cameras and other devices'],
  ['eat', 'Essen & Trinken', 'Eat & drink'],
  ['smoke', 'Raucherbereich', 'Smoking area (if possible)'],
];
export const DRINKS: [string, string, string][] = [
  ['water', 'Wasser still & prickelnd (Pflicht!)', 'Water – sparkling & still (MUST HAVE!)'],
  ['beer', 'Bier', 'Beer'],
  ['coffee', 'Kaffee', 'Coffee'],
  ['soft', 'Softdrinks', 'Soft drinks'],
  ['alcfree', 'Alkoholfreies Bier', 'Alcohol-free beer'],
  ['tea', 'Tee', 'Tea'],
];
export const DIETS: [string, string, string][] = [
  ['vegan', 'vegan', 'vegan'], ['veggie', 'vegetarisch', 'vegetarian'], ['gluten', 'glutenfrei', 'gluten-free'], ['lactose', 'laktosefrei', 'lactose-free'],
];

export const SECTIONS: [string, string][] = [
  ['history', 'Änderungen'], ['agreement', 'Allgemeine Vereinbarung'], ['contact', 'Kontakt'], ['band', 'Band & Crew'],
  ['equipment', 'Equipment & Backline'], ['inputs', 'Kanalliste'], ['monitoring', 'Monitoring'], ['foh', 'PA, FOH & Licht'],
  ['check', 'Sound- & Linecheck'], ['plot', 'Stage Plot'], ['backstage', 'Backstage-Raum'], ['catering', 'Catering'],
  ['drinks', 'Getränke'], ['times', 'Vor & nach der Show'], ['merch', 'Merchandise'], ['photo', 'Fotos & Crew'], ['thanks', 'Zum Schluss'],
];
const EDITABLE = new Set(Object.keys(DEFAULTS));

function lang(r: Rider): Lang {
  return (r as Rider & { lang?: Lang }).lang ?? 'en';
}

function fill(b: Band, s: string, g: Gig | null) {
  return s.replace(/\{b\}/g, b.name).replace(/\{n\}/g, String(people(b, g))).replace(/\{v\}/g, String(b.rider.vehicles || 1));
}
function text(b: Band, id: string, g: Gig | null): string {
  const r = b.rider;
  return fill(b, r.texts[id] ?? DEFAULTS[id]?.[lang(r) === 'en' ? 1 : 0] ?? '', g);
}
const paras = (s: string) => md(s.replace(/\n(?!\n)/g, '\n\n').replace(/\n{3,}/g, '\n\n').replace(/\n\n(?=\s*([-*•]|\d+[.)])\s)/g, '\n'));

function members(b: Band, g: Gig | null) {
  return g && g.lineup.length ? b.members.filter((m) => g.lineup.includes(m.id)) : b.members;
}
function crewOf(b: Band, g: Gig | null) {
  if (g) return g.crew.map((c) => ({ p: b.crew.find((x) => x.id === c.person), task: c.task })).filter((x) => x.p).map((x) => ({ ...x.p!, role: x.task || x.p!.role }));
  return b.crew;
}
function people(b: Band, g: Gig | null) {
  return members(b, g).length + crewOf(b, g).length;
}
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 3);

/** role text from the instruments, e.g. "E-Gitarre, Gesang" */
function roleOf(b: Band, mid: string, lg: Lang): string {
  const ins = chainOf(b, mid).filter((g) => g.preset);
  if (!ins.length) return b.members.find((m) => m.id === mid)?.role ?? '';
  return [...new Set(ins.map((g) => (lg === 'en' ? EN_INS[g.preset!] : undefined) ?? gearLabel(g)))].join(', ');
}
const EN_INS: Record<string, string> = { eg6: 'Guitar', eg7: '7-string guitar', ag: 'Acoustic guitar', cg: 'Classical guitar', b4: 'Bass', b5: '5-string bass', drums: 'Drums', vocals: 'Vocals', keys: 'Keys', synth: 'Synth', organ: 'Organ' };

/** stage side as seen from the band (stage left = audience right) */
function side(b: Band, mid: string, lg: Lang): string {
  const s = b.gear.stage;
  const p = s.members[mid];
  if (!p) return '';
  const lr = p.x < s.width / 3 ? 'right' : p.x > (s.width * 2) / 3 ? 'left' : 'center';
  const fb = p.y > s.depth / 2 ? 'back' : 'front';
  return `${L(lg, lr)}, ${L(lg, fb)}`;
}

const POWERED: GearKind[] = ['amp', 'effect', 'keys', 'wireless', 'iem', 'mixer', 'monitor'];
const kindName = (k: GearKind) => t(GEAR_CATALOG.find((x) => x.kind === k)?.label ?? GEAR_KINDS.find(([x]) => x === k)?.[1] ?? k);
const bandBrings = (g: GearItem) => g.owner === 'band' || g.owner === 'member';

const standText = (st: string, lg: Lang) => (lg === 'en' ? ({ groß: 'tall', klein: 'short', Clip: 'clip' } as Record<string, string>)[st] ?? st : t(st));
const EN_KIND: Partial<Record<GearKind, string>> = { effect: 'Effects / Pedalboard', amp: 'Amp / Cabinet', di: 'DI box', mic: 'Microphone', wireless: 'Wireless system', monitor: 'Monitor', iem: 'In-ear', mixer: 'Mixer', pa: 'PA', power: 'Power', other: 'Other', guitar: 'Guitar', bass: 'Bass', keys: 'Keys', drums: 'Drum kit', vocals: 'Vocal microphone' };
function kindText(g: GearItem, lg: Lang) {
  if (lg === 'en') return (g.preset && EN_INS[g.preset]) || EN_KIND[g.kind] || g.kind;
  return instrumentOf(g.preset) ? gearLabel(g) : kindName(g.kind);
}
function itemText(g: GearItem, lg: Lang): string {
  const kind = kindText(g, lg);
  const what = g.name && g.name.toLowerCase() !== kind.toLowerCase() ? `${g.name} (${kind})` : kind;
  return `${what}${g.note ? ` – ${g.note}` : ''}`;
}
/** "1× …" lines, identical items counted together; italic = the band brings it */
function itemLines(items: GearItem[], lg: Lang): string[] {
  const m = new Map<string, { n: number; band: boolean }>();
  for (const x of items) {
    const k = itemText(x, lg);
    const v = m.get(k) ?? { n: 0, band: bandBrings(x) };
    v.n++;
    m.set(k, v);
  }
  return [...m].map(([k, v]) => (v.band ? `<i>${v.n}× ${esc(k)}</i>` : `<b>${v.n}× ${esc(k)}</b>`));
}

// ---------------- rider html ----------------

export function riderHtml(b: Band, g: Gig | null): string {
  const r = b.rider;
  const lg = lang(r);
  const on = (id: string) => !r.off.includes(id);
  const sec = (id: string, k: string) => `<h2>${esc(L(lg, k))}</h2>`;
  let h = `<div class="cover"><div class="head">${b.logo ? `<img src="${b.logo}" alt="">` : ''}<div><h1>${esc(L(lg, 'title'))}</h1><div class="sub">${esc(b.name)} · ${esc(r.version)}</div></div></div>`;
  h += `<table class="event"><tr><td>${esc(L(lg, 'event'))}:</td><td>${esc(g ? [g.title, g.venue].filter(Boolean).join(' – ') : '')}</td></tr><tr><td>${esc(L(lg, 'date'))}:</td><td>${esc(g?.date ? new Date(g.date + 'T12:00').toLocaleDateString(lg === 'en' ? 'en-GB' : 'de-AT') : '')}</td></tr><tr><td>${esc(L(lg, 'sigEvent'))}:</td><td class="sig"></td></tr><tr><td>${esc(L(lg, 'sigBand', { b: b.name }))}:</td><td class="sig"></td></tr></table></div>`;

  if (on('history') && r.history.length) h += sec('history', 'history') + `<table class="grid"><tr><th>${esc(L(lg, 'version'))}</th><th>${esc(L(lg, 'date'))}</th><th>${esc(L(lg, 'changes'))}</th><th>${esc(L(lg, 'by'))}</th></tr>${r.history.map((v) => `<tr><td>${esc(v.version)}</td><td>${esc(v.date)}</td><td>${esc(v.changes)}</td><td>${esc(initials(personName(b, v.by)))}</td></tr>`).join('')}</table>`;
  if (on('agreement')) h += sec('agreement', 'agreement') + paras(text(b, 'agreement', g));
  if (on('contact') && (r.contacts.length || b.contact.email || b.contact.web || b.links.some((l) => l.url))) {
    const rows = r.contacts.length
      ? r.contacts.map((c) => `<tr><td>${esc(c.topic)}</td><td>${esc([personName(b, c.person), c.phone, c.email || b.contact.email].filter(Boolean).join(' / '))}</td></tr>`).join('')
      : `<tr><td>${esc(b.name)}</td><td>${esc([b.contact.phone, b.contact.email, b.contact.web].filter(Boolean).join(' / '))}</td></tr>`;
    const web = [b.contact.web, ...b.links.filter((l) => l.url).map((l) => l.url)].filter(Boolean);
    const webRow = web.length ? `<tr><td>${esc(lg === 'en' ? 'Web & Social Media' : 'Web & Social Media')}</td><td>${web.map((u) => esc(u.replace(/^https?:\/\//, ''))).join('<br>')}</td></tr>` : '';
    h += sec('contact', 'contact') + `<table class="grid"><tr><th>${esc(L(lg, 'topic'))}</th><th>${esc(L(lg, 'contact'))}</th></tr>${rows}${webRow}</table>`;
  }
  if (on('band')) {
    const rows = [...members(b, g).map((m) => [`${m.name} (${initials(m.name)})`, roleOf(b, m.id, lg)]), ...crewOf(b, g).map((c) => [c.name, c.role])];
    h += sec('band', 'band') + `<table class="grid"><tr><th>${esc(L(lg, 'name'))}</th><th>${esc(L(lg, 'func'))}</th></tr>${rows.map(([n, f]) => `<tr><td>${esc(n)}</td><td>${esc(f)}</td></tr>`).join('')}</table>`;
  }
  if (on('equipment')) {
    h += sec('equipment', 'equipment') + `<p class="note">${esc(L(lg, 'equipNote', { b: b.name }))}</p><table class="grid"><tr><th>${esc(L(lg, 'person'))}</th><th>${esc(L(lg, 'needed'))}</th></tr>`;
    for (const m of members(b, g)) {
      const items = chainOf(b, m.id);
      const mics = b.gear.inputs.filter((c) => items.some((x) => x.id === c.gear) && c.mic && !/^(di|line)/i.test(c.mic) && !items.some((x) => x.kind === 'mic' && x.name === c.mic));
      const power = items.filter((x) => POWERED.includes(x.kind)).length + items.filter((x) => x.kind === 'power').length;
      const lines = [
        ...itemLines(items.filter((x) => x.kind !== 'power'), lg),
        ...mics.map((c) => `1× ${esc(c.mic)} (${esc(c.source)})${c.stand ? ` + ${esc(standText(c.stand, lg))} ${esc(L(lg, 'stand'))}` : ''}`),
        ...(power ? [esc(L(lg, 'socket', { n: power }))] : []),
      ];
      h += `<tr><td><b>${esc(roleOf(b, m.id, lg) || m.name)}</b><br>(${esc([side(b, m.id, lg), initials(m.name)].filter(Boolean).join(') ('))})</td><td>${lines.join('<br>') || '–'}</td></tr>`;
    }
    const shared = chainOf(b, '');
    if (shared.length) h += `<tr><td><b>${esc(b.name)}</b></td><td>${itemLines(shared, lg).join('<br>')}</td></tr>`;
    h += '</table>';
  }
  const inputs = [...b.gear.inputs].sort((a, z) => a.ch - z.ch);
  if (on('inputs') && inputs.length) h += sec('inputs', 'inputs') + `<table class="grid"><tr><th>${esc(L(lg, 'ch'))}</th><th>${esc(L(lg, 'source'))}</th><th>${esc(L(lg, 'mic'))}</th><th>${esc(L(lg, 'stand'))}</th><th>48V</th></tr>${inputs.map((c) => `<tr><td>${c.ch}</td><td>${esc(c.source)}</td><td>${esc(c.mic)}</td><td>${esc(standText(c.stand, lg))}</td><td>${c.phantom ? '✓' : ''}</td></tr>`).join('')}</table>`;
  if (on('monitoring')) {
    const mons = b.gear.monitors;
    let txt = text(b, 'monitoring', g);
    if (r.monitorsMin) txt += lg === 'en' ? ` At least ${r.monitorsMin} cabinets have to be available.` : ` Mindestens ${r.monitorsMin} Boxen werden benötigt.`;
    const rows = members(b, g).map((m) => {
      const mo = mons.find((x) => x.members.includes(m.id));
      return `<tr><td>${esc(initials(m.name))} – ${esc(mo ? mo.name : L(lg, 'noMonitor'))}${mo?.kind === 'iem' ? ' (In-Ear)' : ''}</td><td>${esc(mo?.note || '')}</td></tr>`;
    });
    h += sec('monitoring', 'monitoring') + paras(txt) + (mons.length ? `<table class="grid"><tr><th>${esc(L(lg, 'who'))}</th><th>${esc(L(lg, 'mix'))}</th></tr>${rows.join('')}</table>` : '');
  }
  if (on('foh')) {
    const tx = r.texts.foh ?? (lg === 'en'
      ? `The PA and stage lights are ${r.ownLight ? 'partly' : 'not'} provided by ${b.name}. This has to be done by the venue/organizer and should at least be appropriate for the venue.\n${r.ownFoh ? `${b.name} brings its own sound engineer.` : `${b.name} does not provide its own sound engineer. Therefore a sound engineer has to be provided by the venue. If this is not possible, please let ${b.name} know in time.`}`
      : `PA und Bühnenlicht stellt ${r.ownLight ? 'teilweise' : 'nicht'} ${b.name}, sondern der Veranstalter – passend zur Location.\n${r.ownFoh ? `${b.name} bringt eine eigene Tontechnik mit.` : `${b.name} bringt keine eigene Tontechnik mit. Bitte eine:n Tontechniker:in stellen; falls das nicht geht, rechtzeitig Bescheid geben.`}`);
    h += sec('foh', 'foh') + paras(fill(b, tx, g));
  }
  if (on('check')) {
    const add = r.tracks ? (lg === 'en' ? `Note: ${b.name} uses click track / backing tracks, which have to be checked before the show.` : `Hinweis: ${b.name} spielt mit Click/Backing-Tracks – diese müssen vor der Show geprüft werden.`) : (lg === 'en' ? `Note: ${b.name} does not use any click track, backing track or playback.` : `Hinweis: ${b.name} verwendet keinen Click, keine Backing-Tracks und keine Playbacks.`);
    h += sec('check', 'check') + paras(text(b, 'check', g)) + `<p class="note">${esc(add)}</p>`;
  }
  const extras = ['backstage', 'catering', 'drinks', 'times', 'merch', 'photo'].filter(on);
  if (extras.length) h += `<h2 class="big">${esc(L(lg, 'extras'))}</h2>`;
  if (on('backstage')) h += `<h3>${esc(L(lg, 'backstage'))}</h3>` + paras(text(b, 'backstage', g)) + `<ul>${BACKSTAGE.filter(([k]) => r.backstage.includes(k)).map(([, de, en]) => `<li>${esc(lg === 'en' ? en : de)}</li>`).join('')}</ul>`;
  if (on('catering')) {
    const n = people(b, g);
    const diet = DIETS.filter(([k]) => r.diet.includes(k)).map(([, de, en]) => (lg === 'en' ? en : de));
    const tx = r.texts.catering ?? (lg === 'en'
      ? (r.catering === 'none' ? `It is not necessary to provide ${b.name} any catering.` : r.catering === 'welcome' ? `Generally it is not necessary to provide ${b.name} any catering. However, if the event takes a longer period of time, or catering is available anyway, ${b.name} gladly takes advantage of it.` : `Please provide a warm meal for ${b.name}.`) + ` ${b.name} brings a total of about ${n} people.` + (diet.length ? ` Dietary needs: ${diet.join(', ')}.` : ' There are no known allergies.')
      : (r.catering === 'none' ? `Catering ist für ${b.name} nicht nötig.` : r.catering === 'welcome' ? `Catering ist grundsätzlich nicht nötig. Dauert die Veranstaltung länger oder gibt es ohnehin Catering, nimmt ${b.name} es gerne an.` : `Bitte eine warme Mahlzeit für ${b.name} einplanen.`) + ` ${b.name} kommt mit etwa ${n} Personen.` + (diet.length ? ` Ernährung: ${diet.join(', ')}.` : ' Keine bekannten Allergien.'));
    h += `<h3>${esc(L(lg, 'catering'))}</h3>` + paras(fill(b, tx, g));
  }
  if (on('drinks')) h += `<h3>${esc(L(lg, 'drinks'))}</h3>` + paras(text(b, 'drinks', g)) + `<ul>${DRINKS.filter(([k]) => r.drinks.includes(k)).map(([, de, en]) => `<li>${esc(lg === 'en' ? en : de)}</li>`).join('')}</ul>`;
  if (on('times')) {
    h += `<h3>${esc(L(lg, 'times'))}</h3>` + paras(text(b, 'times', g));
    const sch = g?.schedule.filter((s) => s.time) ?? [];
    if (sch.length) h += `<table class="grid"><tr><th colspan="2">${esc(L(lg, 'schedule'))}</th></tr>${sch.map((s) => `<tr><td>${esc(s.time)}</td><td>${esc(s.label)}</td></tr>`).join('')}</table>`;
  }
  if (on('merch')) h += `<h3>${esc(L(lg, 'merch'))}</h3>` + paras(fill(b, r.texts.merch ?? (r.merch ? (lg === 'en' ? `${b.name} brings merchandise. Please provide a suitable place (table, light, power).` : `${b.name} bringt Merch mit. Bitte einen passenden Platz (Tisch, Licht, Strom) vorsehen.`) : (lg === 'en' ? `${b.name} brings no merchandise, so no place is needed.` : `${b.name} bringt kein Merch mit – es ist kein Platz nötig.`)), g));
  if (on('photo')) {
    const ph = crewOf(b, g).filter((c) => /foto|photo|video/i.test(c.role));
    const tx = r.texts.photo ?? (ph.length
      ? (lg === 'en' ? `${b.name} brings its own photographer (${ph.map((p) => p.name).join(', ')}). The rights of recorded videos and photos taken by ${b.name} are owned by ${b.name} (photographer).\nFor the entire crew the same backstage and catering arrangements apply as for the band itself.` : `${b.name} bringt eigene Fotograf:innen mit (${ph.map((p) => p.name).join(', ')}). Die Rechte an Fotos und Videos von ${b.name} liegen bei ${b.name} bzw. den Fotograf:innen.\nFür die gesamte Crew gelten dieselben Backstage- und Catering-Regeln wie für die Band.`)
      : (lg === 'en' ? `For the entire crew of ${b.name} the same backstage and catering arrangements apply as for the band itself.` : `Für die gesamte Crew gelten dieselben Backstage- und Catering-Regeln wie für die Band.`));
    h += `<h3>${esc(L(lg, 'photo'))}</h3>` + paras(fill(b, tx, g));
  }
  for (const cs of r.custom ?? []) if (on(cs.id) && (cs.title || cs.text)) h += `<h2>${esc(cs.title)}</h2>` + md(fill(b, cs.text, g));
  if (on('thanks')) h += sec('thanks', 'thanks') + paras(text(b, 'thanks', g));
  if (on('plot')) h += `<div class="plotPage">${plotSvg(b, g, lg)}</div>`;
  return h;
}

function personName(b: Band, id: string) {
  return b.members.find((m) => m.id === id)?.name ?? b.crew.find((c) => c.id === id)?.name ?? id;
}

// ---------------- stage plot ----------------

/** printable stage plot in the style of a classic band stage plot (landscape) */
export function plotSvg(b: Band, g: Gig | null, lg: Lang = lang(b.rider)): string {
  const s = b.gear.stage;
  const W = 1000;
  const H = 680;
  const pad = 20;
  const sx = (W - pad * 2) / s.width;
  const sy = (H - pad * 2 - 40) / s.depth;
  const X = (m: number) => pad + m * sx;
  const Y = (m: number) => pad + (s.depth - m) * sy; // front edge at the bottom
  const ms = members(b, g);
  let o = `<svg class="plot" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">`;
  o += `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="#fff" stroke="#000" stroke-width="2"/>`;
  // title block
  const tb = { x: W - 330, y: 1, w: 329, h: 140 };
  o += `<g><rect x="${tb.x}" y="${tb.y}" width="${tb.w}" height="${tb.h}" fill="#fff" stroke="#000" stroke-width="2"/><line x1="${tb.x}" y1="${tb.y + 66}" x2="${tb.x + tb.w}" y2="${tb.y + 66}" stroke="#000" stroke-width="2"/>`;
  o += `<text x="${tb.x + (b.logo ? 100 : tb.w / 2)}" y="${tb.y + 28}" text-anchor="middle" font-size="16">(c) ${esc(b.name)}</text><text x="${tb.x + (b.logo ? 100 : tb.w / 2)}" y="${tb.y + 52}" text-anchor="middle" font-size="15">${esc(g?.date ? g.date.slice(5, 7) + '/' + g.date.slice(0, 4) : new Date().toISOString().slice(5, 7) + '/' + new Date().getFullYear())}</text>`;
  if (b.logo) o += `<line x1="${tb.x + 200}" y1="${tb.y}" x2="${tb.x + 200}" y2="${tb.y + 66}" stroke="#000" stroke-width="2"/><image href="${b.logo}" x="${tb.x + 206}" y="${tb.y + 4}" width="118" height="58" preserveAspectRatio="xMidYMid meet"/>`;
  o += `<text x="${tb.x + 14}" y="${tb.y + 112}" font-size="22">${esc(L(lg, 'plotTitle', { v: b.rider.plotVersion }))}</text><line x1="${tb.x + 262}" y1="${tb.y + 66}" x2="${tb.x + 262}" y2="${tb.y + tb.h}" stroke="#000" stroke-width="2"/><text x="${tb.x + 296}" y="${tb.y + 112}" text-anchor="middle" font-size="20">1/1</text>`;
  if (g) o += `<text x="${pad + 4}" y="${pad + 14}" font-size="13" fill="#444">${esc([g.title, g.venue].filter(Boolean).join(' – '))}</text>`;
  o += '</g>';
  const socket = (x: number, y: number) => `<g><rect x="${x - 9}" y="${y - 9}" width="18" height="18" rx="3" fill="#fff" stroke="#000" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#000" stroke-width="1.4"/><circle cx="${x - 2}" cy="${y}" r=".9"/><circle cx="${x + 2}" cy="${y}" r=".9"/></g>`;
  // gear on the plan
  const onStage = b.gear.items.filter((x) => x.onStage && (!x.member || ms.some((m) => m.id === x.member)));
  for (const it of onStage) {
    const cx = X(it.x);
    const cy = Y(it.y);
    const prev = o;
    o = '';
    do {
    if (it.kind === 'drums') {
      const w = 2.2 * sx;
      const h = 2 * sy;
      o += `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="1.4"/>`;
      const kit: [number, number, number, string][] = [[-0.62, -0.1, 0.36, '#ddd'], [-0.3, -0.38, 0.22, '#ddd'], [0, 0.1, 0.42, '#fff'], [0.42, -0.24, 0.28, '#fff'], [0.66, -0.4, 0.22, '#ddd'], [0.6, 0.12, 0.32, '#ddd'], [-0.28, 0.14, 0.3, '#fff']];
      for (const [dx, dy, r, f] of kit) o += `<circle cx="${cx + dx * w * 0.5}" cy="${cy + dy * h * 0.6}" r="${r * Math.min(w, h) * 0.5}" fill="${f}" stroke="#000" stroke-width="1.2"/><circle cx="${cx + dx * w * 0.5}" cy="${cy + dy * h * 0.6}" r="2.5" fill="none" stroke="#000"/>`;
      o += `<rect x="${cx - w * 0.22}" y="${cy + h * 0.38}" width="${w * 0.44}" height="8" fill="#fff" stroke="#000"/>`;
      break;
    }
    if (it.kind === 'monitor') {
      const w = 0.85 * sx;
      const h = 0.45 * sy;
      o += `<path d="M${cx - w / 2} ${cy - h / 2} L${cx + w / 2} ${cy - h / 2} L${cx + w * 0.42} ${cy + h / 2} L${cx - w * 0.42} ${cy + h / 2} Z" fill="#bbb" stroke="#000" stroke-width="1.4"/><text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="14">${esc(it.name || 'Monitor')}</text>`;
      break;
    }
    if (it.kind === 'mic' || it.kind === 'vocals') {
      o += `<circle cx="${cx}" cy="${cy}" r="22" fill="#fff" stroke="#000" stroke-width="1.4"/><rect x="${cx - 4}" y="${cy - 14}" width="8" height="22" rx="4" fill="#000"/><text x="${cx}" y="${cy - 30}" text-anchor="middle" font-size="12">${esc(it.name || kindName(it.kind))}</text>`;
      break;
    }
    if (it.kind === 'power') {
      o += socket(cx, cy);
      break;
    }
    const w = Math.max(1.3, (KIND_W[it.kind] ?? 0.9)) * sx;
    const h = 0.5 * sy;
    const cap = it.kind === 'amp' ? `${L(lg, 'amp')}:` : (lg === 'en' ? (EN_KIND[it.kind] ?? it.kind) : kindName(it.kind)).toUpperCase() + ':';
    o += `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="4" fill="#fff" stroke="#000" stroke-width="1.2"/>`;
    o += `<text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="13">${esc(cap)}</text><text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="13" font-weight="bold">${esc(it.name || gearLabel(it))}</text>`;
    if (it.note) o += `<text x="${cx}" y="${cy + h / 2 + 12}" text-anchor="middle" font-size="9">${esc(it.note)}</text>`;
    if (POWERED.includes(it.kind)) o += socket(cx - w / 2 + 14, cy - h / 2 - 16);
      } while (false);
    o = prev + (it.rot ? `<g transform="rotate(${it.rot} ${cx} ${cy})">${o}</g>` : o);
  }
  // people (a drummer sits on top of the kit)
  for (const m of ms) {
    const p = s.members[m.id];
    if (!p) continue;
    const kit = onStage.find((x) => x.kind === 'drums' && x.member === m.id);
    const cx = kit ? X(kit.x) : X(p.x);
    const cy = kit ? Y(kit.y) - sy + 26 : Y(p.y);
    const nm = m.name || '?';
    const w = Math.max(70, nm.length * 9 + 34);
    if (!kit) o += `<text x="${cx}" y="${cy - 34}" text-anchor="middle" font-size="15" font-style="italic">${esc(roleOf(b, m.id, lg).toUpperCase())}</text>`;
    o += `<path d="M${cx - w / 2} ${cy} L${cx - w / 2 + 14} ${cy - 17} L${cx + w / 2 - 14} ${cy - 17} L${cx + w / 2} ${cy} L${cx + w / 2 - 14} ${cy + 17} L${cx - w / 2 + 14} ${cy + 17} Z" fill="#fff" stroke="#000" stroke-width="1.4"/><text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="17">${esc(nm)}</text>`;
  }
  o += `<text x="${W / 2}" y="${H - 10}" text-anchor="middle" font-size="12" fill="#555">${esc(L(lg, 'audience'))} · ${s.width} × ${s.depth} m</text>`;
  o += '</svg>';
  return o;
}
const KIND_W: Partial<Record<GearKind, number>> = { amp: 1.4, keys: 1.6, effect: 1.1, mixer: 1.2, pa: 1, di: 0.7, wireless: 1.3, iem: 1 };

const PRINT_CSS = `<style>
#printArea.rider{font:12.5px -apple-system,Helvetica,Arial,sans-serif;color:#111;padding:4px;line-height:1.45}
.rider .cover{margin-bottom:22px}.rider .head{display:flex;align-items:center;gap:18px;margin-bottom:22px}.rider .head img{height:70px}
.rider h1{font-size:26px;margin:0}.rider .sub{color:#555;margin-top:2px}
.rider h2{font-size:16px;margin:22px 0 8px;padding-bottom:3px;border-bottom:1px solid #999;break-after:avoid}
.rider h2.big{font-size:18px}.rider h3{font-size:14px;margin:14px 0 4px;break-after:avoid}
.rider p{margin:0 0 6px}.rider h4{font-size:13px;margin:10px 0 4px}.rider h5{font-size:12.5px;margin:8px 0 3px}.rider blockquote{margin:4px 0 8px;padding-left:10px;border-left:3px solid #bbb;color:#444}.rider code{font-family:Menlo,monospace;font-size:11.5px;background:#f2f2f2;padding:0 3px;border-radius:3px}.rider a{color:#0645ad}.rider ol{margin:2px 0 8px;padding-left:22px}.rider .note{font-style:italic;color:#333}.rider ul{margin:2px 0 8px;padding-left:20px}
.rider table{border-collapse:collapse;width:100%;margin:4px 0 8px}.rider td,.rider th{padding:4px 7px;text-align:left;vertical-align:top}
.rider table.grid td,.rider table.grid th{border:0.5px solid #999}.rider th{background:#eee;font-weight:600}
.rider table.event td:first-child{width:220px;font-weight:600}.rider table.event td:last-child{width:70%}.rider td.sig{border-bottom:1px solid #000;height:26px}
.rider tr{break-inside:avoid}.rider .plotPage{break-before:page;padding-top:4px}.rider .plot{width:100%;height:auto}
@media print{@page{margin:14mm}}
</style>`;

function printDoc(body: string) {
  document.getElementById('printArea')?.remove();
  const area = el('div', 'rider', PRINT_CSS + body);
  area.id = 'printArea';
  document.body.appendChild(area);
  window.addEventListener('afterprint', () => setTimeout(() => area.remove(), 500), { once: true });
  void openPrintDialog();
}

export function printRider(b: Band, g: Gig | null) {
  printDoc(riderHtml(b, g));
}

export function printStagePlot(b: Band, g: Gig | null) {
  printDoc(`<style>@media print{@page{size:landscape;margin:10mm}}</style><div class="plotOnly">${plotSvg(b, g)}</div>`);
}

// ---------------- settings page (Bühne & Technik → Rider) ----------------

function chips(parent: HTMLElement, items: [string, string, string][], sel: string[], lg: Lang, done: () => void) {
  const box = el('div', 'lineup');
  for (const [k, de, en] of items) {
    const on = sel.includes(k);
    const c = el('button', 'chipBtn' + (on ? ' on' : ''), esc(lg === 'en' ? en : de));
    c.onclick = () => {
      const i = sel.indexOf(k);
      if (i >= 0) sel.splice(i, 1);
      else sel.push(k);
      save();
      done();
    };
    box.appendChild(c);
  }
  parent.appendChild(box);
}

export function renderRiderSettings(main: HTMLElement, b: Band, rerender: () => void) {
  const r = b.rider as Rider & { lang?: Lang };
  const lg = lang(r);
  const [left, right] = columns(main);
  const people = [...b.members.map((m) => [m.id, m.name || '?'] as [string, string]), ...b.crew.map((c) => [c.id, `${c.name} (${c.role || t('Crew')})`] as [string, string])];

  const c0 = card(left, t('Dokument'));
  row(c0, t('Sprache'), select([['en', 'English'], ['de', 'Deutsch']], lg, (v) => { r.lang = v as Lang; save(); rerender(); }));
  row(c0, t('Rider-Version'), input(r, 'version', 'V1.0'));
  row(c0, t('Stage-Plot-Version'), input(r, 'plotVersion', 'V1.0'));

  const c1 = card(left, t('Änderungen'), { addTip: t('Version hinzufügen'), add: () => {
    const next = (() => { const m = r.version.match(/(\d+)\.(\d+)/); return m ? `V${m[1]}.${Number(m[2]) + 1}` : 'V1.0'; })();
    r.history.push({ id: uid('v'), version: r.history.length ? next : r.version, date: new Date().toISOString().slice(0, 10), changes: '', by: b.members[0]?.id ?? '' });
    if (r.history.length > 1) r.version = next;
    save();
    rerender();
  } });
  if (!r.history.length) hint(c1, t('Änderungsverlauf des Riders, z.B. „Neues Logo, Stage Plot aktualisiert“.'));
  for (const v of r.history) {
    const rw = el('div', 'histRow');
    rw.append(input(v, 'version', 'V1.0', undefined, 'pInput ver'), input(v, 'date', '', undefined, 'pInput', 'date'), input(v, 'changes', t('Was hat sich geändert?')), select([['', '–'], ...people], v.by, (x) => { v.by = x; save(); }));
    rw.appendChild(iconBtn('xmark', t('Entfernen'), () => { r.history = r.history.filter((x) => x !== v); save(); rerender(); }, 'tb'));
    c1.appendChild(rw);
  }

  const c2 = card(left, t('Kontakte im Rider'), { addTip: t('Kontakt hinzufügen'), add: () => {
    r.contacts.push({ id: uid('c'), topic: r.contacts.length ? t('Technik') : t('Booking & Organisation'), person: b.members[0]?.id ?? '', phone: b.contact.phone, email: b.contact.email });
    save();
    rerender();
  } });
  if (!r.contacts.length) hint(c2, t('Ohne Einträge steht der Band-Kontakt im Rider.'));
  for (const c of r.contacts) {
    const rw = el('div', 'rcRow');
    const tp = input(c, 'topic', t('Thema'));
    tp.setAttribute('list', 'riderTopics');
    rw.append(tp, select([['', '–'], ...people], c.person, (x) => {
      c.person = x;
      const cr = b.crew.find((p) => p.id === x);
      if (cr) {
        c.phone = cr.phone || c.phone;
        c.email = cr.email || c.email;
      }
      save();
      rerender();
    }), input(c, 'phone', t('Telefon')), input(c, 'email', t('E-Mail')));
    rw.appendChild(iconBtn('xmark', t('Entfernen'), () => { r.contacts = r.contacts.filter((x) => x !== c); save(); rerender(); }, 'tb'));
    c2.appendChild(rw);
  }
  const dl = el('datalist');
  dl.id = 'riderTopics';
  for (const x of [t('Booking & Organisation'), t('Technik'), t('Presse & Fotos'), t('Management'), 'Booking/Organisation/P&R', 'Technical/Photos']) dl.appendChild(Object.assign(el('option'), { value: x }));
  c2.appendChild(dl);

  const c3 = card(left, t('Abschnitte'));
  hint(c3, t('Was im Rider steht. Inhalte kommen aus Band, Equipment, Kanälen, Monitoren, Bühnenplan und Crew.'));
  for (const [id, label] of SECTIONS) {
    const on = !r.off.includes(id);
    const rw = el('div', 'secRow' + (on ? '' : ' off'));
    rw.appendChild(toggle(on, (v) => { r.off = v ? r.off.filter((x) => x !== id) : [...r.off, id]; save(); rerender(); }));
    rw.appendChild(el('span', 'nm', esc(t(label))));
    if (EDITABLE.has(id) || ['foh', 'catering', 'merch', 'photo'].includes(id)) {
      const ed = iconBtn('pencil', r.texts[id] !== undefined ? t('Eigener Text (bearbeiten)') : t('Text anpassen'), () => {
        if (r.texts[id] === undefined) r.texts[id] = DEFAULTS[id]?.[lg === 'en' ? 1 : 0] ?? riderPlain(b, id);
        openText = openText === id ? '' : id;
        save();
        rerender();
      }, 'tb' + (r.texts[id] !== undefined ? ' on' : ''));
      rw.appendChild(ed);
    }
    c3.appendChild(rw);
    if (openText === id && r.texts[id] !== undefined) {
      const ta = el('textarea', 'pInput notes');
      ta.value = r.texts[id];
      ta.oninput = () => {
        r.texts[id] = ta.value;
        save();
      };
      const reset = el('button', 'btn small', esc(t('Standardtext')));
      reset.onclick = () => {
        delete r.texts[id];
        openText = '';
        save();
        rerender();
      };
      const box = el('div', 'secText');
      box.append(ta, el('div', 'hint', esc(t('Markdown: **fett**, *kursiv*, - Liste, ## Überschrift, [Link](https://…) · {b} = Bandname, {n} = Personen, {v} = Fahrzeuge'))), reset);
      c3.appendChild(box);
    }
  }
  for (const cs of r.custom ?? []) {
    const on = !r.off.includes(cs.id);
    const rw = el('div', 'secRow custom' + (on ? '' : ' off'));
    rw.appendChild(toggle(on, (v) => { r.off = v ? r.off.filter((x) => x !== cs.id) : [...r.off, cs.id]; save(); rerender(); }));
    rw.appendChild(input(cs, 'title', t('Überschrift'), undefined, 'pInput nm'));
    rw.appendChild(iconBtn('xmark', t('Abschnitt entfernen'), () => { r.custom = (r.custom ?? []).filter((x) => x !== cs); save(); rerender(); }, 'tb'));
    c3.appendChild(rw);
    const box = el('div', 'secText');
    const ta = el('textarea', 'pInput notes');
    ta.placeholder = t('Text in Markdown, z.B.\n- Bühne mindestens 6 × 4 m\n- **Strom** auf beiden Seiten');
    ta.value = cs.text;
    ta.oninput = () => {
      cs.text = ta.value;
      save();
    };
    box.append(ta, el('div', 'hint', esc(t('Markdown: **fett**, *kursiv*, - Liste, ## Überschrift, [Link](https://…)'))));
    c3.appendChild(box);
  }
  const addSec = el('button', 'btn plain', `${icon('plus', 12)}<span>${esc(t('Eigener Abschnitt'))}</span>`);
  addSec.onclick = () => {
    r.custom = [...(r.custom ?? []), { id: uid('s'), title: '', text: '' }];
    save();
    rerender();
    const all = document.querySelectorAll<HTMLInputElement>('#band .secRow.custom .pInput.nm');
    all[all.length - 1]?.focus();
  };
  c3.appendChild(addSec);

  // options
  const o1 = card(right, t('Technik'));
  row(o1, t('Eigene Tontechnik'), toggle(r.ownFoh, (v) => { r.ownFoh = v; save(); }));
  row(o1, t('Eigenes Licht'), toggle(r.ownLight, (v) => { r.ownLight = v; save(); }));
  row(o1, t('Click / Backing-Tracks'), toggle(r.tracks, (v) => { r.tracks = v; save(); }));
  const mm = input(r, 'monitorsMin', '0', undefined, 'pInput num', 'number');
  row(o1, t('Monitore mindestens'), mm, el('span', 'unit', String(b.gear.monitors.length ? t('{n} angelegt', { n: b.gear.monitors.length }) : '')));
  const o2 = card(right, t('Backstage'));
  chips(o2, BACKSTAGE, r.backstage, lg, rerender);
  const o3 = card(right, t('Catering & Getränke'));
  row(o3, t('Catering'), select([['none', t('nicht nötig')], ['welcome', t('gerne, wenn vorhanden')], ['required', t('erforderlich')]], r.catering, (v) => { r.catering = v as Rider['catering']; save(); }));
  row(o3, t('Personen'), el('span', 'val', t('{n} (Band + Crew)', { n: b.members.length + b.crew.length })));
  chips(o3, DIETS, r.diet, lg, rerender);
  o3.appendChild(el('div', 'subHead', esc(t('Getränke'))));
  chips(o3, DRINKS, r.drinks, lg, rerender);
  const o4 = card(right, t('Anreise & Merch'));
  row(o4, t('Fahrzeuge'), input(r, 'vehicles', '1', undefined, 'pInput num', 'number'));
  row(o4, t('Merch-Stand'), toggle(r.merch, (v) => { r.merch = v; save(); }));

  // preview
  const pv = card(main, t('Vorschau'), { cls: 'riderPreview', extra: [
    (() => { const b1 = el('button', 'btn small', `${icon('printer', 12)}<span>${esc(t('Rider drucken / PDF'))}</span>`); b1.onclick = () => printRider(b, null); return b1; })(),
    (() => { const b2 = el('button', 'btn small', `${icon('stagePlan', 12)}<span>${esc(t('Stage Plot drucken'))}</span>`); b2.onclick = () => printStagePlot(b, null); return b2; })(),
  ] });
  const paper = el('div', 'paper rider', riderHtml(b, null));
  pv.appendChild(paper);
}

let openText = '';

function riderPlain(b: Band, id: string): string {
  const tmp = el('div', '', riderHtml({ ...b, rider: { ...b.rider, off: SECTIONS.map(([k]) => k).filter((k) => k !== id) } } as Band, null));
  return Array.from(tmp.querySelectorAll('p')).map((p) => p.textContent).join('\n');
}

/** menu items for printing (stage page and gig) */
export function riderPrintItems(b: Band, g: Gig | null): MenuItem[] {
  return [
    { icon: 'doc', label: t('Rider drucken / PDF'), fn: () => printRider(b, g) },
    { icon: 'stagePlan', label: t('Stage Plot drucken / PDF'), fn: () => printStagePlot(b, g) },
  ];
}
