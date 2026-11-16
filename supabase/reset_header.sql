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
