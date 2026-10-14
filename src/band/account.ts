// Account UI: sign in with an e-mail code, account menu, the band's access card (roles, invites), accepting invites.
import { t } from '../i18n';
import { icon } from '../icons';
import { el, esc, iconBtn, select, save } from './dom';
import { card, hint, popMenu, wizard, wizField, wizInput, choices, type MenuItem } from './kit';
import { type Band } from './model';
import * as C from '../cloud/cloud';
import { saveFile } from '../io';

export interface AccountCtx {
  band(): Band;
  replaceBand(b: Band): void;
  rerender(): void;
  confirm(m: string): Promise<boolean>;
  flash(m: string): void;
  /** open a cloud band on this device (data comes from the cloud) */
  switchTo(b: C.CloudBand): Promise<void>;
  /** band.cloud changed: start/stop the sync */
  cloudChanged(): void;
  syncNow(): Promise<void>;
  syncLabel(): string;
}

export const ROLES: [C.Role, string, string][] = [
  ['admin', 'Admin', 'alles, auch Einladungen und Rollen'],
  ['member', 'Mitglied', 'Songs, Setlists, Gigs, Proben, Bühne bearbeiten'],
  ['guest', 'Gast', 'nur ansehen, z.B. Technik oder Fotograf:in'],
];
const roleName = (r: C.Role) => t(ROLES.find(([k]) => k === r)?.[1] ?? r);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const PENDING = 'stagecraft.invite';
const pending = {
  get: () => { try { return sessionStorage.getItem(PENDING) ?? ''; } catch { return ''; } },
  set: (v: string) => { try { if (v) sessionStorage.setItem(PENDING, v); else sessionStorage.removeItem(PENDING); } catch {} },
};

// ---------------- sign in ----------------

export async function signIn(c: AccountCtx, why = ''): Promise<boolean> {
  const a = await wizard<{ email: string }>({
    title: t('Anmelden'),
    state: { email: '' },
    finish: t('Code schicken'),
    steps: [{
      title: t('Mit deiner E-Mail anmelden'),
      text: why || t('Du bekommst einen 6-stelligen Code per Mail. Ohne Passwort. Beim ersten Mal wird dein Account automatisch angelegt.'),
      ok: (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email.trim()),
      body: (box, s, redraw) => wizField(box, t('E-Mail'), wizInput(s.email, 'name@beispiel.at', (v) => { s.email = v; redraw(); }, 'email')),
    }],
  });
  if (!a) return false;
  try {
    await C.sendCode(a.email);
  } catch (e) {
    c.flash(t('Code konnte nicht geschickt werden: {x}', { x: errText(e) }));
    return false;
  }
  for (let tries = 0; tries < 3; tries++) {
    const b = await wizard<{ code: string }>({
      title: t('Anmelden'),
      state: { code: '' },
      finish: t('Anmelden'),
      steps: [{
        title: t('Code eingeben'),
        text: tries ? t('Der Code hat nicht gepasst. Bitte nochmal.') : t('Wir haben einen Code an {x} geschickt. Schau auch im Spam-Ordner.', { x: a.email.trim() }),
        ok: (s) => /^\d{6,8}$/.test(s.code.replace(/\s/g, '')),
        body: (box, s, redraw) => {
          const i = wizInput(s.code, '123456', (v) => { s.code = v; redraw(); });
          i.inputMode = 'numeric';
          i.autocomplete = 'one-time-code';
          i.classList.add('codeInput');
          wizField(box, t('Code'), i);
        },
      }],
    });
    if (!b) return false;
    try {
      await C.verifyCode(a.email, b.code);
      c.flash(t('Angemeldet als {x}', { x: a.email.trim() }));
      return true;
    } catch {
      /* try again */
    }
  }
  return false;
}

// ---------------- sidebar button + menu ----------------

export function acctSub(c: AccountCtx): string {
  const a = C.currentAccount();
  const b = c.band();
  return !a ? t('Anmelden') : b.cloud ? `${roleName(b.cloud.role)} · ${c.syncLabel() || t('in der Cloud')}` : t('Band nur auf diesem Gerät');
}

