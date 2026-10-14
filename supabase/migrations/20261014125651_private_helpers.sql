-- helper functions out of the public API (only used by RLS policies and RPCs)
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.band_role(uuid) set schema private;
alter function public.is_band_member(uuid) set schema private;
alter function public.is_band_admin(uuid) set schema private;
alter function public.shares_band(uuid) set schema private;
alter function public.handle_new_user() set schema private;
alter function public.keep_one_admin() set schema private;
revoke execute on all functions in schema private from public, anon;
grant execute on function private.band_role(uuid), private.is_band_member(uuid), private.is_band_admin(uuid), private.shares_band(uuid) to authenticated;
-- RPCs call helpers by name: point them to the new schema
create or replace function public.create_invite(band uuid, invite_role text default 'member', ref text default null, invite_label text default '')
returns text language plpgsql security definer set search_path = '' as $$
declare tok text;
begin
  if not private.is_band_admin(band) then raise exception 'Nur Admins können einladen.'; end if;
  if invite_role not in ('admin', 'member', 'guest') then raise exception 'Unbekannte Rolle.'; end if;
  insert into public.invites (band_id, role, member_ref, label, created_by)
  values (band, invite_role, ref, coalesce(invite_label, ''), (select auth.uid()))
  returning token into tok;
  return tok;
end;
$$;
