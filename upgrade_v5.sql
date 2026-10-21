-- 가정 내 자본주의 — 서버 업그레이드 v5 (v4 DB 위에 그대로 실행, 여러 번 실행해도 안전)
-- 바뀌는 것: 반복 미션 — 부모가 미션을 낼 때 '여러 번 할 수 있어요'를 고르면, 승인돼도 완료되지 않고 계속 열려 있어
--          같은 날에도 여러 번 신청·승인할 수 있다 (예: 콩이 똥 치우기). 일반 미션은 그대로 한 번만.
-- 데이터는 지우지 않습니다. 새 칸(repeatable)을 더하고, 미션 만들기 함수에 선택 인자 하나가 늘어납니다.

alter table public.missions add column if not exists repeatable boolean not null default false;

create or replace function private.build_state(p_family uuid, p_role text, p_cred uuid, p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.families%rowtype; t date := private.today(); d date;
begin
  select * into f from public.families where id = p_family;
  d := private.pick_day(p_family, p_day, false);
  update public.credentials set last_seen_at = now()
   where id = p_cred and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
  return jsonb_build_object(
    'role', p_role, 'today', t, 'day', d, 'start_date', f.start_date,
    'family', jsonb_build_object('name', f.name, 'balance', f.balance,
                                 'academy_monthly', f.academy_monthly, 'bankrupt_limit', f.bankrupt_limit),
    'status', private.status_of(f.balance, f.bankrupt_limit),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) - 'family_id' - 'created_at' order by i.sort, i.created_at)
        from public.items i
       where i.family_id = f.id and (p_role = 'parent' or i.active)), '[]'::jsonb),
    'checks', coalesce((
      select jsonb_object_agg(c.item_id, c.amount)
        from public.checks c where c.family_id = f.id and c.day = d), '{}'::jsonb),
    'missions', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'amount', m.amount,
                                          'status', m.status, 'day', m.day, 'repeatable', m.repeatable) order by m.id)
        from public.missions m where m.family_id = f.id
         and (m.status <> 'done' or m.created_at > now() - interval '3 days')), '[]'::jsonb),
    'mission_done', coalesce((
      select jsonb_object_agg(x.mission_id, x.n)
        from (select r.mission_id, count(*) as n from public.requests r
               where r.family_id = f.id and r.day = d and r.status = 'done' and r.mission_id is not null
               group by r.mission_id) x), '{}'::jsonb),
    'done_counts', coalesce((
      select jsonb_object_agg(x.item_id, x.n)
        from (select r.item_id, count(*) as n from public.requests r
               where r.family_id = f.id and r.day = d and r.status = 'done' and r.item_id is not null
               group by r.item_id) x), '{}'::jsonb),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'item_id', r.item_id, 'mission_id', r.mission_id,
                                          'label', r.label, 'amount', r.amount, 'day', r.day) order by r.id desc)
        from public.requests r where r.family_id = f.id and r.status = 'wait'), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'item_id', r.item_id, 'mission_id', r.mission_id,
                                          'label', r.label, 'amount', r.amount, 'status', r.status,
                                          'day', r.day, 'decided_at', r.decided_at) order by r.decided_at desc, r.id desc)
        from (select * from public.requests
               where family_id = f.id and status in ('done', 'reject') and decided_at > now() - interval '2 days'
               order by decided_at desc, id desc limit 20) r), '[]'::jsonb),
    'txs', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'day', x.day, 'label', x.label,
                                          'amount', x.amount, 'balance', x.balance) order by x.id desc)
        from (select * from public.txs where family_id = f.id order by id desc limit 100) x), '[]'::jsonb)
  );
end $$;

create or replace function public.request_mission(p_secret text, p_mission bigint, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; f public.families%rowtype; m public.missions%rowtype;
begin
  select * into a from private.check_secret(p_secret, 'child');
  select * into f from public.families where id = a.o_family for update;
  select * into m from public.missions where id = p_mission and family_id = f.id for update;
  if not found then raise exception 'invalid'; end if;
  if m.status <> 'open' then raise exception 'duplicate'; end if;
  if private.status_of(f.balance, f.bankrupt_limit) = 'bankrupt' then raise exception 'bankrupt'; end if;
  update public.missions set status = 'wait' where id = m.id;
  -- 반복 미션은 한 날짜에 묶이지 않고 '한 날(오늘)'로 기록, 일반 미션은 낸 날짜로 기록
  insert into public.requests (family_id, mission_id, label, amount, day)
    values (f.id, m.id, '미션: ' || m.title, m.amount, case when m.repeatable then private.today() else m.day end);
  return private.build_state(a.o_family, a.o_role, a.o_cred, p_day);
end $$;

create or replace function public.decide_request(p_secret text, p_request bigint, p_ok boolean, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; r public.requests%rowtype; it public.items%rowtype;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  select * into r from public.requests
   where id = p_request and family_id = a.o_family and status = 'wait' for update;
  if not found then raise exception 'invalid'; end if;
  if p_ok then
    if r.mission_id is not null then
      update public.missions set status = case when repeatable then 'open' else 'done' end where id = r.mission_id;
    elsif r.item_id is not null then
      select * into it from public.items where id = r.item_id;
      if it.kind in ('base', 'optional') then
        insert into public.checks (family_id, day, item_id, amount)
          values (a.o_family, r.day, r.item_id, r.amount) on conflict do nothing;
        if not found then raise exception 'duplicate'; end if;
      elsif it.kind = 'spend' then
        if (select balance from public.families where id = a.o_family for update) < -r.amount then
          raise exception 'insufficient';
        end if;
      end if;
    end if;
    update public.requests set status = 'done', decided_at = now() where id = r.id;
    perform private.add_tx(a.o_family, r.label, r.amount, r.day);
  else
    update public.requests set status = 'reject', decided_at = now() where id = r.id;
    if r.mission_id is not null then
      update public.missions set status = 'open' where id = r.mission_id;
    end if;
  end if;
  return private.build_state(a.o_family, a.o_role, a.o_cred, p_day);
end $$;

-- 미션 만들기: 인자가 하나 늘어서 옛 정의를 지우고 새로 만든다 (옛 앱의 4개 인자 호출도 그대로 동작)
drop function if exists public.create_mission(text, text, integer, date);
create or replace function public.create_mission(
  p_secret text, p_title text, p_amount integer, p_day date default null, p_repeat boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; d date; ttl text;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  d := private.pick_day(a.o_family, p_day, true);
  ttl := left(trim(coalesce(p_title, '')), 40);
  if ttl = '' or p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'invalid'; end if;
  insert into public.missions (family_id, day, title, amount, repeatable)
    values (a.o_family, d, ttl, p_amount, coalesce(p_repeat, false));
  return private.build_state(a.o_family, a.o_role, a.o_cred, d);
end $$;

revoke execute on function public.create_mission(text, text, integer, date, boolean) from public, authenticated;
grant execute on function public.create_mission(text, text, integer, date, boolean) to anon;