export function accountButton(c: AccountCtx): HTMLElement {
  const a = C.currentAccount();
  const sub = acctSub(c);
  const btn = el('button', 'acct' + (a ? ' on' : ''), `<span class="av">${a ? esc(initialsOf(a.name || a.email)) : icon('people', 14)}</span><span><b>${esc(a ? a.name || a.email : t('Lokal'))}</b><small>${esc(sub)}</small></span>`);
  btn.dataset.tip = a ? a.email : t('Anmelden, um die Band zu teilen');
  btn.onclick = () => (a ? accountMenu(btn, c) : void signIn(c).then((ok) => ok && c.rerender()));
  return btn;
}

const initialsOf = (s: string) => s.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('') || '?';

function accountMenu(anchor: HTMLElement, c: AccountCtx) {
  const b = c.band();
  const items: MenuItem[] = [
    { icon: 'pencil', label: t('Name ändern …'), fn: () => void editName(c) },
    'sep',
  ];
  if (!b.cloud && b.setup) items.push({ icon: 'upload', label: t('Band in die Cloud übernehmen …'), fn: () => void toCloud(c) });
  items.push({ icon: 'people', label: t('Einladung annehmen …'), fn: () => void pasteInvite(c) });
  items.push({ icon: 'list', label: t('Meine Bands …'), fn: () => void showBands(c) });
  items.push({ icon: 'gear', label: t('Account & Daten …'), fn: () => void accountData(c) });
  items.push('sep', { icon: 'xmark', label: t('Abmelden'), fn: async () => { await C.signOut(); c.flash(t('Abgemeldet. Deine Daten bleiben auf diesem Gerät.')); c.rerender(); } });
  popMenu(anchor, items);
}

async function editName(c: AccountCtx) {
  const a = C.currentAccount();
  if (!a) return;
  const r = await wizard<{ name: string }>({
    title: t('Account'),
    state: { name: a.name },
    finish: t('Speichern'),
    steps: [{
      title: t('Wie sollen dich die anderen sehen?'),
      ok: (s) => !!s.name.trim(),
      body: (box, s, redraw) => wizField(box, t('Name'), wizInput(s.name, t('z.B. Benni'), (v) => { s.name = v; redraw(); })),
    }],
  });
  if (!r) return;
  try {
    await C.setName(r.name);
    c.rerender();
  } catch (e) {
    c.flash(errText(e));
  }
}

async function showBands(c: AccountCtx) {
  let list: C.CloudBand[] = [];
  try {
    list = await C.myBands();
  } catch (e) {
    return c.flash(errText(e));
  }
  await wizard<object>({
    title: t('Meine Bands'),
    state: {},
    finish: t('Fertig'),
    steps: [{
      title: list.length ? t('Bands in deinem Account') : t('Noch keine Band in deinem Account'),
      text: list.length > 1 ? t('Auf diesem Gerät ist immer eine Band offen. Tippe eine andere an, um zu ihr zu wechseln – ihre Daten kommen aus der Cloud.') : undefined,
      body: (box) => {
        for (const x of list) {
          const here = x.id === c.band().cloud?.id;
          const r = el('button', 'acctBand' + (here ? ' on' : ''), `<b>${esc(x.name)}</b><span>${esc(roleName(x.role))}${here ? ' · ' + esc(t('geöffnet')) : ' · ' + esc(t('öffnen'))}</span>`);
          r.type = 'button';
          r.disabled = here;
          r.onclick = () => {
            (document.querySelector('.wizOverlay .wizFoot .btn.primary') as HTMLButtonElement | null)?.click();
            void c.switchTo(x);
          };
          box.appendChild(r);
        }
      },
    }],
  });
}

