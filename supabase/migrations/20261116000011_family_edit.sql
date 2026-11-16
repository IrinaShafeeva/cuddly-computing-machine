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
