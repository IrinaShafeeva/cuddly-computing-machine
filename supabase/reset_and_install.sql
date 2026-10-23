-- =============================================================
--  Пинок v2 — ПОЛНАЯ ПЕРЕУСТАНОВКА БАЗЫ
--  Вставить целиком в Supabase → SQL Editor → Run.
--
--  ⚠️ Удаляет ВСЕ таблицы старого Telegram-бота и (если запускается
--  повторно) все таблицы Пинка v2 вместе с данными. Отменить нельзя.
--
--  Файл собран из supabase/migrations/*.sql — правь миграции, не этот файл.
-- =============================================================

-- ── 1. Старый Telegram-бот ──
drop table if exists task_discussions, reminders_log, task_completions,
                     sessions, tasks, users, families cascade;

-- ── 2. Пинок v2 (при повторном запуске) ──
drop view  if exists star_balances cascade;
drop table if exists diagnoses, invites, activity, rewards, quiz_attempts, guides, penalties, bucket_items,
                     stock_events, location_pins, flags, stock_items, star_ledger, kicks,
                     task_occurrences, tasks, appliance_events, appliances, objects,
                     locations, devices, household_members, profiles, households cascade;
drop function if exists is_member(uuid), is_adult(uuid),
  _add_stars(uuid, uuid, int, text, text, uuid), _log(uuid, uuid, text, text, uuid, jsonb, int),
  appliance_template(text), create_household(text, text), join_household(text, text),
  create_task(uuid, text, uuid, jsonb, timestamptz, time, jsonb, text, text, uuid),
  complete_occurrence(uuid), snooze_occurrence(uuid, int), send_kick(uuid, uuid, text),
  respond_kick(uuid, text), raise_flag(uuid, text, text, timestamptz), claim_flag(uuid),
  create_appliance(uuid, text, text, text), set_appliance_state(uuid, text), say_thanks(uuid),
  handle_new_user(), recurs_on(jsonb, date, date), ensure_today(uuid),
  add_person(uuid, text, text), _merge_profile(uuid, uuid), accept_invite(text),
  diagnosis_stats(jsonb), save_diagnosis(uuid, jsonb, text),
  house_report(uuid, timestamptz, timestamptz) cascade;
drop trigger if exists on_auth_user_created on auth.users;

-- ── 3. Новая схема ──
-- =============================================================
--  Пинок v2 — начальная схема (существующий проект Supabase)
--  Описание продукта: docs/PRODUCT.md
--
--  Этап 1 (MVP): семьи, участники, дела + пинки, флаги, приборы, звёзды, лента.
--  Таблицы следующих этапов заведены сразу, чтобы не ломать схему потом.
-- =============================================================

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────
--  Люди и семьи
-- ─────────────────────────────────────────────

create table households (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  invite_code   text unique not null default upper(encode(gen_random_bytes(4), 'hex')),
  timezone      text not null default 'UTC',
  plan          text not null default 'free' check (plan in ('free', 'family', 'family_plus')),
  trial_ends_at timestamptz default now() + interval '30 days',
  -- Общие правила семьи: наказания, звёзды, цель недели и т.п.
  settings      jsonb not null default '{
    "penalty": { "misses_allowed": 1, "kind": "bucket" },
    "weekly_goal": null
  }',
  created_at    timestamptz not null default now()
);

-- Профиль = пользователь Supabase Auth
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  avatar        text,                       -- эмодзи или url
  locale        text not null default 'en',
  quiet_from    time not null default '23:00',
  quiet_to      time not null default '07:00',
  sound_on      boolean not null default true,
  created_at    timestamptz not null default now()
);

create table household_members (
  household_id  uuid not null references households(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  role          text not null default 'adult' check (role in ('adult', 'child', 'guest')),
  color         text,                       -- цвет человека в интерфейсе
  joined_at     timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index on household_members (user_id);

-- Push-токены устройств (Expo Push)
create table devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  push_token    text unique not null,
  platform      text not null check (platform in ('ios', 'android')),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────
--  Гид: места хранения (этап 2/4, но нужны запасам и приборам)
-- ─────────────────────────────────────────────

create table locations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  parent_id     uuid references locations(id) on delete cascade,
  name          text not null,
  kind          text not null default 'room' check (kind in ('room', 'storage')),
  photo_url     text,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);

-- Метки на фото места: «порошок тут»
create table location_pins (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references locations(id) on delete cascade,
  label         text not null,
  x             real not null check (x between 0 and 1),
  y             real not null check (y between 0 and 1),
  stock_item_id uuid                        -- FK добавляется ниже
);

-- ─────────────────────────────────────────────
--  Объекты (этап 5) и приборы (этап 1)
-- ─────────────────────────────────────────────

create table objects (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  kind          text not null check (kind in ('car', 'garden', 'pet', 'child', 'home', 'other')),
  name          text not null,
  icon          text,
  data          jsonb not null default '{}',  -- пробег, порода, дата рождения…
  created_at    timestamptz not null default now()
);

-- Прибор со статусами. states — упорядоченный цикл:
-- [{"key":"idle","label":"Свободна","heat":"green"},
--  {"key":"done","label":"Готово, разобрать","heat":"red","flag":"Стирка готова — кто разберёт?"}, …]
create table appliances (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households(id) on delete cascade,
  name              text not null,
  kind              text not null default 'custom'
                    check (kind in ('washer', 'dryer', 'dishwasher', 'vacuum', 'custom')),
  icon              text,
  states            jsonb not null,
  state             text not null,
  state_changed_at  timestamptz not null default now(),
  state_changed_by  uuid references profiles(id),
  location_id       uuid references locations(id) on delete set null,
  created_at        timestamptz not null default now()
);

create table appliance_events (
  id            uuid primary key default gen_random_uuid(),
  appliance_id  uuid not null references appliances(id) on delete cascade,
  from_state    text,
  to_state      text not null,
  by_user       uuid references profiles(id),
  at            timestamptz not null default now()
);

-- ─────────────────────────────────────────────
--  Дела
-- ─────────────────────────────────────────────

-- Шаблон дела. recurrence:
--   {"type":"once"}
--   {"type":"daily"}
--   {"type":"weekly","days":[1,3,5]}        -- 0=вс … 6=сб
--   {"type":"every_n_days","n":3}
--   {"type":"monthly","day":25}
-- due_time — к какому времени дня надо сделать (для повторяющихся).
-- kick_plan — см. docs/PRODUCT.md §3.2
create table tasks (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  title         text not null,
  notes         text,
  icon          text,
  created_by    uuid not null references profiles(id),
  assignee_id   uuid not null references profiles(id),
  recurrence    jsonb not null default '{"type":"once"}',
  due_at        timestamptz,                -- для разовых
  due_time      time,                       -- для повторяющихся
  kick_plan     jsonb not null default '{"base":{"type":"times","times":["09:00"]},"escalation":[],"overdue":"keep_kicking","wake_up":false}',
  object_id     uuid references objects(id) on delete set null,
  appliance_id  uuid references appliances(id) on delete set null,
  source        text not null default 'manual' check (source in ('manual', 'flag', 'penalty', 'object')),
  status        text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at    timestamptz not null default now()
);
create index on tasks (household_id, status);
create index on tasks (assignee_id, status);

-- Конкретный «раз» дела: сегодняшний мусор, завтрашний мусор…
-- Огонь, пинки, звёзды и наказания считаются по экземплярам.
create table task_occurrences (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references tasks(id) on delete cascade,
  household_id  uuid not null references households(id) on delete cascade,
  assignee_id   uuid not null references profiles(id),
  due_at        timestamptz not null,
  status        text not null default 'open' check (status in ('open', 'done', 'skipped', 'missed')),
  done_by       uuid references profiles(id),
  done_at       timestamptz,
  snoozed_until timestamptz,
  created_at    timestamptz not null default now(),
  unique (task_id, due_at)
);
create index on task_occurrences (household_id, status, due_at);
create index on task_occurrences (assignee_id, status, due_at);

-- ─────────────────────────────────────────────
--  Флаги
-- ─────────────────────────────────────────────

create table flags (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  title         text not null,
  kind          text not null default 'notice' check (kind in ('notice', 'request')),
  created_by    uuid references profiles(id),        -- null = создан прибором/системой
  due_at        timestamptz,                         -- для просьб со сроком
  appliance_id  uuid references appliances(id) on delete set null,
  stock_item_id uuid,                                -- FK ниже
  status        text not null default 'open' check (status in ('open', 'claimed', 'done', 'cancelled')),
  claimed_by    uuid references profiles(id),
  claimed_at    timestamptz,
  task_id       uuid references tasks(id) on delete set null,  -- дело, в которое превратился флаг
  done_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index on flags (household_id, status);

-- ─────────────────────────────────────────────
--  Пинки
-- ─────────────────────────────────────────────

create table kicks (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  occurrence_id uuid references task_occurrences(id) on delete cascade,
  flag_id       uuid references flags(id) on delete cascade,
  from_user     uuid references profiles(id),        -- null = автоматический пинок
  to_user       uuid not null references profiles(id),
  level         int not null default 1 check (level between 1 and 4),  -- 1 лёгкий … 4 космический
  combo         int not null default 1,
  phrase        text,
  sent_at       timestamptz not null default now(),
  response      text check (response in ('on_my_way', 'in_10', 'leave_me')),
  responded_at  timestamptz,
  check (occurrence_id is not null or flag_id is not null)
);
create index on kicks (to_user, sent_at desc);
create index on kicks (occurrence_id, sent_at desc);

-- ─────────────────────────────────────────────
--  Звёзды ⭐ (журнал, баланс = сумма)
-- ─────────────────────────────────────────────

create table star_ledger (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  user_id       uuid not null references profiles(id),
  amount        int not null,
  reason        text not null,      -- 'task_done', 'task_done_for_other', 'flag_claimed', 'flag_raised',
                                    -- 'appliance_step', 'stock_check', 'fast_reaction', 'thanks', 'penalty' …
  ref_type      text,
  ref_id        uuid,
  created_at    timestamptz not null default now()
);
create index on star_ledger (household_id, user_id, created_at desc);
create index on star_ledger (ref_type, ref_id);

create view star_balances with (security_invoker = true) as
  select household_id, user_id, sum(amount)::int as stars
  from star_ledger group by household_id, user_id;

-- ─────────────────────────────────────────────
--  Запасы (этап 2)
-- ─────────────────────────────────────────────

create table stock_items (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  name            text not null,
  icon            text,
  unit            text,                      -- шт, кг, л; null = режим «много/мало/нет»
  qty             numeric,
  level           text check (level in ('plenty', 'low', 'out')),
  warn_at         numeric,
  red_at          numeric,
  location_id     uuid references locations(id) on delete set null,
  on_shopping_list boolean not null default false,
  last_checked_at timestamptz,
  last_checked_by uuid references profiles(id),
  created_at      timestamptz not null default now()
);

create table stock_events (
  id            uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references stock_items(id) on delete cascade,
  kind          text not null check (kind in ('check', 'bought', 'used')),
  qty           numeric,
  level         text,
  by_user       uuid references profiles(id),
  at            timestamptz not null default now()
);

alter table location_pins add foreign key (stock_item_id) references stock_items(id) on delete set null;
alter table flags         add foreign key (stock_item_id) references stock_items(id) on delete set null;

-- ─────────────────────────────────────────────
--  Наказания (этап 3)
-- ─────────────────────────────────────────────

-- Ведро хаоса: нелюбимые дела человека
create table bucket_items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  owner_id      uuid not null references profiles(id) on delete cascade,
  title         text not null,
  added_by      uuid not null references profiles(id),
  approved      boolean not null default false,  -- владелец подтвердил
  created_at    timestamptz not null default now()
);

create table penalties (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  user_id       uuid not null references profiles(id),
  occurrence_id uuid references task_occurrences(id) on delete set null,
  kind          text not null check (kind in ('bucket', 'stars', 'money', 'study')),
  bucket_item_id uuid references bucket_items(id) on delete set null,
  task_id       uuid references tasks(id) on delete set null,   -- дело-наказание в плане
  amount        numeric,                                         -- звёзды или деньги
  status        text not null default 'active'
                check (status in ('active', 'done', 'disputed', 'forgiven', 'amnesty')),
  dispute_reason text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

-- ─────────────────────────────────────────────
--  Гид: инструкции и викторины (этап 4)
-- ─────────────────────────────────────────────

-- steps: [{"text":"Режим 40°","photo_url":null}, …]
create table guides (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  title         text not null,
  steps         jsonb not null default '[]',
  appliance_id  uuid references appliances(id) on delete set null,
  location_id   uuid references locations(id) on delete set null,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);

create table quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  user_id       uuid not null references profiles(id),
  score         int not null,
  total         int not null,
  penalty_id    uuid references penalties(id) on delete set null,
  at            timestamptz not null default now()
);

-- ─────────────────────────────────────────────
--  Награды и цели (этап 6)
-- ─────────────────────────────────────────────

create table rewards (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  title         text not null,
  cost          int not null check (cost > 0),
  for_role      text check (for_role in ('adult', 'child')),
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────
--  Лента событий
-- ─────────────────────────────────────────────

create table activity (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  actor_id      uuid references profiles(id),
  verb          text not null,    -- 'task_done', 'flag_raised', 'flag_claimed', 'kick', 'appliance_state', …
  ref_type      text,
  ref_id        uuid,
  data          jsonb not null default '{}',
  stars         int,
  created_at    timestamptz not null default now()
);
create index on activity (household_id, created_at desc);

-- =============================================================
--  Доступ (RLS): человек видит только свою семью
-- =============================================================

create function is_member(hh uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_members where household_id = hh and user_id = auth.uid())
$$;

create function is_adult(hh uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_members
                 where household_id = hh and user_id = auth.uid() and role = 'adult')
$$;

alter table households        enable row level security;
alter table profiles          enable row level security;
alter table household_members enable row level security;
alter table devices           enable row level security;
alter table locations         enable row level security;
alter table location_pins     enable row level security;
alter table objects           enable row level security;
alter table appliances        enable row level security;
alter table appliance_events  enable row level security;
alter table tasks             enable row level security;
alter table task_occurrences  enable row level security;
alter table flags             enable row level security;
alter table kicks             enable row level security;
alter table star_ledger       enable row level security;
alter table stock_items       enable row level security;
alter table stock_events      enable row level security;
alter table bucket_items      enable row level security;
alter table penalties         enable row level security;
alter table guides            enable row level security;
alter table quiz_attempts     enable row level security;
alter table rewards           enable row level security;
alter table activity          enable row level security;

-- Семья
create policy hh_read   on households for select using (is_member(id));
create policy hh_update on households for update using (is_adult(id));

-- Профили: свой + люди из своих семей
create policy pr_read on profiles for select using (
  id = auth.uid() or exists (
    select 1 from household_members a join household_members b using (household_id)
    where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy pr_insert on profiles for insert with check (id = auth.uid());
create policy pr_update on profiles for update using (id = auth.uid());

-- Участники: видно своих; вступление/выход — через RPC
create policy hm_read on household_members for select using (is_member(household_id));

-- Устройства: только свои
create policy dev_all on devices for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Только чтение для членов семьи; изменения идут через RPC (там же звёзды)
create policy r on appliance_events for select using (
  exists (select 1 from appliances a where a.id = appliance_id and is_member(a.household_id)));
create policy r on task_occurrences for select using (is_member(household_id));
create policy r on kicks            for select using (is_member(household_id));
create policy r on star_ledger      for select using (is_member(household_id));
create policy r on activity         for select using (is_member(household_id));
create policy r on penalties        for select using (is_member(household_id));
create policy r on quiz_attempts    for select using (is_member(household_id));
create policy r on stock_events     for select using (
  exists (select 1 from stock_items s where s.id = stock_item_id and is_member(s.household_id)));

-- Справочники семьи: читают все, правят взрослые
create policy r on locations   for select using (is_member(household_id));
create policy w on locations   for all    using (is_adult(household_id)) with check (is_adult(household_id));
create policy r on location_pins for select using (
  exists (select 1 from locations l where l.id = location_id and is_member(l.household_id)));
create policy w on location_pins for all using (
  exists (select 1 from locations l where l.id = location_id and is_adult(l.household_id)));
create policy r on objects     for select using (is_member(household_id));
create policy w on objects     for all    using (is_adult(household_id)) with check (is_adult(household_id));
create policy r on appliances  for select using (is_member(household_id));
create policy w on appliances  for all    using (is_adult(household_id)) with check (is_adult(household_id));
create policy r on stock_items for select using (is_member(household_id));
create policy w on stock_items for all    using (is_adult(household_id)) with check (is_adult(household_id));
create policy r on guides      for select using (is_member(household_id));
create policy w on guides      for all    using (is_adult(household_id)) with check (is_adult(household_id));
create policy r on rewards     for select using (is_member(household_id));
create policy w on rewards     for all    using (is_adult(household_id)) with check (is_adult(household_id));
create policy r on bucket_items for select using (is_member(household_id));
create policy w on bucket_items for insert with check (is_member(household_id) and added_by = auth.uid());
create policy u on bucket_items for update using (owner_id = auth.uid());
create policy d on bucket_items for delete using (owner_id = auth.uid());

-- Дела и флаги: читают все, создают/правят через RPC или напрямую (без звёзд)
create policy r on tasks for select using (is_member(household_id));
create policy u on tasks for update using (
  is_member(household_id) and (created_by = auth.uid() or assignee_id = auth.uid()));
create policy r on flags for select using (is_member(household_id));

-- =============================================================
--  Действия (RPC). Всё, что даёт звёзды, — только здесь.
-- =============================================================

create function _add_stars(hh uuid, who uuid, amt int, why text, rtype text, rid uuid)
returns void language sql security definer set search_path = public as $$
  insert into star_ledger (household_id, user_id, amount, reason, ref_type, ref_id)
  values (hh, who, amt, why, rtype, rid);
$$;

create function _log(hh uuid, actor uuid, v text, rtype text, rid uuid, d jsonb, st int)
returns void language sql security definer set search_path = public as $$
  insert into activity (household_id, actor_id, verb, ref_type, ref_id, data, stars)
  values (hh, actor, v, rtype, rid, coalesce(d, '{}'), st);
$$;

-- Шаблоны приборов
create function appliance_template(k text) returns jsonb language sql immutable as $$
  select case k
    when 'washer' then '[
      {"key":"idle","label":"Свободна","heat":"green"},
      {"key":"running","label":"Стирается","heat":"green"},
      {"key":"done","label":"Готово, разобрать","heat":"red","flag":"Стирка готова — кто разберёт?"},
      {"key":"drying","label":"Сушится","heat":"green"},
      {"key":"fold","label":"Сложить","heat":"yellow","flag":"Бельё высохло — кто сложит?"}]'::jsonb
    when 'dishwasher' then '[
      {"key":"dirty","label":"Загружается","heat":"green"},
      {"key":"running","label":"Моет","heat":"green"},
      {"key":"done","label":"Разгрузить","heat":"red","flag":"Посудомойка готова — кто разгрузит?"}]'::jsonb
    when 'dryer' then '[
      {"key":"idle","label":"Свободна","heat":"green"},
      {"key":"running","label":"Сушит","heat":"green"},
      {"key":"done","label":"Достать и сложить","heat":"red","flag":"Сушилка готова — кто достанет?"}]'::jsonb
    else '[
      {"key":"ok","label":"Всё хорошо","heat":"green"},
      {"key":"needs","label":"Нужно внимание","heat":"red"}]'::jsonb
  end
$$;

-- Создать семью (создатель — взрослый)
create function create_household(p_name text, p_timezone text default 'UTC')
returns households language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into households (name, timezone) values (p_name, p_timezone) returning * into h;
  insert into household_members (household_id, user_id, role) values (h.id, auth.uid(), 'adult');
  perform _log(h.id, auth.uid(), 'household_created', 'household', h.id, null, null);
  return h;
end $$;

-- Вступить по коду
create function join_household(p_code text, p_role text default 'adult')
returns households language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_role not in ('adult', 'child', 'guest') then raise exception 'bad role'; end if;
  select * into h from households where invite_code = upper(trim(p_code));
  if h.id is null then raise exception 'household not found'; end if;
  insert into household_members (household_id, user_id, role)
  values (h.id, auth.uid(), p_role) on conflict do nothing;
  perform _log(h.id, auth.uid(), 'member_joined', 'household', h.id, null, null);
  return h;
end $$;

-- Создать дело (+ первый экземпляр для разового)
create function create_task(
  p_household uuid, p_title text, p_assignee uuid,
  p_recurrence jsonb default '{"type":"once"}', p_due_at timestamptz default null,
  p_due_time time default null, p_kick_plan jsonb default null, p_icon text default null,
  p_notes text default null, p_appliance uuid default null
) returns tasks language plpgsql security definer set search_path = public as $$
declare t tasks;
begin
  if not is_member(p_household) then raise exception 'forbidden'; end if;
  if not exists (select 1 from household_members where household_id = p_household and user_id = p_assignee)
    then raise exception 'assignee not in household'; end if;
  if p_recurrence->>'type' = 'once' and p_due_at is null then raise exception 'due_at required'; end if;

  insert into tasks (household_id, title, notes, icon, created_by, assignee_id,
                     recurrence, due_at, due_time, kick_plan, appliance_id)
  values (p_household, p_title, p_notes, p_icon, auth.uid(), p_assignee,
          p_recurrence, p_due_at, p_due_time,
          coalesce(p_kick_plan, '{"base":{"type":"times","times":["09:00"]},"escalation":[],"overdue":"keep_kicking","wake_up":false}'),
          p_appliance)
  returning * into t;

  if p_recurrence->>'type' = 'once' then
    insert into task_occurrences (task_id, household_id, assignee_id, due_at)
    values (t.id, p_household, p_assignee, p_due_at);
  end if;
  -- Экземпляры повторяющихся дел создаёт сервер-планировщик

  perform _log(p_household, auth.uid(), 'task_created', 'task', t.id,
               jsonb_build_object('title', p_title, 'assignee', p_assignee), null);
  return t;
end $$;

-- Отметить экземпляр дела сделанным
create function complete_occurrence(p_occurrence uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  o task_occurrences; t tasks; me uuid := auth.uid();
  stars int; last_kick timestamptz;
begin
  select * into o from task_occurrences where id = p_occurrence for update;
  if o.id is null or not is_member(o.household_id) then raise exception 'forbidden'; end if;
  if o.status not in ('open', 'missed') then return 0; end if;
  select * into t from tasks where id = o.task_id;

  update task_occurrences set status = 'done', done_by = me, done_at = now() where id = o.id;

  stars := case when o.assignee_id = me then 3 else 5 end;
  perform _add_stars(o.household_id, me, stars,
    case when o.assignee_id = me then 'task_done' else 'task_done_for_other' end, 'occurrence', o.id);

  -- Быстрая реакция: сделал ≤15 мин после пинка
  select max(sent_at) into last_kick from kicks where occurrence_id = o.id and to_user = me;
  if last_kick is not null and now() - last_kick <= interval '15 minutes' then
    perform _add_stars(o.household_id, me, 2, 'fast_reaction', 'occurrence', o.id);
    stars := stars + 2;
  end if;

  if t.recurrence->>'type' = 'once' then
    update tasks set status = 'archived' where id = t.id;
  end if;
  -- Дело из флага → закрыть флаг
  update flags set status = 'done', done_at = now() where task_id = t.id and status = 'claimed';

  perform _log(o.household_id, me, 'task_done', 'occurrence', o.id,
               jsonb_build_object('title', t.title, 'for', o.assignee_id), stars);
  return stars;
end $$;

-- «Отстань на час»
create function snooze_occurrence(p_occurrence uuid, p_minutes int default 60)
returns void language plpgsql security definer set search_path = public as $$
begin
  update task_occurrences set snoozed_until = now() + make_interval(mins => p_minutes)
  where id = p_occurrence and assignee_id = auth.uid() and status = 'open';
end $$;

-- Ручной пинок с комбо. Возвращает уровень (1–4) или 0, если пауза.
create function send_kick(p_occurrence uuid default null, p_flag uuid default null, p_phrase text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); hh uuid; target uuid; recent int; lvl int;
begin
  if p_occurrence is not null then
    select household_id, assignee_id into hh, target from task_occurrences
    where id = p_occurrence and status = 'open';
  elsif p_flag is not null then
    select household_id, claimed_by into hh, target from flags
    where id = p_flag and status = 'claimed';
  end if;
  if hh is null or not is_member(hh) then raise exception 'forbidden'; end if;
  if target = me then raise exception 'cannot kick yourself'; end if;

  -- Серия: пинки от меня по этому же делу за последние 10 минут
  select count(*) into recent from kicks
  where from_user = me
    and (occurrence_id = p_occurrence or flag_id = p_flag)
    and sent_at > now() - interval '10 minutes';
  if recent >= 5 then return 0; end if;   -- «Кажется, он уже понял 😅»

  lvl := least(recent + 1, 4);
  insert into kicks (household_id, occurrence_id, flag_id, from_user, to_user, level, combo, phrase)
  values (hh, p_occurrence, p_flag, me, target, lvl, recent + 1, p_phrase);
  perform _log(hh, me, 'kick', coalesce(case when p_occurrence is not null then 'occurrence' end, 'flag'),
               coalesce(p_occurrence, p_flag), jsonb_build_object('to', target, 'level', lvl), null);
  return lvl;
end $$;

create function respond_kick(p_kick uuid, p_response text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update kicks set response = p_response, responded_at = now()
  where id = p_kick and to_user = auth.uid() and response is null;
end $$;

-- Кинуть флаг
create function raise_flag(p_household uuid, p_title text, p_kind text default 'notice',
                           p_due_at timestamptz default null)
returns flags language plpgsql security definer set search_path = public as $$
declare f flags;
begin
  if not is_member(p_household) then raise exception 'forbidden'; end if;
  insert into flags (household_id, title, kind, created_by, due_at)
  values (p_household, p_title, p_kind, auth.uid(), p_due_at) returning * into f;
  -- Звёзды за флаг начисляются, когда его возьмёт кто-то другой (защита от накрутки)
  perform _log(p_household, auth.uid(), 'flag_raised', 'flag', f.id,
               jsonb_build_object('title', p_title), null);
  return f;
end $$;

-- «Беру!» — флаг становится делом взявшего
create function claim_flag(p_flag uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  f flags; t tasks; me uuid := auth.uid(); age interval; stars int;
begin
  select * into f from flags where id = p_flag for update;
  if f.id is null or not is_member(f.household_id) then raise exception 'forbidden'; end if;
  if f.status <> 'open' then raise exception 'already taken'; end if;

  insert into tasks (household_id, title, created_by, assignee_id, recurrence, due_at,
                     appliance_id, source, kick_plan)
  values (f.household_id, f.title, coalesce(f.created_by, me), me, '{"type":"once"}',
          coalesce(f.due_at, now() + interval '2 hours'), f.appliance_id, 'flag',
          '{"base":{"type":"every","minutes":60,"between":["08:00","22:00"]},"escalation":[],"overdue":"keep_kicking","wake_up":false}')
  returning * into t;
  insert into task_occurrences (task_id, household_id, assignee_id, due_at)
  values (t.id, f.household_id, me, t.due_at);

  update flags set status = 'claimed', claimed_by = me, claimed_at = now(), task_id = t.id where id = f.id;

  -- Чем дольше горел — тем больше звёзд: 3 + 1 за каждый час, максимум 10
  age := now() - f.created_at;
  stars := least(3 + floor(extract(epoch from age) / 3600)::int, 10);
  perform _add_stars(f.household_id, me, stars, 'flag_claimed', 'flag', f.id);
  if f.created_by is not null and f.created_by <> me then
    perform _add_stars(f.household_id, f.created_by, 2, 'flag_raised', 'flag', f.id);
  end if;

  perform _log(f.household_id, me, 'flag_claimed', 'flag', f.id,
               jsonb_build_object('title', f.title), stars);
  return stars;
end $$;

-- Создать прибор по шаблону
create function create_appliance(p_household uuid, p_name text, p_kind text, p_icon text default null)
returns appliances language plpgsql security definer set search_path = public as $$
declare a appliances; st jsonb := appliance_template(p_kind);
begin
  if not is_adult(p_household) then raise exception 'forbidden'; end if;
  insert into appliances (household_id, name, kind, icon, states, state)
  values (p_household, p_name, p_kind, p_icon, st, st->0->>'key') returning * into a;
  return a;
end $$;

-- Переключить статус прибора (обычно — следующий по циклу)
create function set_appliance_state(p_appliance uuid, p_state text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  a appliances; me uuid := auth.uid(); idx int; n int; next_key text; next_state jsonb;
  cur_state jsonb; stars int := 0; red_for interval;
begin
  select * into a from appliances where id = p_appliance for update;
  if a.id is null or not is_member(a.household_id) then raise exception 'forbidden'; end if;

  n := jsonb_array_length(a.states);
  select i - 1 into idx from jsonb_array_elements(a.states) with ordinality as e(s, i)
  where s->>'key' = a.state;
  cur_state := a.states->idx;
  next_key := coalesce(p_state, a.states->((idx + 1) % n)->>'key');
  select s into next_state from jsonb_array_elements(a.states) s where s->>'key' = next_key;
  if next_state is null then raise exception 'unknown state'; end if;
  if next_key = a.state then return 0; end if;

  update appliances set state = next_key, state_changed_at = now(), state_changed_by = me
  where id = a.id;
  insert into appliance_events (appliance_id, from_state, to_state, by_user)
  values (a.id, a.state, next_key, me);

  -- Звёзды: +2 за шаг; если закрыл красный статус — +1 за каждые полчаса ожидания (до +6)
  -- Повторное переключение тем же человеком за 2 минуты — без звёзд
  if not exists (select 1 from appliance_events
                 where appliance_id = a.id and by_user = me
                   and at > now() - interval '2 minutes' and to_state <> next_key) then
    stars := 2;
    if cur_state->>'heat' in ('red', 'yellow') then
      red_for := now() - a.state_changed_at;
      stars := stars + least(floor(extract(epoch from red_for) / 1800)::int, 6);
    end if;
    perform _add_stars(a.household_id, me, stars, 'appliance_step', 'appliance', a.id);
  end if;

  -- Закрыть открытый флаг прибора, если ушли из «красного» статуса
  update flags set status = 'done', done_at = now()
  where appliance_id = a.id and status in ('open', 'claimed') and created_by is null;
  -- Новый статус требует внимания → автоматический флаг
  if next_state ? 'flag' then
    insert into flags (household_id, title, kind, appliance_id)
    values (a.household_id, next_state->>'flag', 'notice', a.id);
  end if;

  perform _log(a.household_id, me, 'appliance_state', 'appliance', a.id,
               jsonb_build_object('name', a.name, 'from', a.state, 'to', next_key,
                                  'label', next_state->>'label'), stars);
  return stars;
end $$;

-- «Спасибо» за событие в ленте: +1 звезда автору
create function say_thanks(p_activity uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ev activity;
begin
  select * into ev from activity where id = p_activity;
  if ev.id is null or not is_member(ev.household_id) then raise exception 'forbidden'; end if;
  if ev.actor_id is null or ev.actor_id = auth.uid() then return; end if;
  if exists (select 1 from star_ledger where reason = 'thanks' and ref_id = ev.id
             and user_id = ev.actor_id and created_at > now() - interval '1 day'
             and ref_type = 'activity:' || auth.uid()) then return; end if;
  perform _add_stars(ev.household_id, ev.actor_id, 1, 'thanks', 'activity:' || auth.uid(), ev.id);
end $$;

-- Внутренние функции — не для клиента
revoke execute on function _add_stars(uuid, uuid, int, text, text, uuid) from public, anon, authenticated;
revoke execute on function _log(uuid, uuid, text, text, uuid, jsonb, int) from public, anon, authenticated;
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
