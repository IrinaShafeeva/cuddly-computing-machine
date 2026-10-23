-- =============================================================
--  Пинок v2 — онбординг и невидимый труд (docs/PRODUCT.md §7.3, §8)
--  * люди-заготовки: человек есть в доме до установки приложения
--  * личные приглашения
--  * диагностика «кто что делает» (видит только автор, поделиться — по желанию)
--  * звёзды за «спланировала» и «напомнила»
--  * отчёт по дому
-- =============================================================

-- ── Люди-заготовки ──
-- Профиль-заготовка не связан с auth.users. Когда человек принимает приглашение,
-- заготовка «вливается» в его настоящий профиль (merge_profile).
alter table profiles drop constraint profiles_id_fkey;
alter table profiles add column is_placeholder boolean not null default false;
alter table profiles add column created_by uuid;

create table invites (
  token          text primary key default encode(gen_random_bytes(12), 'hex'),
  household_id   uuid not null references households(id) on delete cascade,
  placeholder_id uuid references profiles(id) on delete cascade,   -- null = общее приглашение
  role           text not null default 'adult' check (role in ('adult', 'child', 'guest')),
  created_by     uuid not null references profiles(id),
  used_by        uuid references profiles(id),
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);
alter table invites enable row level security;
create policy r on invites for select using (is_member(household_id));

-- Добавить человека, которого ещё нет в приложении
create function add_person(p_household uuid, p_name text, p_role text default 'adult')
returns jsonb language plpgsql security definer set search_path = public as $$
declare pid uuid := gen_random_uuid(); tok text;
begin
  if not is_adult(p_household) then raise exception 'forbidden'; end if;
  if p_role not in ('adult', 'child', 'guest') then raise exception 'bad role'; end if;
  insert into profiles (id, display_name, is_placeholder, created_by)
  values (pid, p_name, true, auth.uid());
  insert into household_members (household_id, user_id, role) values (p_household, pid, p_role);
  insert into invites (household_id, placeholder_id, role, created_by)
  values (p_household, pid, p_role, auth.uid()) returning token into tok;
  perform _log(p_household, auth.uid(), 'person_added', 'profile', pid,
               jsonb_build_object('name', p_name), null);
  return jsonb_build_object('profile_id', pid, 'token', tok);
end $$;

