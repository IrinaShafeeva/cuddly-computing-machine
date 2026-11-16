-- 1) Флаг от прибора (created_by пустой) не присылать тому, кто сам переключил прибор
create or replace function on_flag_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare users uuid[];
begin
  select array_agg(m.user_id) into users from household_members m
  where m.household_id = new.household_id and m.role <> 'guest'
    and m.user_id is distinct from new.created_by
    and m.user_id is distinct from auth.uid();
  perform _push(users, '🚩 Кто возьмёт?', new.title, jsonb_build_object('type', 'flag', 'flag_id', new.id));
  return new;
end $$;

-- 2) Один телефон — один токен: при входе в новую версию (TestFlight после Expo Go)
--    старые токены этого человека на той же платформе удаляются, иначе пуш приходит дважды
create or replace function register_device(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from devices where push_token = p_token and user_id <> auth.uid();
  delete from devices where user_id = auth.uid() and platform = p_platform and push_token <> p_token;
  insert into devices (user_id, push_token, platform) values (auth.uid(), p_token, p_platform)
  on conflict (push_token) do update set updated_at = now();
end $$;

-- Почистить уже накопившиеся дубли: оставить самый свежий токен
delete from devices d using devices n
where n.user_id = d.user_id and n.platform = d.platform and n.updated_at > d.updated_at;
-- Редактирование и удаление дел.
-- Править может взрослый, автор дела или исполнитель.
create or replace function _can_edit_task(t tasks) returns boolean language sql stable security definer set search_path = public as $$
  select is_member(t.household_id)
     and (is_adult(t.household_id) or t.created_by = auth.uid() or t.assignee_id = auth.uid())
$$;

create or replace function update_task(
  p_task uuid, p_title text, p_assignee uuid, p_recurrence jsonb,
  p_due_at timestamptz default null, p_due_time time default null,
  p_kick_plan jsonb default null, p_icon text default null, p_notes text default null
) returns tasks language plpgsql security definer set search_path = public as $$
declare t tasks; tz text;
begin
  select * into t from tasks where id = p_task;
  if t.id is null or not _can_edit_task(t) then raise exception 'forbidden'; end if;
  if not exists (select 1 from household_members where household_id = t.household_id and user_id = p_assignee)
    then raise exception 'assignee not in household'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'empty title'; end if;
  select timezone into tz from households where id = t.household_id;

  update tasks set title = trim(p_title), assignee_id = p_assignee, recurrence = p_recurrence,
    due_at = case when p_recurrence->>'type' = 'once' then p_due_at end,
    due_time = case when p_recurrence->>'type' = 'once' then null else p_due_time end,
    kick_plan = coalesce(p_kick_plan, kick_plan), icon = p_icon, notes = nullif(trim(p_notes), '')
  where id = p_task returning * into t;

  -- Открытые «разы» дела подстраиваем под новые настройки
  if p_recurrence->>'type' = 'once' then
    update task_occurrences set assignee_id = p_assignee, due_at = coalesce(p_due_at, due_at)
    where task_id = p_task and status in ('open', 'missed');
    if p_due_at is not null then
      update task_occurrences set status = 'open' where task_id = p_task and status = 'missed' and p_due_at > now();
    end if;
  else
    -- просроченные вчерашние больше не висят
    update task_occurrences set status = 'skipped' where task_id = p_task and status = 'missed';
    -- сегодняшний: если по новому расписанию сегодня не нужно — убираем, иначе переносим время
    update task_occurrences set status = 'skipped'
    where task_id = p_task and status = 'open'
      and not recurs_on(p_recurrence, (due_at at time zone tz)::date, (t.created_at at time zone tz)::date);
    update task_occurrences
    set assignee_id = p_assignee,
        due_at = ((due_at at time zone tz)::date + coalesce(p_due_time, '21:00'::time)) at time zone tz
    where task_id = p_task and status = 'open';
    perform _ensure_today(t.household_id);
  end if;
  return t;
end $$;

create or replace function delete_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task;
  if t.id is null or not _can_edit_task(t) then raise exception 'forbidden'; end if;
  update tasks set status = 'archived' where id = p_task;
  update task_occurrences set status = 'skipped' where task_id = p_task and status in ('open', 'missed');
end $$;
-- Черновики дел: после голосового разбора дела не создаются сразу, а лежат серыми
-- черновиками у автора. Нажал → поправил → «В дела». Планировщик и пуши черновики не видят.
alter table tasks drop constraint tasks_status_check;
alter table tasks add constraint tasks_status_check check (status in ('draft', 'active', 'paused', 'archived'));

-- Пуш «тебе дали дело» — только для настоящих дел
create or replace function on_task_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.status <> 'active' or new.assignee_id = new.created_by or new.source = 'flag' then return new; end if;
  select display_name into who from profiles where id = new.created_by;
  perform _push(array[new.assignee_id], '✅ ' || coalesce(who, 'Тебе') || ' дал(а) тебе дело',
                coalesce(new.icon || ' ', '') || new.title, jsonb_build_object('type', 'task', 'task_id', new.id));
  return new;
end $$;

-- Пачка черновиков: [{title, icon, assignee, recurrence, due_time, kick_plan, notes}]
create or replace function create_drafts(p_household uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0;
begin
  if not is_member(p_household) then raise exception 'forbidden'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(trim(it->>'title'), '') = '' then continue; end if;
    if not exists (select 1 from household_members where household_id = p_household and user_id = (it->>'assignee')::uuid)
      then continue; end if;
    insert into tasks (household_id, title, icon, notes, created_by, assignee_id, recurrence, due_time, kick_plan, source, status)
    values (p_household, left(trim(it->>'title'), 80), nullif(it->>'icon', ''), nullif(it->>'notes', ''), auth.uid(),
            (it->>'assignee')::uuid, coalesce(it->'recurrence', '{"type":"daily"}'),
            coalesce((it->>'due_time')::time, '21:00'),
            coalesce(it->'kick_plan', '{"base":{"type":"times","times":["09:00"]},"escalation":[],"overdue":"keep_kicking","wake_up":false}'),
            'onboarding', 'draft');
    n := n + 1;
  end loop;
  return n;
end $$;

-- update_task + p_publish: черновик → настоящее дело
drop function if exists update_task(uuid, text, uuid, jsonb, timestamptz, time, jsonb, text, text);
create or replace function update_task(
  p_task uuid, p_title text, p_assignee uuid, p_recurrence jsonb,
  p_due_at timestamptz default null, p_due_time time default null,
  p_kick_plan jsonb default null, p_icon text default null, p_notes text default null,
  p_publish boolean default false
) returns tasks language plpgsql security definer set search_path = public as $$
declare t tasks; tz text; was_draft boolean; who text;
begin
  select * into t from tasks where id = p_task;
  if t.id is null or not _can_edit_task(t) then raise exception 'forbidden'; end if;
  if not exists (select 1 from household_members where household_id = t.household_id and user_id = p_assignee)
    then raise exception 'assignee not in household'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'empty title'; end if;
  was_draft := t.status = 'draft';
  if (not was_draft or p_publish) and p_recurrence->>'type' = 'once' and p_due_at is null
    then raise exception 'due_at required'; end if;
  select timezone into tz from households where id = t.household_id;

  update tasks set title = trim(p_title), assignee_id = p_assignee, recurrence = p_recurrence,
    due_at = case when p_recurrence->>'type' = 'once' then p_due_at end,
    due_time = case when p_recurrence->>'type' = 'once' then null else p_due_time end,
    kick_plan = coalesce(p_kick_plan, kick_plan), icon = p_icon, notes = nullif(trim(p_notes), ''),
    status = case when was_draft and p_publish then 'active' else status end
  where id = p_task returning * into t;

  if was_draft and not p_publish then return t; end if;

  if was_draft then
    -- Родилось настоящее дело
    if p_recurrence->>'type' = 'once' then
      insert into task_occurrences (task_id, household_id, assignee_id, due_at)
      values (t.id, t.household_id, p_assignee, p_due_at);
    else
      perform _ensure_today(t.household_id);
    end if;
    perform _log(t.household_id, auth.uid(), 'task_created', 'task', t.id,
                 jsonb_build_object('title', t.title, 'assignee', p_assignee), null);
    if p_assignee <> auth.uid() then
      select display_name into who from profiles where id = auth.uid();
      perform _push(array[p_assignee], '✅ ' || coalesce(who, 'Тебе') || ' дал(а) тебе дело',
                    coalesce(t.icon || ' ', '') || t.title, jsonb_build_object('type', 'task', 'task_id', t.id));
    end if;
    return t;
  end if;

  -- Открытые «разы» дела подстраиваем под новые настройки
  if p_recurrence->>'type' = 'once' then
    update task_occurrences set assignee_id = p_assignee, due_at = coalesce(p_due_at, due_at)
    where task_id = p_task and status in ('open', 'missed');
    if p_due_at is not null then
      update task_occurrences set status = 'open' where task_id = p_task and status = 'missed' and p_due_at > now();
    end if;
  else
    update task_occurrences set status = 'skipped' where task_id = p_task and status = 'missed';
    update task_occurrences set status = 'skipped'
    where task_id = p_task and status = 'open'
      and not recurs_on(p_recurrence, (due_at at time zone tz)::date, (t.created_at at time zone tz)::date);
    update task_occurrences
    set assignee_id = p_assignee,
        due_at = ((due_at at time zone tz)::date + coalesce(p_due_time, '21:00'::time)) at time zone tz
    where task_id = p_task and status = 'open';
    perform _ensure_today(t.household_id);
  end if;
  return t;
end $$;
-- =============================================================
--  Редактирование семьи
--  * переименовать человека, поменять взрослый/ребёнок
--  * «это один и тот же человек»: заготовку (добавили при создании дома) слить
--    с настоящим профилем (человек зашёл по общему коду и появился второй раз)
--  * убрать человека из дома
-- =============================================================

-- Переименовать / сменить роль
create or replace function update_person(p_household uuid, p_user uuid, p_name text default null, p_role text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not exists (select 1 from household_members where household_id = p_household and user_id = p_user)
    then raise exception 'not in household'; end if;
  if p_user <> me and not is_adult(p_household) then raise exception 'forbidden'; end if;
  if nullif(trim(p_name), '') is not null then
    update profiles set display_name = left(trim(p_name), 40) where id = p_user;
  end if;
  if p_role is not null then
    if not is_adult(p_household) then raise exception 'forbidden'; end if;
    if p_role not in ('adult', 'child', 'guest') then raise exception 'bad role'; end if;
    -- последнего взрослого в ребёнка не превращаем
    if p_role <> 'adult' and not exists (select 1 from household_members
        where household_id = p_household and role = 'adult' and user_id <> p_user)
      then raise exception 'В доме должен остаться хотя бы один взрослый'; end if;
    update household_members set role = p_role where household_id = p_household and user_id = p_user;
  end if;
end $$;

-- Слить заготовку с настоящим человеком: все дела, звёзды, история переходят к нему
create or replace function merge_person(p_household uuid, p_placeholder uuid, p_into uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); target uuid := coalesce(p_into, auth.uid());
begin
  if not is_member(p_household) then raise exception 'forbidden'; end if;
  -- себя может «узнать» любой член семьи, других — только взрослый
  if target <> me and not is_adult(p_household) then raise exception 'forbidden'; end if;
  if not exists (select 1 from profiles p join household_members m on m.user_id = p.id
                 where p.id = p_placeholder and p.is_placeholder and m.household_id = p_household)
    then raise exception 'Это не заготовка'; end if;
  if not exists (select 1 from profiles p join household_members m on m.user_id = p.id
                 where p.id = target and not p.is_placeholder and m.household_id = p_household)
    then raise exception 'Человека нет в доме'; end if;
  -- личные приглашения заготовки больше не нужны
  delete from invites where placeholder_id = p_placeholder;
  perform _merge_profile(p_placeholder, target);
  perform _log(p_household, me, 'person_merged', 'profile', target, null, null);
end $$;

-- Убрать человека из дома. Его активные дела уходят в архив.
create or replace function remove_person(p_household uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_adult(p_household) then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'Себя убрать нельзя'; end if;
  update task_occurrences o set status = 'skipped'
  from tasks t where o.task_id = t.id and t.household_id = p_household
    and t.assignee_id = p_user and o.status in ('open', 'missed');
  update tasks set status = 'archived'
  where household_id = p_household and assignee_id = p_user and status in ('active', 'draft', 'paused');
  delete from invites where placeholder_id = p_user;
  delete from household_members where household_id = p_household and user_id = p_user;
end $$;

-- ── Пинок теперь — боксёрская перчатка 🥊; космический — с молниями ──
create or replace function on_kick_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; what text;
begin
  select display_name into who from profiles where id = new.from_user;
  if new.occurrence_id is not null then
    select t.title into what from task_occurrences o join tasks t on t.id = o.task_id where o.id = new.occurrence_id;
  else
    select title into what from flags where id = new.flag_id;
  end if;
  perform _push(array[new.to_user],
    case new.level when 1 then '🥊 ' when 2 then '🥊💨 ' when 3 then '🌀🥊 ' else '⚡🥊⚡ ' end
      || coalesce(who || ': ', '') || kick_level_name(new.level),
    coalesce(what, 'Дело') || ' — ' || coalesce(new.phrase, kick_phrase(new.level)),
    jsonb_build_object('type', 'kick', 'kick_id', new.id),
    new.level >= 3);
  return new;
end $$;
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


-- =============================================================
--  Несколько фото и «кто дал дело — тот и проверяет»
--  * у дела до 5 фото «как должно быть», в отчёте до 5 фото «вот, сделано»
--  * проверяет автор дела (взрослый — только если автора больше нет в доме)
--  * проверка включена по умолчанию, когда дело дают другому
-- =============================================================

alter table tasks add column if not exists photo_paths text[] not null default '{}';
alter table task_occurrences add column if not exists proof_paths text[] not null default '{}';
update tasks set photo_paths = array[photo_path] where photo_path is not null and photo_paths = '{}';
update task_occurrences set proof_paths = array[proof_path] where proof_path is not null and proof_paths = '{}';

-- Проверка по умолчанию: новое дело другому человеку — автор проверяет
alter table tasks alter column needs_review set default true;
update tasks set needs_review = true
where assignee_id is distinct from created_by and created_by is not null and status in ('active', 'draft', 'paused');

create or replace function _own_photos(p_household uuid, p_paths text[]) returns boolean
language sql immutable as $$
  select coalesce(bool_and(split_part(p, '/', 1) = p_household::text), true) from unnest(p_paths) p
$$;

-- Фото «как должно быть»: весь список целиком (порядок = порядок показа)
create or replace function set_task_photos(p_task uuid, p_photos text[])
returns void language plpgsql security definer set search_path = public as $$
declare t tasks; ps text[] := coalesce(p_photos, '{}');
begin
  select * into t from tasks where id = p_task;
  if t.id is null or not _can_edit_task(t) then raise exception 'forbidden'; end if;
  if cardinality(ps) > 5 then raise exception 'Не больше 5 фото'; end if;
  if not _own_photos(t.household_id, ps) then raise exception 'bad photo'; end if;
  update tasks set photo_paths = ps, photo_path = ps[1] where id = p_task;
end $$;

-- Сделал: + несколько фото-отчётов
drop function if exists complete_occurrence(uuid, text);
create or replace function complete_occurrence(p_occurrence uuid, p_proof text default null, p_proofs text[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  o task_occurrences; t tasks; me uuid := auth.uid();
  stars int; k kicks; who text; pending boolean;
  proofs text[] := coalesce(p_proofs, case when p_proof is not null then array[p_proof] else '{}'::text[] end);
begin
  select * into o from task_occurrences where id = p_occurrence for update;
  if o.id is null or not is_member(o.household_id) then raise exception 'forbidden'; end if;
  if o.status not in ('open', 'missed') then return 0; end if;
  select * into t from tasks where id = o.task_id;
  if cardinality(proofs) > 5 then raise exception 'Не больше 5 фото'; end if;
  if not _own_photos(o.household_id, proofs) then raise exception 'bad photo'; end if;
  if t.proof_photo and cardinality(proofs) = 0 then raise exception 'Нужно фото: сфоткай, что сделано'; end if;
  pending := t.needs_review and t.created_by is not null and t.created_by <> me;

  update task_occurrences set status = 'done', done_by = me, done_at = now(),
    proof_path = proofs[1], proof_paths = proofs,
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
               jsonb_build_object('title', t.title, 'for', o.assignee_id, 'photo', cardinality(proofs) > 0), stars);
  if pending then
    select display_name into who from profiles where id = me;
    perform _push(array[t.created_by], '👀 ' || coalesce(who, 'Кто-то') || ' говорит: сделано',
                  coalesce(t.icon || ' ', '') || t.title
                    || case when cardinality(proofs) > 0 then ' · фото: ' || cardinality(proofs) else '' end || ' — проверь',
                  jsonb_build_object('type', 'review', 'occurrence_id', o.id));
  end if;
  return stars;
end $$;

-- Проверяет тот, кто дал дело. Взрослый — только если автора уже нет в доме.
create or replace function review_occurrence(p_occurrence uuid, p_ok boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o task_occurrences; t tasks; me uuid := auth.uid(); who text;
begin
  select * into o from task_occurrences where id = p_occurrence for update;
  if o.id is null or not is_member(o.household_id) then raise exception 'forbidden'; end if;
  select * into t from tasks where id = o.task_id;
  if o.status <> 'done' then raise exception 'Дело ещё не сделано'; end if;
  if o.done_by = me then raise exception 'Себя проверить нельзя 🙂'; end if;
  if me is distinct from t.created_by and not (is_adult(o.household_id) and not exists
      (select 1 from household_members where household_id = o.household_id and user_id = t.created_by))
    then raise exception 'Проверяет тот, кто дал дело'; end if;
  select display_name into who from profiles where id = me;

  if p_ok then
    update task_occurrences set review = 'approved', reviewed_by = me, reviewed_at = now(), review_note = nullif(trim(p_note), '')
    where id = o.id;
    perform _log(o.household_id, me, 'task_approved', 'occurrence', o.id,
                 jsonb_build_object('title', t.title, 'doer', o.done_by), null);
    perform _push(array[o.done_by], '✅ ' || coalesce(who, '') || ' приняла(принял) работу', t.title,
                  jsonb_build_object('type', 'review', 'occurrence_id', o.id));
  else
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

-- ── ПО ЖЕЛАНИЮ: дела из первого голосового разбора → обратно в черновики ──
-- Убери «--» в двух строках ниже, если хочешь разобрать их заново через черновики.
-- update task_occurrences o set status = 'skipped' from tasks t where o.task_id = t.id and t.source = 'onboarding' and t.status = 'active' and o.status in ('open', 'missed');
-- update tasks set status = 'draft' where source = 'onboarding' and status = 'active';
