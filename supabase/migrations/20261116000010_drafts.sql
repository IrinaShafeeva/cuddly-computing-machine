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