-- Перенести всё с профиля-заготовки на настоящий профиль.
-- Обходит все внешние ключи, ссылающиеся на profiles(id) — новые таблицы подхватятся сами.
create function _merge_profile(p_from uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  -- Членство: если человек уже в этой семье — заготовочное членство просто удаляем
  delete from household_members hm
  where hm.user_id = p_from
    and exists (select 1 from household_members x where x.household_id = hm.household_id and x.user_id = p_to);

  for r in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
  loop
    execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_to, p_from;
  end loop;
  delete from profiles where id = p_from and is_placeholder;
end $$;
revoke execute on function _merge_profile(uuid, uuid) from public, anon, authenticated;

-- Принять приглашение (личное или общее код дома)
create function accept_invite(p_token text)
returns households language plpgsql security definer set search_path = public as $$
declare inv invites; h households; me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into inv from invites where token = p_token for update;
  if inv.token is null then raise exception 'invite not found'; end if;
  if inv.used_by is not null and inv.placeholder_id is not null then raise exception 'invite already used'; end if;

  if inv.placeholder_id is not null then
    perform _merge_profile(inv.placeholder_id, me);
  end if;
  insert into household_members (household_id, user_id, role)
  values (inv.household_id, me, inv.role) on conflict do nothing;
  update invites set used_by = me, used_at = now() where token = inv.token;

  select * into h from households where id = inv.household_id;
  perform _log(h.id, me, 'member_joined', 'household', h.id, null, null);
  return h;
end $$;

-- Профили-заготовки видны семье (политика pr_read уже покрывает через household_members)

-- ── Диагностика ──
-- items: [{"title":"Проверить рюкзак","who":"<profile_id>|null","freq":"daily|weekly|…",
--          "per_week":7,"invisible":true,"source":"voice|card"}]
create table diagnoses (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  transcript    text,
  items         jsonb not null default '[]',
  stats         jsonb not null default '{}',   -- {"<profile_id>": {"total":34,"invisible":21,"share":0.78}}
  shared        boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table diagnoses enable row level security;
create policy r on diagnoses for select using (user_id = auth.uid() or (shared and is_member(household_id)));
create policy w on diagnoses for insert with check (user_id = auth.uid() and is_member(household_id));
create policy u on diagnoses for update using (user_id = auth.uid());

-- Пересчитать доли по пунктам диагностики (вызывается после сохранения items)
create function diagnosis_stats(p_items jsonb)
returns jsonb language sql immutable as $$
  with x as (
    select i->>'who' as who,
           coalesce((i->>'per_week')::numeric, 1) as w,
           coalesce((i->>'invisible')::boolean, false) as inv
    from jsonb_array_elements(p_items) i
    where i->>'who' is not null
  ), tot as (select sum(w) t from x)
  select coalesce(jsonb_object_agg(who, jsonb_build_object(
           'total', round(s, 1), 'invisible', round(coalesce(si, 0), 1),
           'share', case when (select t from tot) > 0 then round(s / (select t from tot), 2) else 0 end)), '{}')
  from (select who, sum(w) s, sum(w) filter (where inv) si from x group by who) g
$$;

create function save_diagnosis(p_household uuid, p_items jsonb, p_transcript text default null)
returns diagnoses language plpgsql security definer set search_path = public as $$
declare d diagnoses;
begin
  if not is_member(p_household) then raise exception 'forbidden'; end if;
  insert into diagnoses (household_id, user_id, transcript, items, stats)
  values (p_household, auth.uid(), p_transcript, p_items, diagnosis_stats(p_items))
  returning * into d;
  return d;
end $$;

-- ── Звёзды за невидимый труд ──
-- complete_occurrence: + «спланировал» автору дела, + «напомнил» тому, чей пинок сработал
create or replace function complete_occurrence(p_occurrence uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  o task_occurrences; t tasks; me uuid := auth.uid();
  stars int; k kicks;
begin
  select * into o from task_occurrences where id = p_occurrence for update;
  if o.id is null or not is_member(o.household_id) then raise exception 'forbidden'; end if;
  if o.status not in ('open', 'missed') then return 0; end if;
  select * into t from tasks where id = o.task_id;

  update task_occurrences set status = 'done', done_by = me, done_at = now() where id = o.id;

  stars := case when o.assignee_id = me then 3 else 5 end;
  perform _add_stars(o.household_id, me, stars,
    case when o.assignee_id = me then 'task_done' else 'task_done_for_other' end, 'occurrence', o.id);

  -- Последний пинок исполнителю по этому делу
  select * into k from kicks where occurrence_id = o.id and to_user = o.assignee_id
  order by sent_at desc limit 1;
  -- Быстрая реакция: сделал ≤15 мин после пинка
  if k.id is not null and o.assignee_id = me and now() - k.sent_at <= interval '15 minutes' then
    perform _add_stars(o.household_id, me, 2, 'fast_reaction', 'occurrence', o.id);
    stars := stars + 2;
  end if;
  -- 👻 Напомнил: ручной пинок сработал в течение часа
  if k.id is not null and k.from_user is not null and k.from_user <> me
     and now() - k.sent_at <= interval '1 hour' then
    perform _add_stars(o.household_id, k.from_user, 1, 'kick_worked', 'occurrence', o.id);
  end if;
  -- 👻 Спланировал: автор дела, если делал не он
  if t.created_by <> me and t.source in ('manual', 'event') then
    perform _add_stars(o.household_id, t.created_by, 1, 'task_planned', 'occurrence', o.id);
  end if;

  if t.recurrence->>'type' = 'once' then
    update tasks set status = 'archived' where id = t.id;
  end if;
  update flags set status = 'done', done_at = now() where task_id = t.id and status = 'claimed';

  perform _log(o.household_id, me, 'task_done', 'occurrence', o.id,
               jsonb_build_object('title', t.title, 'for', o.assignee_id), stars);
  return stars;
end $$;

alter table tasks drop constraint tasks_source_check;
alter table tasks add constraint tasks_source_check
  check (source in ('manual', 'flag', 'penalty', 'object', 'event', 'onboarding'));

-- ── Отчёт по дому ──
-- Четыре вида труда: сделал (видимый) · заметил · спланировал · напомнил (невидимый)
create function house_report(p_household uuid, p_from timestamptz default now() - interval '7 days',
                             p_to timestamptz default now())
returns table (user_id uuid, done int, noticed int, planned int, reminded int, total int, share numeric)
language sql stable security definer set search_path = public as $$
  with m as (select user_id from household_members where household_id = p_household and is_member(p_household)),
  a as (
    select actor_id, verb, data from activity
    where household_id = p_household and created_at >= p_from and created_at < p_to
  ),
  c as (
    select m.user_id,
      (select count(*) from a where a.actor_id = m.user_id and a.verb = 'task_done')::int as done,
      ((select count(*) from a where a.actor_id = m.user_id and a.verb in ('flag_raised', 'stock_check'))
       + (select count(*) from a where a.actor_id = m.user_id and a.verb = 'appliance_state'
            and a.data->>'to' in (select s->>'key' from appliances ap, jsonb_array_elements(ap.states) s
                                  where ap.household_id = p_household and s->>'heat' <> 'green')))::int as noticed,
      (select count(*) from a where a.actor_id = m.user_id and a.verb in ('task_created', 'event_created')
         and coalesce(a.data->>'assignee', '') <> m.user_id::text)::int as planned,
      (select count(*) from kicks k where k.household_id = p_household and k.from_user = m.user_id
         and k.sent_at >= p_from and k.sent_at < p_to)::int as reminded
    from m
  )
  select user_id, done, noticed, planned, reminded,
         done + noticed + planned + reminded as total,
         case when sum(done + noticed + planned + reminded) over () > 0
              then round((done + noticed + planned + reminded)::numeric
                         / sum(done + noticed + planned + reminded) over (), 2)
              else 0 end as share
  from c
$$;
