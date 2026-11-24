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
drop table if exists invisible_cards, diagnoses, invites, activity, rewards, quiz_attempts, guides, penalties, bucket_items,
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
  house_report(uuid, timestamptz, timestamptz), cards_for(uuid),
  add_stock_items(uuid, jsonb), check_stock(uuid, text), bought_stock(uuid), delete_stock_item(uuid),
  register_device(text, text), unregister_device(text), _push(uuid[], text, text, jsonb, boolean),
  kick_phrase(int), kick_level_name(int), on_kick_push(), on_flag_push(), on_task_push(),
  _ensure_today(uuid), ensure_today_all(), _hm(text), _rule_fires(jsonb, int, timestamptz, timestamptz),
  run_auto_kicks(timestamptz),
  update_task(uuid, text, uuid, jsonb, timestamptz, time, jsonb, text, text),
  update_task(uuid, text, uuid, jsonb, timestamptz, time, jsonb, text, text, boolean), delete_task(uuid),
  create_drafts(uuid, jsonb),
  update_person(uuid, uuid, text, text), merge_person(uuid, uuid, uuid), remove_person(uuid, uuid),
  _photo_member(text), set_task_extras(uuid, text, boolean, boolean, uuid), complete_occurrence(uuid, text),
  review_occurrence(uuid, boolean, text), save_guide(uuid, uuid, text, text, text, jsonb), delete_guide(uuid),
  add_guide_photo(uuid, text, text), ask_to_buy(uuid, uuid[], text),
  _own_photos(uuid, text[]), set_task_photos(uuid, text[]), complete_occurrence(uuid, text, text[]) cascade;
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
-- =============================================================
--  Пинок v2 — карточки «Это тоже ты?» в базе (раньше были в коде)
--  Редактируются в Supabase → Table Editor → invisible_cards.
--  requires: показывать, только если на шаге «Что есть дома» отмечено это (kids, pets, car…)
-- =============================================================

create table invisible_cards (
  key       text primary key,
  emoji     text not null,
  title     text not null,
  per_week  numeric not null default 1,      -- сколько раз в неделю (для процентов)
  requires  text,                            -- null = показывать всем
  sort      int not null default 0,
  active    boolean not null default true
);

alter table invisible_cards enable row level security;
create policy r on invisible_cards for select using (auth.uid() is not null);

insert into invisible_cards (key, emoji, title, per_week, requires, sort) values
  ('birthdays',         '🎂', 'Помнить про дни рождения и покупать подарки', 0.5,  null,   10),
  ('doctors',           '💉', 'Следить за врачами и прививками',              0.5,  null,   20),
  ('running_out',       '🧻', 'Замечать, что кончается еда и бытовое',        5,    null,   30),
  ('shopping_list',     '🛒', 'Составлять список покупок',                    2,    null,   40),
  ('menu',              '🍲', 'Решать, что готовить',                         7,    null,   50),
  ('kids_clothes',      '👕', 'Знать, что ребёнок вырос из одежды',           0.25, 'kids', 60),
  ('school_docs',       '📝', 'Документы, оплаты и чаты школы/садика',        2,    'kids', 70),
  ('kids_schedule',     '🗓', 'Помнить расписание кружков и секций',          3,    'kids', 80),
  ('bills',             '💸', 'Помнить про счета и платежи',                  0.5,  null,   90),
  ('where_things',      '🔎', 'Знать, где что лежит, и отвечать «где…?»',     7,    null,  100),
  ('reminding',         '📣', 'Напоминать другим про их дела',                7,    null,  110),
  ('gifts_family',      '🎁', 'Подарки учителям, родне, на праздники',        0.25, null,  120),
  ('household_repairs', '🔧', 'Замечать, что сломалось, и вызывать мастера',  0.25, null,  130),
  ('weekend_plans',     '🎈', 'Планировать выходные и досуг семьи',           1,    null,  140),
  ('pets',              '🐾', 'Ветеринар, корм, прививки питомца',            0.5,  'pets', 150),
  ('car_service',       '🚗', 'Помнить про ТО, страховку и шины',             0.25, 'car',  160),
  ('garden',            '🌳', 'Следить за садом: полив, стрижка, сезонные работы', 1, 'garden', 170);

-- Карточки для конкретной семьи: активные и подходящие под «что есть дома»
create function cards_for(p_household uuid)
returns setof invisible_cards language sql stable security definer set search_path = public as $$
  select c.* from invisible_cards c, households h
  where h.id = p_household and is_member(p_household) and c.active
    and (c.requires is null
         or not (h.settings ? 'has')                      -- шаг пропустили — показываем всё
         or h.settings->'has' ? c.requires)
  order by c.sort
$$;
-- =============================================================
--  Пинок v2 — «Наш холодильник»: запасы (docs/PRODUCT.md §10)
--  Отметил «мало/нет» → у всех пожелтело/покраснело, попало в список покупок,
--  отметившему звёзды (это «заметил» — невидимый труд). Купил → снова зелёное, звёзды.
-- =============================================================

