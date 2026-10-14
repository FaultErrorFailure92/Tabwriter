-- GDPR: users delete their own account. Bands where they are the only member go with it;
-- bands with other members need another admin first.

create or replace function public.account_check()
returns table (band_id uuid, band_name text, others int, other_admins int, my_role text)
language sql stable security definer set search_path = '' as $$
  select b.id, b.name,
    (select count(*)::int from public.band_members o where o.band_id = b.id and o.user_id <> (select auth.uid())),
    (select count(*)::int from public.band_members o where o.band_id = b.id and o.user_id <> (select auth.uid()) and o.role = 'admin'),
    m.role
  from public.band_members m join public.bands b on b.id = m.band_id
  where m.user_id = (select auth.uid());
$$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); blocked text;
begin
  if me is null then raise exception 'Nicht angemeldet.'; end if;
  select string_agg(c.band_name, ', ') into blocked from public.account_check() c
    where c.my_role = 'admin' and c.others > 0 and c.other_admins = 0;
  if blocked is not null then
    raise exception 'Gib zuerst jemand anderem die Admin-Rolle in: %', blocked using errcode = 'P0001';
  end if;
  delete from public.bands b where exists (select 1 from public.band_members m where m.band_id = b.id and m.user_id = me)
    and not exists (select 1 from public.band_members o where o.band_id = b.id and o.user_id <> me);
  delete from public.band_members where user_id = me;
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.account_check() from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.account_check() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
