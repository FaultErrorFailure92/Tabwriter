-- Stagecraft phase 2: profiles, bands, memberships with roles, invites

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);

create table public.bands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.band_members (
  band_id uuid not null references public.bands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member', 'guest')),
  -- id of the matching member / crew entry inside the band data (optional)
  member_ref text,
  joined_at timestamptz not null default now(),
  primary key (band_id, user_id)
);
create index band_members_user_idx on public.band_members(user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references public.bands(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  role text not null default 'member' check (role in ('admin', 'member', 'guest')),
  member_ref text,
  label text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);
create index invites_band_idx on public.invites(band_id);

-- ---------- helpers (security definer: avoid RLS recursion) ----------

create or replace function public.band_role(b uuid)
returns text language sql stable security definer set search_path = '' as $$
  select role from public.band_members where band_id = b and user_id = (select auth.uid());
$$;

create or replace function public.is_band_member(b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.band_members where band_id = b and user_id = (select auth.uid()));
$$;

create or replace function public.is_band_admin(b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.band_members where band_id = b and user_id = (select auth.uid()) and role = 'admin');
$$;

create or replace function public.shares_band(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.band_members a join public.band_members o on o.band_id = a.band_id
    where a.user_id = (select auth.uid()) and o.user_id = other
  );
$$;

-- new auth user -> profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- a band always keeps at least one admin
create or replace function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    if not exists (select 1 from public.band_members where band_id = old.band_id and role = 'admin' and user_id <> old.user_id)
       and exists (select 1 from public.bands where id = old.band_id) then
      raise exception 'Eine Band braucht mindestens einen Admin.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger band_members_keep_admin before update or delete on public.band_members
  for each row execute function public.keep_one_admin();

-- ---------- RPCs ----------

create or replace function public.create_band(band_name text, my_member_ref text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare bid uuid;
begin
  if (select auth.uid()) is null then raise exception 'Nicht angemeldet.'; end if;
  insert into public.bands (name, created_by) values (band_name, (select auth.uid())) returning id into bid;
  insert into public.band_members (band_id, user_id, role, member_ref) values (bid, (select auth.uid()), 'admin', my_member_ref);
  return bid;
end;
$$;

create or replace function public.create_invite(band uuid, invite_role text default 'member', ref text default null, invite_label text default '')
returns text language plpgsql security definer set search_path = '' as $$
declare tok text;
begin
  if not public.is_band_admin(band) then raise exception 'Nur Admins können einladen.'; end if;
  if invite_role not in ('admin', 'member', 'guest') then raise exception 'Unbekannte Rolle.'; end if;
  insert into public.invites (band_id, role, member_ref, label, created_by)
  values (band, invite_role, ref, coalesce(invite_label, ''), (select auth.uid()))
  returning token into tok;
  return tok;
end;
$$;

-- what an invite is about (shown before accepting; needs login)
create or replace function public.invite_info(invite_token text)
returns table (band_id uuid, band_name text, role text, label text, valid boolean)
language sql stable security definer set search_path = '' as $$
  select i.band_id, b.name, i.role, i.label, (i.used_at is null and i.expires_at > now())
  from public.invites i join public.bands b on b.id = i.band_id
  where i.token = invite_token and (select auth.uid()) is not null;
$$;

create or replace function public.accept_invite(invite_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invites;
begin
  if (select auth.uid()) is null then raise exception 'Nicht angemeldet.'; end if;
  select * into inv from public.invites where token = invite_token for update;
  if not found then raise exception 'Einladung nicht gefunden.'; end if;
  if inv.used_at is not null then raise exception 'Diese Einladung wurde schon verwendet.'; end if;
  if inv.expires_at <= now() then raise exception 'Diese Einladung ist abgelaufen.'; end if;
  insert into public.band_members (band_id, user_id, role, member_ref)
  values (inv.band_id, (select auth.uid()), inv.role, inv.member_ref)
  on conflict (band_id, user_id) do nothing;
  update public.invites set used_by = (select auth.uid()), used_at = now() where id = inv.id;
  return inv.band_id;
end;
$$;

revoke execute on function public.create_band(text, text) from public, anon;
revoke execute on function public.create_invite(uuid, text, text, text) from public, anon;
revoke execute on function public.invite_info(text) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.create_band(text, text) to authenticated;
grant execute on function public.create_invite(uuid, text, text, text) to authenticated;
grant execute on function public.invite_info(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.keep_one_admin() from public, anon, authenticated;

-- ---------- RLS ----------

alter table public.profiles enable row level security;
alter table public.bands enable row level security;
alter table public.band_members enable row level security;
alter table public.invites enable row level security;

create policy "profiles: read own and bandmates" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_band(id));
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "bands: members read" on public.bands for select to authenticated
  using (public.is_band_member(id));
create policy "bands: admins update" on public.bands for update to authenticated
  using (public.is_band_admin(id)) with check (public.is_band_admin(id));
create policy "bands: admins delete" on public.bands for delete to authenticated
  using (public.is_band_admin(id));

create policy "members: read own bands" on public.band_members for select to authenticated
  using (public.is_band_member(band_id));
create policy "members: admins change roles" on public.band_members for update to authenticated
  using (public.is_band_admin(band_id)) with check (public.is_band_admin(band_id));
create policy "members: admins remove, anyone leaves" on public.band_members for delete to authenticated
  using (public.is_band_admin(band_id) or user_id = (select auth.uid()));

create policy "invites: admins read" on public.invites for select to authenticated
  using (public.is_band_admin(band_id));
create policy "invites: admins delete" on public.invites for delete to authenticated
  using (public.is_band_admin(band_id));
