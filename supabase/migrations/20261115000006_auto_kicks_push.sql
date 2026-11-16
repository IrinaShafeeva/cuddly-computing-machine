-- =============================================================
--  Пинок v2 — автоматические пинки по расписанию + push (docs/PRODUCT.md §3.2, §4)
--  Всё внутри Supabase:
--   * pg_cron раз в минуту вызывает run_auto_kicks() — кого пора пнуть по kick_plan
--   * каждый новый пинок / флаг / дело → push через Expo Push API (pg_net), без ключей
-- =============================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ── Устройства ──
-- Один токен — один пользователь: при входе в другой аккаунт на том же телефоне токен переезжает
create function register_device(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from devices where push_token = p_token and user_id <> auth.uid();
  insert into devices (user_id, push_token, platform) values (auth.uid(), p_token, p_platform)
  on conflict (push_token) do update set updated_at = now();
end $$;

create function unregister_device(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from devices where push_token = p_token and user_id = auth.uid();
$$;

-- ── Отправка push через Expo ──
create function _push(p_users uuid[], p_title text, p_body text, p_data jsonb default '{}', p_urgent boolean default false)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare msgs jsonb;
begin
  select jsonb_agg(jsonb_build_object(
           'to', d.push_token, 'title', p_title, 'body', p_body, 'data', p_data,
           'sound', 'default', 'priority', 'high',
           'interruptionLevel', case when p_urgent then 'time-sensitive' else 'active' end))
  into msgs
  from devices d where d.user_id = any (p_users);
  if msgs is null then return; end if;
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    body := msgs,
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb);
end $$;
revoke execute on function _push(uuid[], text, text, jsonb, boolean) from public, anon, authenticated;

-- Фразы пинков по уровню (те же, что в app/src/lib/kicks.ts)
create function kick_phrase(p_level int) returns text language sql volatile as $$
  select (case p_level
    when 1 then array['Эй, тут дело есть 👀', 'Напоминаю по-дружески', 'Тук-тук, это дело']
    when 2 then array['Оно само себя не сделает', 'Ну давай, давай!', 'Дело скучает без тебя']
    when 3 then array['Это уже серьёзно', 'Вся семья смотрит на тебя', 'Дом начинает нервничать']
    else array['ХЬЮСТОН, У НАС ПРОБЛЕМА', 'Ты в открытом космосе без дела', 'Последнее предупреждение с орбиты']
  end)[1 + floor(random() * 3)::int]
$$;

create function kick_level_name(p_level int) returns text language sql immutable as $$
  select case p_level when 1 then 'Лёгкий пинок' when 2 then 'Пинок с разбега'
                      when 3 then 'Пинок с вертушки' else 'КОСМИЧЕСКИЙ ПИНОК' end
$$;

-- ── Push на события ──
create function on_kick_push() returns trigger
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
    '🦶 ' || coalesce(who || ': ', '') || kick_level_name(new.level),
    coalesce(what, 'Дело') || ' — ' || coalesce(new.phrase, kick_phrase(new.level)),
    jsonb_build_object('type', 'kick', 'kick_id', new.id),
    new.level >= 3);
  return new;
end $$;
create trigger kick_push after insert on kicks for each row execute function on_kick_push();

create function on_flag_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare users uuid[];
begin
  select array_agg(m.user_id) into users from household_members m
  where m.household_id = new.household_id and m.role <> 'guest'
    and m.user_id is distinct from new.created_by;
  perform _push(users, '🚩 Кто возьмёт?', new.title, jsonb_build_object('type', 'flag', 'flag_id', new.id));
  return new;
end $$;
create trigger flag_push after insert on flags for each row execute function on_flag_push();

create function on_task_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.assignee_id = new.created_by or new.source = 'flag' then return new; end if;
  select display_name into who from profiles where id = new.created_by;
  perform _push(array[new.assignee_id], '✅ ' || coalesce(who, 'Тебе') || ' дал(а) тебе дело',
                coalesce(new.icon || ' ', '') || new.title, jsonb_build_object('type', 'task', 'task_id', new.id));
  return new;
end $$;
create trigger task_push after insert on tasks for each row execute function on_task_push();

-- ── Сегодняшние экземпляры дел для всех семей (раньше — только при открытии приложения) ──
alter function ensure_today(uuid) rename to _ensure_today_checked;
create function _ensure_today(p_household uuid)
returns int language plpgsql security definer set search_path = public as $$
declare tz text; today date; t tasks; due timestamptz; n int := 0;
begin
  select timezone into tz from households where id = p_household;
  today := (now() at time zone tz)::date;
  for t in select * from tasks
           where household_id = p_household and status = 'active' and recurrence->>'type' <> 'once'
  loop
    if recurs_on(t.recurrence, today, (t.created_at at time zone tz)::date) then
      due := (today + coalesce(t.due_time, '21:00'::time)) at time zone tz;
      insert into task_occurrences (task_id, household_id, assignee_id, due_at)
      values (t.id, p_household, t.assignee_id, due)
      on conflict (task_id, due_at) do nothing;
      if found then n := n + 1; end if;
    end if;
    update task_occurrences set status = 'missed'
    where task_id = t.id and status = 'open' and (due_at at time zone tz)::date < today;
  end loop;
  return n;
