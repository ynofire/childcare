-- 가정 내 자본주의 — 서버 업그레이드 v4 (v3 DB 위에 그대로 실행, 여러 번 실행해도 안전)
-- 바뀌는 것: ① 아이가 한 일(앞가림·패드·심부름·포인트 쓰기)은 모두 '신청'이 되고, 부모가 승인해야 잔고에 반영
--          ② 심부름·쓰기는 하루에 여러 번 신청 가능(대기는 항목당 5건까지) ③ 오늘 완료 횟수(done_counts) 제공
--          ④ 옛 앱의 바로 반영 호출(toggle_item/consume)은 막힘 → 새 앱으로 업데이트 필요
-- 데이터는 지우지 않습니다. (예전에 체크 칸에 기록되던 승인된 심부름은 '승인 기록'으로 옮겨 담습니다.)

-- 같은 날 같은 항목을 여러 번 신청할 수 있도록 '대기 1건' 제한을 푼다 (앞가림·패드의 하루 1회는 함수가 지킨다)
drop index if exists public.requests_one_wait_per_item_day;

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
                                          'status', m.status, 'day', m.day) order by m.id)
        from public.missions m where m.family_id = f.id
         and (m.status <> 'done' or m.created_at > now() - interval '3 days')), '[]'::jsonb),
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

-- 자녀: 신청 — 앞가림·패드·심부름·포인트 쓰기 모두 부모가 승인해야 잔고에 반영된다.
--   앞가림·패드: 하루 한 번(지난 날짜 가능) · 심부름·쓰기: 하루 여러 번(대기는 항목당 5건까지) · 쓰기는 항상 오늘
create or replace function public.request_item(p_secret text, p_item uuid, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a record; f public.families%rowtype; it public.items%rowtype; d date; st text; pend integer;
begin
  select * into a from private.check_secret(p_secret, 'child');
  select * into f from public.families where id = a.o_family for update;
  select * into it from public.items
   where id = p_item and family_id = f.id and active and kind in ('base', 'optional', 'extra', 'spend');
  if not found then raise exception 'invalid'; end if;
  d := case when it.kind = 'spend' then private.today() else private.pick_day(f.id, p_day, true) end;
  st := private.status_of(f.balance, f.bankrupt_limit);
  if it.kind in ('base', 'extra') and st = 'bankrupt' then raise exception 'bankrupt'; end if;
  if it.kind in ('optional', 'spend') and st <> 'ok' then raise exception 'blocked'; end if;
  if it.kind in ('base', 'optional') then
    if exists (select 1 from public.checks where family_id = f.id and day = d and item_id = it.id)
       or exists (select 1 from public.requests where family_id = f.id and item_id = it.id and day = d and status = 'wait') then
      raise exception 'duplicate';
    end if;
  else
    select count(*) into pend from public.requests
     where family_id = f.id and item_id = it.id and day = d and status = 'wait';
    if pend >= 5 then raise exception 'too_many'; end if;
  end if;
  if it.kind = 'spend' and f.balance - coalesce((
       select sum(-r.amount) from public.requests r join public.items x on x.id = r.item_id
        where r.family_id = f.id and r.status = 'wait' and x.kind = 'spend'), 0) < -it.amount then
    raise exception 'insufficient';
  end if;
  insert into public.requests (family_id, item_id, label, amount, day)
    values (f.id, it.id, it.title, it.amount, d);
  return private.build_state(a.o_family, a.o_role, a.o_cred, p_day);
end $$;

-- (옛 앱 호환) 심부름 신청 — request_item 과 같은 규칙
create or replace function public.request_extra(p_secret text, p_item uuid, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.request_item(p_secret, p_item, p_day);
end $$;

-- (옛 앱) 승인 없이 바로 반영되던 호출은 막는다. 새 앱(request_item)을 쓰도록 안내.
create or replace function public.toggle_item(p_secret text, p_item uuid, p_on boolean, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret, 'child');
  raise exception 'update_required';
end $$;

create or replace function public.consume(p_secret text, p_item uuid, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(p_secret, 'child');
  raise exception 'update_required';
end $$;

-- 부모: 승인 / 거절 (대기 중인 요청만, 중복 승인 불가)
--   앞가림·패드는 승인할 때 체크가 기록되고, 쓰기는 승인 시점 잔고가 모자라면 승인할 수 없다.
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
      update public.missions set status = 'done' where id = r.mission_id;
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

-- 부모: 해당 날짜에 적용·체크된 항목을 모두 되돌림 (낸 돈·받은 포인트도 함께 되돌려서 잔고가 맞게)
create or replace function public.reset_day(p_secret text, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; d date; c record;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  d := private.pick_day(a.o_family, p_day, true);
  for c in select ch.item_id, ch.amount, i.title
             from public.checks ch join public.items i on i.id = ch.item_id
            where ch.family_id = a.o_family and ch.day = d loop
    delete from public.checks where family_id = a.o_family and day = d and item_id = c.item_id;
    if c.amount <> 0 then
      perform private.add_tx(a.o_family, c.title || ' (초기화)', -c.amount, d);
    end if;
  end loop;
  -- 하루 여러 번 하는 심부름: 승인된 기록을 지우고 받은 포인트를 회수
  for c in select r.id, r.label, r.amount
             from public.requests r join public.items i on i.id = r.item_id
            where r.family_id = a.o_family and r.day = d and r.status = 'done' and i.kind = 'extra' loop
    delete from public.requests where id = c.id;
    perform private.add_tx(a.o_family, c.label || ' (초기화)', -c.amount, d);
  end loop;
  return private.build_state(a.o_family, a.o_role, a.o_cred, d);
end $$;

-- 옛 방식(체크 칸)으로 기록된 승인된 심부름 → 승인 기록으로 이관 (이미 기록이 있으면 건너뜀)
insert into public.requests (family_id, item_id, label, amount, day, status, decided_at)
select ch.family_id, ch.item_id, i.title, ch.amount, ch.day, 'done', ch.created_at
  from public.checks ch join public.items i on i.id = ch.item_id
 where i.kind = 'extra'
   and not exists (select 1 from public.requests r
                    where r.family_id = ch.family_id and r.item_id = ch.item_id and r.day = ch.day and r.status = 'done');
delete from public.checks ch using public.items i where i.id = ch.item_id and i.kind = 'extra';

update public.items set descr = '쓴 날만 신청 · 승인 후 차감' where slug = 'pad' and descr = '쓴 날만 자녀가 직접 체크';
update public.items set descr = '했으면 눌러서 신청' where slug = 'school' and descr = '했으면 체크';

revoke execute on function public.request_item(text, uuid, date) from public, authenticated;
grant execute on function public.request_item(text, uuid, date) to anon;