/** the local band becomes a cloud band; I am its admin */
export async function toCloud(c: AccountCtx) {
  const b = c.band();
  if (!C.currentAccount() && !(await signIn(c, t('Melde dich an, damit die Band in deinem Account liegt.')))) return;
  if (b.cloud) return;
  const r = await wizard<{ me: string }>({
    title: t('Band in die Cloud'),
    state: { me: '' },
    finish: t('Übernehmen'),
    steps: [{
      title: t('„{x}“ in deinen Account übernehmen?', { x: b.name || t('Band') }),
      text: t('Du wirst Admin und kannst Mitglieder einladen. Die Daten bleiben weiter auch auf diesem Gerät.'),
      body: (box, s) => {
        if (!b.members.length) return;
        wizField(box, t('Wer bist du in der Band?'), select([['', t('Niemand davon')], ...b.members.map((m) => [m.id, m.name || '?'] as [string, string])], s.me, (v) => (s.me = v)));
      },
    }],
  });
  if (!r) return;
  try {
    const id = await C.createCloudBand(b.name, r.me || null);
    b.cloud = { id, role: 'admin' };
    save();
    c.cloudChanged();
    c.flash(t('„{x}“ ist jetzt in deinem Account.', { x: b.name }));
    c.rerender();
  } catch (e) {
    c.flash(errText(e));
  }
}

// ---------------- band page: access card ----------------

export function accessCard(parent: HTMLElement, c: AccountCtx) {
  const b = c.band();
  const a = C.currentAccount();
  const isAdmin = b.cloud?.role === 'admin';
  const box = card(parent, t('Zugang'), {
    addTip: t('Einladen'),
    add: b.cloud && isAdmin ? () => void inviteWizard(c) : undefined,
  });
  box.classList.add('accessCard');
  if (!b.cloud) {
    hint(box, a ? t('Die Band liegt nur auf diesem Gerät. Übernimm sie in deinen Account, dann kannst du Mitglieder und Gäste einladen.') : t('Melde dich an, um die Band mit Mitgliedern und Gästen zu teilen.'));
    const go = el('button', 'btn small', esc(a ? t('Band in die Cloud übernehmen …') : t('Anmelden …')));
    go.onclick = () => void (a ? toCloud(c) : signIn(c).then((ok) => ok && c.rerender()));
    box.appendChild(go);
    return;
  }
  if (!a) {
    hint(box, t('Melde dich an, um Mitglieder und Einladungen zu sehen.'));
    const go = el('button', 'btn small', esc(t('Anmelden …')));
    go.onclick = () => void signIn(c).then((ok) => ok && c.rerender());
    box.appendChild(go);
    return;
  }
  const list = el('div', 'accessList', `<div class="hint pad">${esc(t('Lade …'))}</div>`);
  box.appendChild(list);
  void fillAccess(list, c);
}

