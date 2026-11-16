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
