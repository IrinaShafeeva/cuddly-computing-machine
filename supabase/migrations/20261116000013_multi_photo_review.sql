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