async function fillAccess(list: HTMLElement, c: AccountCtx) {
  const b = c.band();
  const id = b.cloud!.id;
  const isAdmin = b.cloud!.role === 'admin';
  let rows: C.CloudMember[] = [];
  let invites: Awaited<ReturnType<typeof C.openInvites>> = [];
  try {
    rows = await C.members(id);
    if (isAdmin) invites = await C.openInvites(id);
  } catch (e) {
    list.innerHTML = `<div class="hint pad">${esc(t('Nicht erreichbar: {x}', { x: errText(e) }))}</div>`;
    return;
  }
  list.innerHTML = '';
  const people: [string, string][] = [['', t('– nicht verknüpft –')], ...b.members.map((m) => [m.id, m.name || '?'] as [string, string]), ...b.crew.map((x) => [x.id, `${x.name || '?'} (${x.role || t('Crew')})`] as [string, string])];
  for (const m of rows) {
    const r = el('div', 'accessRow');
    r.appendChild(el('span', 'av', esc(initialsOf(m.name))));
    r.appendChild(el('span', 'nm', `<b>${esc(m.name)}${m.me ? ` <small>(${esc(t('du'))})</small>` : ''}</b>`));
    if (isAdmin) {
      const link = select(people, m.member_ref ?? '', (v) => void C.setMemberRef(id, m.user_id, v || null).catch((e) => c.flash(errText(e))));
      link.dataset.tip = t('Mit welchem Eintrag in der Band ist der Account verknüpft?');
      r.appendChild(link);
      r.appendChild(select(ROLES.map(([k, l]) => [k, t(l)] as [string, string]), m.role, async (v) => {
        try {
          await C.setRole(id, m.user_id, v as C.Role);
          if (m.me) { b.cloud!.role = v as C.Role; save(); }
          c.rerender();
        } catch (e) {
          c.flash(errText(e));
          c.rerender();
        }
      }));
      r.appendChild(iconBtn('xmark', m.me ? t('Band verlassen') : t('Entfernen'), async () => {
        if (!(await c.confirm(m.me ? t('Band in der Cloud verlassen? Die Daten bleiben auf diesem Gerät.') : t('{x} aus der Band entfernen?', { x: m.name })))) return;
        try {
          await C.removeMember(id, m.user_id);
          if (m.me) { delete b.cloud; save(); c.cloudChanged(); }
          c.rerender();
        } catch (e) {
          c.flash(errText(e));
        }
      }, 'tb'));
    } else {
      const ref = people.find(([k]) => k && k === m.member_ref);
      r.appendChild(el('span', 'ref', esc(ref ? ref[1] : '')));
      r.appendChild(el('span', 'role', esc(roleName(m.role))));
      if (m.me) r.appendChild(iconBtn('xmark', t('Band verlassen'), async () => {
        if (!(await c.confirm(t('Band in der Cloud verlassen? Die Daten bleiben auf diesem Gerät.')))) return;
        try {
          await C.removeMember(id, m.user_id);
          delete b.cloud;
          save();
          c.cloudChanged();
          c.rerender();
        } catch (e) {
          c.flash(errText(e));
        }
      }, 'tb'));
    }
    list.appendChild(r);
  }
  if (invites.length) {
    list.appendChild(el('div', 'accessSub', esc(t('Offene Einladungen'))));
    for (const iv of invites) {
      const r = el('div', 'accessRow invite');
      r.appendChild(el('span', 'av', icon('link', 12)));
      r.appendChild(el('span', 'nm', `<b>${esc(iv.label || t('Einladung'))}</b><small>${esc(roleName(iv.role))} · ${esc(t('gültig bis {x}', { x: new Date(iv.expires_at).toLocaleDateString() }))}</small>`));
      r.appendChild(iconBtn('duplicate', t('Link kopieren'), () => void copy(C.inviteLink(iv.token), c), 'tb'));
      r.appendChild(iconBtn('xmark', t('Einladung zurückziehen'), async () => {
        try {
          await C.revokeInvite(iv.id);
          c.rerender();
        } catch (e) {
          c.flash(errText(e));
        }
      }, 'tb'));
      list.appendChild(r);
    }
  }
}

async function copy(txt: string, c: AccountCtx) {
  try {
    await navigator.clipboard.writeText(txt);
    c.flash(t('Link kopiert'));
  } catch {
    c.flash(txt);
  }
}

