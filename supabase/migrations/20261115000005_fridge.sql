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