end $$;
revoke execute on function _ensure_today(uuid) from public, anon, authenticated;

create function ensure_today(p_household uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_household) then raise exception 'forbidden'; end if;
  return _ensure_today(p_household);
end $$;
drop function _ensure_today_checked(uuid);

create function ensure_today_all() returns void language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  for h in select id from households loop perform _ensure_today(h); end loop;
end $$;
revoke execute on function ensure_today_all() from public, anon, authenticated;

-- ── Автоматические пинки ──
alter table kicks add column slot timestamptz;   -- минута, за которую послан авто-пинок (защита от дублей)
create unique index kicks_auto_slot on kicks (occurrence_id, slot) where slot is not null;

create function _hm(t text) returns int language sql immutable as $$
  select split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int
$$;

-- Сработало ли правило в эту минуту дня (mod — минута от полуночи по времени семьи)
create function _rule_fires(r jsonb, mod int, p_now timestamptz, p_due timestamptz) returns boolean
language sql immutable as $$
  select case r->>'type'
    when 'times' then exists (select 1 from jsonb_array_elements_text(r->'times') x where _hm(x) = mod)
    when 'every' then mod between _hm(r->'between'->>0) and _hm(r->'between'->>1)
                      and (mod - _hm(r->'between'->>0)) % greatest((r->>'minutes')::int, 1) = 0
    when 'before' then date_trunc('minute', p_now) = date_trunc('minute', p_due - make_interval(mins => (r->>'minutes')::int))
    else false
  end
$$;

-- Раз в минуту: кого пора пнуть. p_now — для тестов
create function run_auto_kicks(p_now timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  o record; plan jsonb; rule jsonb; e jsonb; best interval; local timestamp; mod int;
  t time; quiet boolean; lvl int; n int := 0; slot timestamptz := date_trunc('minute', p_now);
begin
  for o in
    select oc.id, oc.household_id, oc.assignee_id, oc.due_at, oc.snoozed_until,
           tk.kick_plan, h.timezone, p.quiet_from, p.quiet_to
    from task_occurrences oc
    join tasks tk on tk.id = oc.task_id and tk.status = 'active'
    join households h on h.id = oc.household_id
    join profiles p on p.id = oc.assignee_id and not p.is_placeholder
    where oc.status = 'open'
      and (oc.snoozed_until is null or oc.snoozed_until <= p_now)
  loop
    plan := o.kick_plan;
    local := p_now at time zone o.timezone;
    t := local::time;
    mod := extract(hour from local)::int * 60 + extract(minute from local)::int;

    -- После срока: продолжать пинать или нет
    if p_now > o.due_at and coalesce(plan->>'overdue', 'keep_kicking') <> 'keep_kicking' then continue; end if;

    -- Тихие часы человека (если автор не включил «будить»)
    quiet := case when o.quiet_from > o.quiet_to then t >= o.quiet_from or t < o.quiet_to
                  else t >= o.quiet_from and t < o.quiet_to end;
    if quiet and not coalesce((plan->>'wake_up')::boolean, false) then continue; end if;

    -- Активное правило: самое «близкое к сроку» нарастание, которое уже началось, иначе база
    rule := plan->'base'; best := null;
    for e in select * from jsonb_array_elements(coalesce(plan->'escalation', '[]')) loop
      if p_now >= o.due_at - (e->>'before')::interval
         and (best is null or (e->>'before')::interval < best) then
        rule := e; best := (e->>'before')::interval;
      end if;
    end loop;
    if not _rule_fires(rule, mod, p_now, o.due_at) then continue; end if;

    -- Уровень по огню: до срока 1 · срок < 3 ч 2 · просрочено 3 · просрочено > 3 ч 4
    lvl := case when p_now > o.due_at + interval '3 hours' then 4
                when p_now > o.due_at then 3
                when o.due_at - p_now < interval '3 hours' then 2
                else 1 end;
    insert into kicks (household_id, occurrence_id, from_user, to_user, level, combo, phrase, slot)
    values (o.household_id, o.id, null, o.assignee_id, lvl, 1, kick_phrase(lvl), slot)
    on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function run_auto_kicks(timestamptz) from public, anon, authenticated;

-- ── Расписание (в Supabase; локально pg_cron может не быть) ──
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('pinok-auto-kicks', '* * * * *', 'select public.run_auto_kicks()');
    perform cron.schedule('pinok-ensure-today', '*/15 * * * *', 'select public.ensure_today_all()');
  end if;
end $$;
-- Журнал cron пишет строку на каждый запуск (1440 в сутки) — чистим старше 3 дней
select cron.schedule('pinok-cron-cleanup', '0 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