export async function inviteWizard(c: AccountCtx, ref = '') {
  const b = c.band();
  if (!b.cloud) return;
  const people: [string, string][] = [['', t('Niemand bestimmtes')], ...b.members.map((m) => [m.id, m.name || '?'] as [string, string]), ...b.crew.map((x) => [x.id, `${x.name || '?'} (${x.role || t('Crew')})`] as [string, string])];
  const isCrew = (id: string) => b.crew.some((x) => x.id === id);
  const r = await wizard<{ role: C.Role; ref: string }>({
    title: t('Einladen'),
    state: { role: ref && isCrew(ref) ? 'guest' : 'member', ref },
    finish: t('Link erstellen'),
    steps: [{
      title: t('Wen lädst du ein?'),
      text: t('Du bekommst einen Link, den du per Mail, WhatsApp oder Signal schickst. Er gilt 14 Tage und nur einmal.'),
      body: (box, s, redraw) => {
        wizField(box, t('Für'), select(people, s.ref, (v) => { s.ref = v; if (isCrew(v)) s.role = 'guest'; redraw(); }));
        choices<C.Role>(box, ROLES.map(([k, l, sub]) => ({ k, icon: k === 'admin' ? 'gear' : k === 'member' ? 'people' : 'eye', label: t(l), sub: t(sub) })), s.role, (k) => (s.role = k));
      },
    }],
  });
  if (!r) return;
  const label = people.find(([k]) => k && k === r.ref)?.[1] ?? '';
  let token = '';
  try {
    token = await C.createInvite(b.cloud.id, r.role, r.ref || null, label);
  } catch (e) {
    return c.flash(errText(e));
  }
  const url = C.inviteLink(token);
  await wizard<object>({
    title: t('Einladen'),
    state: {},
    finish: t('Fertig'),
    steps: [{
      title: t('Link ist bereit'),
      text: t('Schick den Link an {x}. Wer ihn öffnet, meldet sich an und ist dann als {r} in der Band.', { x: label || t('die Person'), r: roleName(r.role) }),
      body: (box) => {
        const i = wizInput(url, '', () => {});
        i.readOnly = true;
        i.onfocus = () => i.select();
        wizField(box, t('Link'), i);
        const row = el('div', 'wizBtns');
        const cp = el('button', 'btn small', `${icon('duplicate', 13)}<span>${esc(t('Kopieren'))}</span>`);
        cp.type = 'button';
        cp.onclick = () => void copy(url, c);
        row.appendChild(cp);
        if ('share' in navigator) {
          const sh = el('button', 'btn small', `${icon('share', 13)}<span>${esc(t('Teilen …'))}</span>`);
          sh.type = 'button';
          sh.onclick = () => void navigator.share({ title: t('Einladung zu {x}', { x: b.name }), text: t('Komm in unsere Band „{x}“ auf Stagecraft:', { x: b.name }), url }).catch(() => {});
          row.appendChild(sh);
        }
        box.appendChild(row);
      },
    }],
  });
  c.rerender();
}

// ---------------- accepting an invite ----------------

/** remember "#invite=…" from the address and clear it */
export function catchInviteHash() {
  const tok = C.tokenFrom(location.hash.startsWith('#invite=') ? location.hash : '');
  if (!tok) return;
  pending.set(tok);
  history.replaceState(null, '', location.pathname + location.search);
}

export const hasPendingInvite = () => !!pending.get();

async function pasteInvite(c: AccountCtx) {
  const r = await wizard<{ txt: string }>({
    title: t('Einladung annehmen'),
    state: { txt: '' },
    finish: t('Weiter'),
    steps: [{
      title: t('Link aus der Einladung einfügen'),
      ok: (s) => !!C.tokenFrom(s.txt),
      body: (box, s, redraw) => wizField(box, t('Link'), wizInput(s.txt, 'https://…#invite=…', (v) => { s.txt = v; redraw(); })),
    }],
  });
  if (!r) return;
  pending.set(C.tokenFrom(r.txt));
  await handleInvite(c);
}

/** run after start: sign in if needed, show what the invite is, accept it */
export async function handleInvite(c: AccountCtx) {
  const tok = pending.get();
  if (!tok) return;
  if (!C.currentAccount() && !(await signIn(c, t('Du wurdest in eine Band eingeladen. Melde dich an, um die Einladung anzunehmen.')))) return;
  let info: C.InviteInfo | null = null;
  try {
    info = await C.inviteInfo(tok);
  } catch (e) {
    return c.flash(errText(e));
  }
  if (!info || !info.valid) {
    pending.set('');
    return c.flash(t('Diese Einladung ist abgelaufen oder wurde schon verwendet.'));
  }
  const inv = info;
  const ok = await wizard<object>({
    title: t('Einladung'),
    state: {},
    finish: t('Annehmen'),
    steps: [{
      title: t('Einladung zu „{x}“', { x: inv.band_name }),
      text: t('Du trittst als {r} bei.', { r: roleName(inv.role) }) + (inv.label ? ' ' + t('Verknüpft mit: {x}', { x: inv.label }) : ''),
      body: () => {},
    }],
  });
  if (!ok) return;
  try {
    await C.acceptInvite(tok);
  } catch (e) {
    return c.flash(errText(e));
  }
  pending.set('');
  c.flash(t('Du bist jetzt in „{x}“.', { x: inv.band_name }));
  await c.switchTo({ id: inv.band_id, name: inv.band_name, role: inv.role });
  c.rerender();
}

