-- =============================================================
--  Фото, проверка сделанного и Гид с живыми фото
--  * бакет photos: <household_id>/… — видят и загружают все члены семьи
--  * у дела: фото «как должно быть», «нужен фото-отчёт», «я проверяю», связь с гидом
--  * сделал → (фото) → автор принимает ✅ или возвращает ↩ (звёзды забираются)
--  * Гид: инструкция + фото вещи + фото «где лежит» + шаги; история фото
-- =============================================================

-- ── Хранилище фото ──
insert into storage.buckets (id, name, public, file_size_limit)
values ('photos', 'photos', false, 10485760)
on conflict (id) do nothing;

create or replace function _photo_member(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$'
              then is_member(split_part(p_name, '/', 1)::uuid) else false end
$$;
grant execute on function _photo_member(text) to authenticated;

drop policy if exists "photos: family read" on storage.objects;
drop policy if exists "photos: family insert" on storage.objects;
drop policy if exists "photos: family delete" on storage.objects;
create policy "photos: family read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and _photo_member(name));
create policy "photos: family insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and _photo_member(name));
create policy "photos: family delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and _photo_member(name));

-- ── Гид ──
alter table guides add column if not exists icon text;
alter table guides add column if not exists place text;          -- «под раковиной, слева»
alter table guides add column if not exists updated_at timestamptz not null default now();

create table if not exists guide_photos (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  guide_id      uuid not null references guides(id) on delete cascade,
  kind          text not null check (kind in ('item', 'place')),
  path          text not null,
  by_user       uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists guide_photos_guide on guide_photos (guide_id, kind, created_at desc);
alter table guide_photos enable row level security;
drop policy if exists r on guide_photos;
create policy r on guide_photos for select using (is_member(household_id));

-- ── Дела: фото и проверка ──
alter table tasks add column if not exists photo_path text;
alter table tasks add column if not exists proof_photo boolean not null default false;
alter table tasks add column if not exists needs_review boolean not null default false;
alter table tasks add column if not exists guide_id uuid references guides(id) on delete set null;

alter table task_occurrences add column if not exists proof_path text;
alter table task_occurrences add column if not exists review text check (review in ('pending', 'approved', 'rejected'));
alter table task_occurrences add column if not exists reviewed_by uuid references profiles(id);
alter table task_occurrences add column if not exists reviewed_at timestamptz;
alter table task_occurrences add column if not exists review_note text;

-- Фото/проверка/гид у дела — отдельно от update_task, чтобы не трогать его подпись
create or replace function set_task_extras(p_task uuid, p_photo text, p_proof boolean, p_review boolean, p_guide uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task;
  if t.id is null or not _can_edit_task(t) then raise exception 'forbidden'; end if;
  if p_photo is not null and split_part(p_photo, '/', 1) <> t.household_id::text then raise exception 'bad photo'; end if;
  if p_guide is not null and not exists (select 1 from guides where id = p_guide and household_id = t.household_id)
    then raise exception 'bad guide'; end if;
  update tasks set photo_path = p_photo, proof_photo = coalesce(p_proof, false),
    needs_review = coalesce(p_review, false), guide_id = p_guide
  where id = p_task;
end $$;

-- Сделал: + фото-отчёт; если автор проверяет — ждём его решения
drop function if exists complete_occurrence(uuid);
create or replace function complete_occurrence(p_occurrence uuid, p_proof text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  o task_occurrences; t tasks; me uuid := auth.uid();
  stars int; k kicks; who text; pending boolean;
begin
  select * into o from task_occurrences where id = p_occurrence for update;
  if o.id is null or not is_member(o.household_id) then raise exception 'forbidden'; end if;
  if o.status not in ('open', 'missed') then return 0; end if;
  select * into t from tasks where id = o.task_id;
  if p_proof is not null and split_part(p_proof, '/', 1) <> o.household_id::text then raise exception 'bad photo'; end if;
  if t.proof_photo and p_proof is null then raise exception 'Нужно фото: сфоткай, что сделано'; end if;
  pending := t.needs_review and t.created_by <> me;

  update task_occurrences set status = 'done', done_by = me, done_at = now(), proof_path = p_proof,
    review = case when pending then 'pending' end, reviewed_by = null, reviewed_at = null, review_note = null
  where id = o.id;

  stars := case when o.assignee_id = me then 3 else 5 end;
  perform _add_stars(o.household_id, me, stars,
    case when o.assignee_id = me then 'task_done' else 'task_done_for_other' end, 'occurrence', o.id);

  select * into k from kicks where occurrence_id = o.id and to_user = o.assignee_id
  order by sent_at desc limit 1;
  if k.id is not null and o.assignee_id = me and now() - k.sent_at <= interval '15 minutes' then
    perform _add_stars(o.household_id, me, 2, 'fast_reaction', 'occurrence', o.id);
    stars := stars + 2;
  end if;
  if k.id is not null and k.from_user is not null and k.from_user <> me
     and now() - k.sent_at <= interval '1 hour' then
    perform _add_stars(o.household_id, k.from_user, 1, 'kick_worked', 'occurrence', o.id);
  end if;
  if t.created_by <> me and t.source in ('manual', 'event', 'onboarding') then
    perform _add_stars(o.household_id, t.created_by, 1, 'task_planned', 'occurrence', o.id);
  end if;

  if t.recurrence->>'type' = 'once' then
    update tasks set status = 'archived' where id = t.id;
  end if;
  update flags set status = 'done', done_at = now() where task_id = t.id and status = 'claimed';

  perform _log(o.household_id, me, 'task_done', 'occurrence', o.id,
               jsonb_build_object('title', t.title, 'for', o.assignee_id, 'photo', p_proof is not null), stars);
  if pending then
    select display_name into who from profiles where id = me;
    perform _push(array[t.created_by], '👀 ' || coalesce(who, 'Кто-то') || ' говорит: сделано',
                  coalesce(t.icon || ' ', '') || t.title || case when p_proof is not null then ' · есть фото' else '' end || ' — проверь',
                  jsonb_build_object('type', 'review', 'occurrence_id', o.id));
  end if;
  return stars;
end $$;

-- Проверка: принять или вернуть. Вернул — дело снова открыто, звёзды за него забираются.
create or replace function review_occurrence(p_occurrence uuid, p_ok boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o task_occurrences; t tasks; me uuid := auth.uid(); who text;
begin
  select * into o from task_occurrences where id = p_occurrence for update;
  if o.id is null or not is_member(o.household_id) then raise exception 'forbidden'; end if;
  select * into t from tasks where id = o.task_id;
  if o.status <> 'done' then raise exception 'Дело ещё не сделано'; end if;
  if o.done_by = me then raise exception 'Себя проверить нельзя 🙂'; end if;
  if me <> t.created_by and not is_adult(o.household_id) then raise exception 'forbidden'; end if;
  select display_name into who from profiles where id = me;

  if p_ok then
    update task_occurrences set review = 'approved', reviewed_by = me, reviewed_at = now(), review_note = nullif(trim(p_note), '')
    where id = o.id;
    perform _log(o.household_id, me, 'task_approved', 'occurrence', o.id,
                 jsonb_build_object('title', t.title, 'doer', o.done_by), null);
    perform _push(array[o.done_by], '✅ ' || coalesce(who, '') || ' приняла(принял) работу', t.title,
                  jsonb_build_object('type', 'review', 'occurrence_id', o.id));
  else
    -- забрать все звёзды, начисленные за этот раз дела
    insert into star_ledger (household_id, user_id, amount, reason, ref_type, ref_id)
    select household_id, user_id, -sum(amount), 'rejected', 'occurrence', o.id
    from star_ledger where ref_type = 'occurrence' and ref_id = o.id
    group by household_id, user_id having sum(amount) <> 0;
    update task_occurrences set status = 'open', done_by = null, done_at = null,
      review = 'rejected', reviewed_by = me, reviewed_at = now(), review_note = nullif(trim(p_note), '')
    where id = o.id;
    if t.recurrence->>'type' = 'once' and t.status = 'archived' then
      update tasks set status = 'active' where id = t.id;
    end if;
    perform _log(o.household_id, me, 'task_rejected', 'occurrence', o.id,
                 jsonb_build_object('title', t.title, 'doer', o.done_by, 'note', nullif(trim(p_note), '')), null);
    perform _push(array[o.done_by], '↩️ ' || coalesce(who, '') || ': не принято',
                  t.title || coalesce(' — ' || nullif(trim(p_note), ''), ' — надо доделать'),
                  jsonb_build_object('type', 'review', 'occurrence_id', o.id), true);
  end if;
end $$;

-- ── Гид: создать / поправить (любой член семьи) ──
create or replace function save_guide(p_household uuid, p_id uuid, p_title text, p_icon text, p_place text, p_steps jsonb)
returns guides language plpgsql security definer set search_path = public as $$
declare g guides;
begin
  if not is_member(p_household) then raise exception 'forbidden'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Как называется?'; end if;
  if p_id is null then
    insert into guides (household_id, title, icon, place, steps, created_by)
    values (p_household, trim(p_title), p_icon, nullif(trim(p_place), ''), coalesce(p_steps, '[]'), auth.uid())
    returning * into g;
    perform _log(p_household, auth.uid(), 'guide_created', 'guide', g.id, jsonb_build_object('title', g.title), null);
  else
    update guides set title = trim(p_title), icon = p_icon, place = nullif(trim(p_place), ''),
      steps = coalesce(p_steps, '[]'), updated_at = now()
    where id = p_id and household_id = p_household returning * into g;
    if g.id is null then raise exception 'not found'; end if;
  end if;
  return g;
end $$;

create or replace function delete_guide(p_guide uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g guides;
begin
  select * into g from guides where id = p_guide;
  if g.id is null or not (is_adult(g.household_id) or g.created_by = auth.uid()) then raise exception 'forbidden'; end if;
  delete from guides where id = p_guide;
end $$;

-- Новое фото в гиде: остальным приходит push «Ира обновила фото: Губка»
create or replace function add_guide_photo(p_guide uuid, p_kind text, p_path text)
returns int language plpgsql security definer set search_path = public as $$
declare g guides; me uuid := auth.uid(); users uuid[]; who text; first boolean;
begin
  select * into g from guides where id = p_guide;
  if g.id is null or not is_member(g.household_id) then raise exception 'forbidden'; end if;
  if split_part(p_path, '/', 1) <> g.household_id::text then raise exception 'bad photo'; end if;
  first := not exists (select 1 from guide_photos where guide_id = g.id and kind = p_kind);
  insert into guide_photos (household_id, guide_id, kind, path, by_user) values (g.household_id, g.id, p_kind, p_path, me);
  update guides set updated_at = now() where id = g.id;
  perform _add_stars(g.household_id, me, 1, 'guide_photo', 'guide', g.id);
  perform _log(g.household_id, me, 'guide_photo', 'guide', g.id,
               jsonb_build_object('title', g.title, 'kind', p_kind), 1);
  if not first then
    select display_name into who from profiles where id = me;
    select array_agg(user_id) into users from household_members
    where household_id = g.household_id and user_id <> me and role <> 'guest';
    perform _push(users, '📸 ' || coalesce(who, '') || ' обновил(а) фото',
                  coalesce(g.icon || ' ', '') || g.title || case when p_kind = 'place' then ' — новое место' else ' — теперь выглядит так' end,
                  jsonb_build_object('type', 'guide', 'guide_id', g.id));
  end if;
  return 1;
end $$;

-- ── Список покупок → push выбранным людям в семье ──
create or replace function ask_to_buy(p_household uuid, p_to uuid[], p_text text)
returns int language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); users uuid[]; who text;
begin
  if not is_member(p_household) then raise exception 'forbidden'; end if;
  select array_agg(user_id) into users from household_members
  where household_id = p_household and user_id = any (p_to) and user_id <> me;
  if users is null then return 0; end if;
  select display_name into who from profiles where id = me;
  perform _push(users, '🛒 ' || coalesce(who, '') || ' просит купить', left(p_text, 230),
                jsonb_build_object('type', 'shopping'));
  perform _log(p_household, me, 'shopping_asked', 'household', p_household,
               jsonb_build_object('to', to_jsonb(users)), null);
  return array_length(users, 1);
end $$;
