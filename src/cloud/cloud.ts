// Stagecraft cloud (Supabase): accounts, bands in the cloud, roles, invites.
// supabase-js is loaded only when needed, so plain Tabwriter stays small and works offline.
import type { SupabaseClient, Session } from '@supabase/supabase-js';

// public values (they ship with the app anyway); access is guarded by row level security
export const SUPABASE_URL = 'https://orielkrpxknxnlicojsc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_uNPwrfjqNSBU4z0DTdgqmQ_OlaSinvZ';

export type Role = 'admin' | 'member' | 'guest';
export interface Account { id: string; email: string; name: string }
export interface CloudBand { id: string; name: string; role: Role }
export interface CloudMember { user_id: string; role: Role; member_ref: string | null; name: string; me: boolean }
export interface InviteInfo { band_id: string; band_name: string; role: Role; label: string; valid: boolean }

let client: SupabaseClient | null = null;
let loading: Promise<SupabaseClient> | null = null;
let account: Account | null = null;
const listeners = new Set<(a: Account | null) => void>();

/** tests swap in a fake client */
export function setClient(c: SupabaseClient | null) {
  client = c;
  loading = null;
}

async function sb(): Promise<SupabaseClient> {
  if (client) return client;
  loading ??= import('@supabase/supabase-js').then(({ createClient }) => {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'stagecraft.auth' } });
    return client;
  });
  return loading;
}

const fail = (e: { message?: string } | null) => {
  if (e) throw new Error(e.message || 'Fehler');
};

async function applySession(s: Session | null) {
  if (!s?.user) {
    account = null;
  } else {
    const c = await sb();
    const { data } = await c.from('profiles').select('name').eq('id', s.user.id).maybeSingle();
    account = { id: s.user.id, email: s.user.email ?? '', name: (data as { name?: string } | null)?.name || (s.user.email ?? '').split('@')[0] };
  }
  for (const f of listeners) f(account);
}

/** restore a saved session (only touches the network if there is one) */
export async function initCloud() {
  let has = false;
  try {
    has = !!localStorage.getItem('stagecraft.auth') || !!client;
  } catch {}
  if (!has) return;
  const c = await sb();
  const { data } = await c.auth.getSession();
  await applySession(data.session);
  watch(c);
}

let watching = false;
function watch(c: SupabaseClient) {
  if (watching) return;
  watching = true;
  c.auth.onAuthStateChange((ev, s) => {
    if (ev === 'SIGNED_OUT' || ev === 'USER_UPDATED') void applySession(s);
  });
}

export const currentAccount = () => account;
export function onAccount(f: (a: Account | null) => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** step 1: send a 6-digit code by e-mail (creates the account on first use) */
export async function sendCode(email: string) {
  const c = await sb();
  const { error } = await c.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  fail(error);
}

/** step 2: check the code and sign in */
export async function verifyCode(email: string, code: string) {
  const c = await sb();
  const { data, error } = await c.auth.verifyOtp({ email: email.trim(), token: code.replace(/\s/g, ''), type: 'email' });
  fail(error);
  await applySession(data.session);
  watch(c);
}

export async function signOut() {
  const c = await sb();
  await c.auth.signOut();
  await applySession(null);
}

export async function setName(name: string) {
  if (!account) return;
  const c = await sb();
  const { error } = await c.from('profiles').update({ name: name.trim() }).eq('id', account.id);
  fail(error);
  account = { ...account, name: name.trim() };
  for (const f of listeners) f(account);
}

export async function myBands(): Promise<CloudBand[]> {
  if (!account) return [];
  const c = await sb();
  const { data, error } = await c.from('band_members').select('role, bands(id, name)').eq('user_id', account.id);
  fail(error);
  return ((data ?? []) as unknown as { role: Role; bands: { id: string; name: string } | null }[])
    .filter((r) => r.bands)
    .map((r) => ({ id: r.bands!.id, name: r.bands!.name, role: r.role }));
}

/** create the band in the cloud; I become its admin */
export async function createCloudBand(name: string, myMemberRef: string | null): Promise<string> {
  const c = await sb();
  const { data, error } = await c.rpc('create_band', { band_name: name || 'Band', my_member_ref: myMemberRef });
  fail(error);
  return data as string;
}

export async function renameCloudBand(id: string, name: string) {
  const c = await sb();
  const { error } = await c.from('bands').update({ name }).eq('id', id);
  fail(error);
}

export async function members(bandId: string): Promise<CloudMember[]> {
  const c = await sb();
  const { data, error } = await c.from('band_members').select('user_id, role, member_ref').eq('band_id', bandId);
  fail(error);
  const rows = (data ?? []) as { user_id: string; role: Role; member_ref: string | null }[];
  const ids = rows.map((r) => r.user_id);
  const { data: prof } = ids.length ? await c.from('profiles').select('id, name').in('id', ids) : { data: [] };
  const names = new Map(((prof ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return rows.map((r) => ({ ...r, name: names.get(r.user_id) || '?', me: r.user_id === account?.id }));
}

export async function setRole(bandId: string, userId: string, role: Role) {
  const c = await sb();
  const { error } = await c.from('band_members').update({ role }).eq('band_id', bandId).eq('user_id', userId);
  fail(error);
}

export async function setMemberRef(bandId: string, userId: string, ref: string | null) {
  const c = await sb();
  const { error } = await c.from('band_members').update({ member_ref: ref }).eq('band_id', bandId).eq('user_id', userId);
  fail(error);
}

export async function removeMember(bandId: string, userId: string) {
  const c = await sb();
  const { error } = await c.from('band_members').delete().eq('band_id', bandId).eq('user_id', userId);
  fail(error);
}

/** invite link for this app (works in the web app; the desktop app accepts a pasted link or code) */
export const inviteLink = (token: string) => `${location.origin}${location.pathname}#invite=${token}`;
export const tokenFrom = (txt: string) => txt.trim().match(/(?:invite=)?([0-9a-f]{32})\b/i)?.[1]?.toLowerCase() ?? '';

export async function createInvite(bandId: string, role: Role, ref: string | null, label: string): Promise<string> {
  const c = await sb();
  const { data, error } = await c.rpc('create_invite', { band: bandId, invite_role: role, ref, invite_label: label });
  fail(error);
  return data as string;
}

export async function openInvites(bandId: string): Promise<{ id: string; token: string; role: Role; label: string; expires_at: string }[]> {
  const c = await sb();
  const { data, error } = await c.from('invites').select('id, token, role, label, expires_at').eq('band_id', bandId).is('used_at', null).gt('expires_at', new Date().toISOString()).order('created_at');
  fail(error);
  return (data ?? []) as { id: string; token: string; role: Role; label: string; expires_at: string }[];
}

export async function revokeInvite(id: string) {
  const c = await sb();
  const { error } = await c.from('invites').delete().eq('id', id);
  fail(error);
}

export async function inviteInfo(token: string): Promise<InviteInfo | null> {
  const c = await sb();
  const { data, error } = await c.rpc('invite_info', { invite_token: token });
  fail(error);
  return ((data ?? []) as InviteInfo[])[0] ?? null;
}

export async function acceptInvite(token: string): Promise<string> {
  const c = await sb();
  const { data, error } = await c.rpc('accept_invite', { invite_token: token });
  fail(error);
  return data as string;
}

/** the Supabase client (for sync) */
export const cloudClient = () => sb();
