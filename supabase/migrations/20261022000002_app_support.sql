-- =============================================================
--  Пинок v2 — поддержка приложения
--  * профиль создаётся автоматически при регистрации
--  * экземпляры повторяющихся дел на сегодня (пока нет сервера-планировщика)
--  * realtime для пинков, ленты, флагов, приборов
-- =============================================================

-- Профиль из метаданных регистрации (display_name)
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name', ''),
                           split_part(coalesce(new.email, 'Я'), '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Нужно ли делать повторяющееся дело в этот день
create function recurs_on(r jsonb, d date, start_d date) returns boolean
language sql immutable as $$
  select case r->>'type'
    when 'daily'        then true
    when 'weekly'       then r->'days' @> to_jsonb(extract(dow from d)::int)
    when 'every_n_days' then (d - start_d) % greatest((r->>'n')::int, 1) = 0
    when 'monthly'      then extract(day from d)::int = least((r->>'day')::int,
                               extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int)
    else false
  end
$$;

-- Создать сегодняшние экземпляры повторяющихся дел семьи.
-- Вчерашние несделанные помечаются «пропущено». Можно вызывать сколько угодно раз.
create function ensure_today(p_household uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  tz text; today date; t tasks; due timestamptz; n int := 0;
begin
  if not is_member(p_household) then raise exception 'forbidden'; end if;
  select timezone into tz from households where id = p_household;
  today := (now() at time zone tz)::date;

  for t in select * from tasks
           where household_id = p_household and status = 'active'
             and recurrence->>'type' <> 'once'
  loop
    if recurs_on(t.recurrence, today, (t.created_at at time zone tz)::date) then
      due := (today + coalesce(t.due_time, '21:00'::time)) at time zone tz;
      insert into task_occurrences (task_id, household_id, assignee_id, due_at)
      values (t.id, p_household, t.assignee_id, due)
      on conflict (task_id, due_at) do nothing;
      if found then n := n + 1; end if;
    end if;
    update task_occurrences set status = 'missed'
    where task_id = t.id and status = 'open'
      and (due_at at time zone tz)::date < today;
  end loop;
  return n;
end $$;

-- Realtime (в Supabase публикация уже есть; локально её может не быть)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table kicks, activity, flags, appliances, task_occurrences;
  end if;
end $$;