alter table stock_items add column zone text not null default 'fridge'
  check (zone in ('fridge', 'pantry', 'bathroom', 'chemicals', 'kids', 'other'));
alter table stock_items add column sort int not null default 0;
alter table stock_items add column last_level_by uuid references profiles(id);

-- Любой член семьи может добавить продукт (раньше — только взрослые)
drop policy w on stock_items;

-- Добавить продукты пачкой: [{"name":"Помидоры","icon":"🍅","zone":"fridge"}, …]. Повторы по имени пропускаются
create function add_stock_items(p_household uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare i jsonb; n int := 0;
begin
  if not is_member(p_household) then raise exception 'forbidden'; end if;
  for i in select * from jsonb_array_elements(p_items) loop
    if coalesce(trim(i->>'name'), '') = '' then continue; end if;
    if exists (select 1 from stock_items where household_id = p_household
               and lower(name) = lower(trim(i->>'name'))) then continue; end if;
    insert into stock_items (household_id, name, icon, zone, level, sort)
    values (p_household, trim(i->>'name'), nullif(i->>'icon', ''),
            coalesce(nullif(i->>'zone', ''), 'other'), 'plenty', n);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Отметить уровень: plenty / low / out. Возвращает звёзды
create function check_stock(p_item uuid, p_level text)
returns int language plpgsql security definer set search_path = public as $$
declare
  s stock_items; me uuid := auth.uid(); stars int := 0; prev_check stock_events;
begin
  if p_level not in ('plenty', 'low', 'out') then raise exception 'bad level'; end if;
  select * into s from stock_items where id = p_item for update;
  if s.id is null or not is_member(s.household_id) then raise exception 'forbidden'; end if;

  -- Халтура: кто-то другой час назад сказал «много», а теперь «нет» — его звезда сгорает
  if p_level = 'out' then
    select * into prev_check from stock_events
    where stock_item_id = s.id and kind = 'check' and level = 'plenty'
      and by_user is distinct from me and at > now() - interval '1 hour'
    order by at desc limit 1;
    if prev_check.id is not null then
      perform _add_stars(s.household_id, prev_check.by_user, -1, 'stock_check_wrong', 'stock', s.id);
    end if;
  end if;

  -- Звёзды: +1 за проверку, +1 если давно никто не проверял (3 дня). Повтор тем же человеком за 30 мин — 0
  if not exists (select 1 from stock_events where stock_item_id = s.id and by_user = me
                 and kind = 'check' and at > now() - interval '30 minutes') then
    stars := 1 + case when s.last_checked_at is null or s.last_checked_at < now() - interval '3 days' then 1 else 0 end;
    perform _add_stars(s.household_id, me, stars, 'stock_check', 'stock', s.id);
  end if;

  update stock_items set level = p_level, last_checked_at = now(), last_checked_by = me,
    last_level_by = me, on_shopping_list = (p_level <> 'plenty')
  where id = s.id;
  insert into stock_events (stock_item_id, kind, level, by_user) values (s.id, 'check', p_level, me);

  perform _log(s.household_id, me, 'stock_check', 'stock', s.id,
               jsonb_build_object('name', s.name, 'icon', s.icon, 'level', p_level), nullif(stars, 0));
  return stars;
end $$;

-- Купил → снова «много», убрать из списка покупок
create function bought_stock(p_item uuid)
returns int language plpgsql security definer set search_path = public as $$
declare s stock_items; me uuid := auth.uid();
begin
  select * into s from stock_items where id = p_item for update;
  if s.id is null or not is_member(s.household_id) then raise exception 'forbidden'; end if;
  if not s.on_shopping_list then return 0; end if;
  update stock_items set level = 'plenty', on_shopping_list = false,
    last_checked_at = now(), last_checked_by = me, last_level_by = me
  where id = s.id;
  insert into stock_events (stock_item_id, kind, level, by_user) values (s.id, 'bought', 'plenty', me);
  perform _add_stars(s.household_id, me, 2, 'stock_bought', 'stock', s.id);
  perform _log(s.household_id, me, 'stock_bought', 'stock', s.id,
               jsonb_build_object('name', s.name, 'icon', s.icon), 2);
  return 2;
end $$;

create function delete_stock_item(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  select household_id into hh from stock_items where id = p_item;
  if hh is null or not is_member(hh) then raise exception 'forbidden'; end if;
  delete from stock_items where id = p_item;
end $$;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table stock_items;
  end if;
end $$;
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
-- Голосовые записи диагностики: приватный бакет voice, у каждого своя папка voice/<user_id>/…
insert into storage.buckets (id, name, public, file_size_limit)
values ('voice', 'voice', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "voice: own read" on storage.objects;
drop policy if exists "voice: own insert" on storage.objects;
drop policy if exists "voice: own update" on storage.objects;
drop policy if exists "voice: own delete" on storage.objects;

create policy "voice: own read" on storage.objects for select to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voice: own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voice: own update" on storage.objects for update to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voice: own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);
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

-- обновить список функций для приложения сразу
notify pgrst, 'reload schema';
