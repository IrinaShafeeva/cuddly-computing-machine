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
