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
