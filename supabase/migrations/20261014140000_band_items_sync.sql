-- Phase 3: band data as single entries (song, gig, setlist, ...), synced per entry

create table public.band_items (
  band_id uuid not null references public.bands(id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 32),
  id text not null check (char_length(id) between 1 and 80),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  primary key (band_id, kind, id)
);
create index band_items_changes_idx on public.band_items(band_id, updated_at);

create or replace function private.can_edit_band(b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.band_members where band_id = b and user_id = (select auth.uid()) and role in ('admin', 'member'));
$$;
revoke execute on function private.can_edit_band(uuid) from public, anon;
grant execute on function private.can_edit_band(uuid) to authenticated;

-- server time and author on every write (the change cursor relies on it)
create or replace function private.touch_band_item()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;
revoke execute on function private.touch_band_item() from public, anon, authenticated;
create trigger band_items_touch before insert or update on public.band_items
  for each row execute function private.touch_band_item();

alter table public.band_items enable row level security;
create policy "items: members read" on public.band_items for select to authenticated
  using (private.is_band_member(band_id));
create policy "items: editors insert" on public.band_items for insert to authenticated
  with check (private.can_edit_band(band_id));
create policy "items: editors update" on public.band_items for update to authenticated
  using (private.can_edit_band(band_id)) with check (private.can_edit_band(band_id));

alter publication supabase_realtime add table public.band_items;

-- files (voice memos, recordings, contracts, receipts): bucket band-files, path <band_id>/<file id>
insert into storage.buckets (id, name, public, file_size_limit)
values ('band-files', 'band-files', false, 52428800)
on conflict (id) do nothing;

create or replace function private.band_of_path(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;
revoke execute on function private.band_of_path(text) from public, anon;
grant execute on function private.band_of_path(text) to authenticated;

create policy "band files: members read" on storage.objects for select to authenticated
  using (bucket_id = 'band-files' and private.is_band_member(private.band_of_path(name)));
create policy "band files: editors upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'band-files' and private.can_edit_band(private.band_of_path(name)));
create policy "band files: editors update" on storage.objects for update to authenticated
  using (bucket_id = 'band-files' and private.can_edit_band(private.band_of_path(name)));
create policy "band files: editors delete" on storage.objects for delete to authenticated
  using (bucket_id = 'band-files' and private.can_edit_band(private.band_of_path(name)));