// ---------------- account & data (GDPR) ----------------

async function accountData(c: AccountCtx) {
  const a = C.currentAccount();
  if (!a) return;
  let bands: C.AccountBand[] = [];
  try {
    bands = await C.accountCheck();
  } catch (e) {
    return c.flash(errText(e));
  }
  const blocked = bands.filter((b) => b.my_role === 'admin' && b.others > 0 && b.other_admins === 0);
  const alone = bands.filter((b) => b.others === 0);
  const r = await wizard<{ act: 'export' | 'delete'; confirm: string }>({
    title: t('Account & Daten'),
    state: { act: 'export', confirm: '' },
    finish: t('Weiter'),
    steps: [
      {
        title: a.email,
        text: t('Deine Daten auf diesem Gerät bleiben in jedem Fall erhalten.'),
        body: (box, s, redraw) => {
          choices<'export' | 'delete'>(box, [
            { k: 'export', icon: 'save', label: t('Meine Daten herunterladen'), sub: t('Account, Bands und Banddaten aus der Cloud als JSON-Datei') },
            { k: 'delete', icon: 'trash', label: t('Account löschen'), sub: t('Endgültig, ohne Wiederherstellung') },
          ], s.act, (k) => { s.act = k; redraw(); });
        },
      },
      {
        title: t('Account wirklich löschen?'),
        skip: (s) => s.act !== 'delete',
        ok: (s) => !blocked.length && s.confirm.trim().toLowerCase() === a.email.toLowerCase(),
        body: (box, s, redraw) => {
          if (blocked.length) {
            box.appendChild(el('p', 'wizText warn', esc(t('Du bist der einzige Admin in: {x}. Gib dort zuerst jemand anderem die Admin-Rolle (Band → Zugang).', { x: blocked.map((b) => b.band_name).join(', ') }))));
            return;
          }
          const lines = [t('Dein Account und dein Name werden gelöscht.'), t('Du wirst aus allen Bands entfernt.')];
          if (alone.length) lines.push(t('Bands, in denen du allein bist, werden mit allen Daten und Dateien in der Cloud gelöscht: {x}', { x: alone.map((b) => b.band_name).join(', ') }));
          box.appendChild(el('ul', 'wizList', lines.map((l) => `<li>${esc(l)}</li>`).join('')));
          wizField(box, t('Zur Bestätigung deine E-Mail eingeben'), wizInput(s.confirm, a.email, (v) => { s.confirm = v; redraw(); }, 'email'));
        },
      },
    ],
  });
  if (!r) return;
  if (r.act === 'export') {
    try {
      const data = await C.myData();
      const res = await saveFile(`stagecraft-daten-${new Date().toISOString().slice(0, 10)}.json`, new TextEncoder().encode(JSON.stringify(data, null, 2)), undefined, { desc: 'JSON', ext: 'json', mime: 'application/json' });
      if (res) c.flash(t('Gespeichert: {x}', { x: res.name }));
    } catch (e) {
      c.flash(errText(e));
    }
    return;
  }
  try {
    await c.syncNow().catch(() => {});
    await C.deleteAccount();
    const b = c.band();
    if (b.cloud) {
      delete b.cloud;
      save();
    }
    c.cloudChanged();
    c.flash(t('Account gelöscht. Deine Daten auf diesem Gerät sind noch da.'));
    c.rerender();
  } catch (e) {
    c.flash(errText(e));
  }
}
