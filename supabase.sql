-- 가정 내 자본주의 — Supabase 백엔드 (새 Supabase 프로젝트용 전체 스키마)
--
-- 사용법: Supabase Dashboard > SQL Editor 에 통째로 붙여넣고 Run (빈 프로젝트에서 한 번만).
--
-- 구조 요약
--  * 모든 테이블은 RLS 로 잠겨 있고(정책 없음), 앱은 아래 RPC 함수로만 접근합니다.
--  * 기기마다 '열쇠'(48자리 16진수)를 갖고, 서버에는 SHA-256 해시만 저장합니다.
--  * 열쇠에는 역할(parent / child)이 있어서, 자녀 기기는 승인·잔고 조정 같은 부모 기능을 호출할 수 없습니다.
--  * 날짜 계산은 서버가 한국 시간(Asia/Seoul) 기준으로 합니다.
--  * 고정지출은 자동 차감하지 않고, 부모가 날짜별로 '적용'합니다(외박·외식·주말 학원 제외 선택 가능).

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- ===== 테이블 =====
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default '우리 가족',
  balance integer not null default 0,
  academy_monthly integer not null default 300000 check (academy_monthly >= 0),
  bankrupt_limit integer not null default -30000 check (bankrupt_limit <= 0),
  start_date date not null,
  created_at timestamptz not null default now()
);

create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  role text not null check (role in ('parent','child')),
  hash text not null unique,
  label text not null default '',
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index credentials_family_idx on public.credentials(family_id);

create table public.invites (
  code_hash text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  role text not null check (role in ('parent','child')),
  label text not null default '',
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
create index invites_family_idx on public.invites(family_id);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  slug text,
  kind text not null check (kind in ('fixed','optional','base','extra','spend')),
  title text not null,
  descr text not null default '',
  amount integer not null,
  survival boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  check (
    (kind in ('fixed','optional','spend') and amount <= 0)
    or (kind in ('base','extra') and amount > 0)
  )
);
create index items_family_idx on public.items(family_id);

create table public.checks (
  family_id uuid not null references public.families(id) on delete cascade,
  day date not null,
  item_id uuid not null references public.items(id) on delete cascade,
  amount integer not null,
  created_at timestamptz not null default now(),
  primary key (family_id, day, item_id)
);
create index checks_item_idx on public.checks(item_id);

create table public.missions (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  day date not null,
  title text not null,
  amount integer not null check (amount > 0),
  status text not null default 'open' check (status in ('open','wait','done')),
  created_at timestamptz not null default now()
);
create index missions_family_day_idx on public.missions(family_id, day);

create table public.requests (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  mission_id bigint references public.missions(id) on delete cascade,
  label text not null,
  amount integer not null,
  day date not null,
  status text not null default 'wait' check (status in ('wait','done','reject')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index requests_family_status_idx on public.requests(family_id, status);
create index requests_item_idx on public.requests(item_id);
create index requests_mission_idx on public.requests(mission_id);
create unique index requests_one_wait_per_item_day on public.requests(family_id, item_id, day)
  where status = 'wait' and item_id is not null;
create unique index requests_one_wait_per_mission on public.requests(mission_id)
  where status = 'wait';

create table public.txs (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  day date not null,
  label text not null,
  amount integer not null,
  balance integer not null,
  created_at timestamptz not null default now()
);
create index txs_family_idx on public.txs(family_id, id desc);

alter table public.families enable row level security;
alter table public.credentials enable row level security;
alter table public.invites enable row level security;
alter table public.items enable row level security;
alter table public.checks enable row level security;
alter table public.missions enable row level security;
alter table public.requests enable row level security;
alter table public.txs enable row level security;
revoke all on public.families, public.credentials, public.invites, public.items,
  public.checks, public.missions, public.requests, public.txs from anon, authenticated;

-- ===== 내부 헬퍼 (private 스키마: 앱에서 직접 호출 불가) =====
create or replace function private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;

create or replace function private.status_of(p_bal integer, p_lim integer) returns text
language sql immutable set search_path = '' as $$
  select case when p_bal <= p_lim then 'bankrupt' when p_bal < 0 then 'blocked' else 'ok' end
$$;

create or replace function private.check_secret(p_secret text, p_need text default null)
returns table (o_family uuid, o_role text, o_cred uuid)
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if p_secret is null or length(p_secret) < 20 then raise exception 'unauthorized'; end if;
  select c.family_id, c.role, c.id into r
    from public.credentials c
   where c.hash = encode(extensions.digest(p_secret, 'sha256'), 'hex') and not c.revoked;
  if not found then raise exception 'unauthorized'; end if;
  if p_need is not null and r.role <> p_need then raise exception 'forbidden'; end if;
  o_family := r.family_id; o_role := r.role; o_cred := r.id;
  return next;
end $$;

-- 날짜 고르기: strict=true 면 운영 시작일~오늘 밖은 거부, false 면 범위 안으로 맞춰서 보여줌
create or replace function private.pick_day(p_family uuid, p_day date, p_strict boolean) returns date
language plpgsql stable security definer set search_path = '' as $$
declare s date; t date := private.today(); d date;
begin
  select start_date into s from public.families where id = p_family;
  d := coalesce(p_day, t);
  if p_strict then
    if d > t or d < s then raise exception 'invalid_day'; end if;
    return d;
  end if;
  return least(greatest(d, s), t);
end $$;

create or replace function private.add_tx(p_family uuid, p_label text, p_amt integer, p_day date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare nb integer;
begin
  update public.families set balance = balance + p_amt where id = p_family returning balance into nb;
  insert into public.txs (family_id, day, label, amount, balance)
    values (p_family, coalesce(p_day, private.today()), p_label, p_amt, nb);
  return nb;
end $$;

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

revoke execute on all functions in schema private from public, anon, authenticated;

-- ===== 앱이 호출하는 RPC (p_day: 화면에서 보고 있는 날짜, 비우면 오늘) =====
create or replace function public.create_family(
  p_name text default '우리 가족', p_academy integer default 300000,
  p_opening integer default 0, p_start date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare fid uuid; sec text; t date := private.today(); s date; acad integer;
begin
  if (select count(*) from public.families where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'busy';
  end if;
  acad := greatest(coalesce(p_academy, 0), 0);
  if acad > 10000000 or coalesce(p_opening, 0) not between -10000000 and 10000000 then
    raise exception 'invalid';
  end if;
  s := least(coalesce(p_start, t), t);
  if s < t - 366 then raise exception 'invalid'; end if;
  insert into public.families (name, academy_monthly, start_date)
    values (left(coalesce(nullif(trim(p_name), ''), '우리 가족'), 30), acad, s)
    returning id into fid;
  sec := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.credentials (family_id, role, hash, label)
    values (fid, 'parent', encode(extensions.digest(sec, 'sha256'), 'hex'), '부모 기기');
  insert into public.items (family_id, slug, kind, title, descr, amount, survival, sort) values
    (fid, 'rent',    'fixed',    '숙박비 (잠자리·방 제공)',   '외박·수련회면 제외',             -3000,  true,  10),
    (fid, 'food',    'fixed',    '식비',                      '끼니당 1,000P · 외식한 끼는 제외', -2000,  true,  20),
    (fid, 'util',    'fixed',    '수광열비 (샤워·전기·온수)', '매일 기본',                      -1000,  false, 30),
    (fid, 'shot',    'fixed',    '키 크는 주사 (건강관리)',   '매일 고정',                      -10000, true,  40),
    (fid, 'phone',   'fixed',    '핸드폰 기본 유지비',        '매일 고정',                      -1000,  false, 50),
    (fid, 'pad',     'optional', '패드 사용료 (선택)',        '쓴 날만 자녀가 직접 체크',       -2000,  false, 60),
    (fid, 'academy', 'fixed',    '학원비 (일할)',             '월 학원비 ÷ 30 · 주말 쉬면 제외', -round(acad / 30.0)::integer, false, 70),
    (fid, 'school',  'base',     '공부하기 (학교·숙제·주말 공부 포함)', '했으면 체크',          10000,  false, 80),
    (fid, 'room',    'base',     '내 방 스스로 정리하기',     '침대·책상·바닥 정리',            10000,  false, 90),
    (fid, 'dish',    'extra',    '설거지 완벽 클리어',        '',                               10000,  false, 100),
    (fid, 'trash',   'extra',    '쓰레기 비우기·분리수거',    '',                               10000,  false, 110),
    (fid, 'laundry', 'extra',    '빨래 + 건조대 널기',        '',                               10000,  false, 120),
    (fid, 'dog',     'extra',    '강아지 케어 (밥·배변·산책)', '',                              5000,   false, 130),
    (fid, 'grade',   'extra',    '성적 향상 / 목표 달성 보너스', '',                            10000,  false, 140),
    (fid, 'pc1',     'spend',    'PC 1시간',                  '',                               -10000, false, 150),
    (fid, 'pc2',     'spend',    'PC 2시간',                  '',                               -20000, false, 160),
    (fid, 'cash',    'spend',    '용돈 환전 (현금 5,000원 받아가기)', '',                       -10000, false, 170);
  if coalesce(p_opening, 0) <> 0 then
    update public.families set balance = p_opening where id = fid;
    insert into public.txs (family_id, day, label, amount, balance)
      values (fid, t, '이전 앱 잔고 이어받기', p_opening, p_opening);
  end if;
  return jsonb_build_object('secret', sec);
end $$;

create or replace function public.redeem_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inv public.invites%rowtype; sec text; h text; norm text;
begin
  norm := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')); -- 소문자·공백·하이픈 허용
  if length(norm) <> 8 then raise exception 'invalid_invite'; end if;
  h := encode(extensions.digest(norm, 'sha256'), 'hex');
  select * into inv from public.invites where code_hash = h for update;
  if not found or inv.used or inv.expires_at < now() then raise exception 'invalid_invite'; end if;
  if (select count(*) from public.credentials where family_id = inv.family_id and not revoked) >= 10 then
    raise exception 'busy';
  end if;
  update public.invites set used = true where code_hash = h;
  sec := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.credentials (family_id, role, hash, label)
    values (inv.family_id, inv.role, encode(extensions.digest(sec, 'sha256'), 'hex'), inv.label);
  return jsonb_build_object('secret', sec, 'role', inv.role);
end $$;

create or replace function public.get_state(p_secret text, p_day date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from private.check_secret(p_secret);
  return private.build_state(a.o_family, a.o_role, a.o_cred, p_day);
end $$;

-- 자녀: 앞가림(base) 체크 / 패드(optional) 사용 체크 — 지난 날짜도 가능
create or replace function public.toggle_item(p_secret text, p_item uuid, p_on boolean, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a record; f public.families%rowtype; it public.items%rowtype; ex public.checks%rowtype;
  d date; st text;
begin
  select * into a from private.check_secret(p_secret, 'child');
  select * into f from public.families where id = a.o_family for update;
  d := private.pick_day(f.id, p_day, true);
  select * into it from public.items
   where id = p_item and family_id = f.id and active and kind in ('base', 'optional');
  if not found then raise exception 'invalid'; end if;
  st := private.status_of(f.balance, f.bankrupt_limit);
  select * into ex from public.checks where family_id = f.id and day = d and item_id = it.id;
  if p_on and not found then
    if it.kind = 'base' and st = 'bankrupt' then raise exception 'bankrupt'; end if;
    if it.kind = 'optional' and st <> 'ok' then raise exception 'blocked'; end if;
    insert into public.checks (family_id, day, item_id, amount) values (f.id, d, it.id, it.amount);
    perform private.add_tx(f.id, it.title, it.amount, d);
  elsif not p_on and found then
    if it.kind = 'base' and st = 'bankrupt' then raise exception 'bankrupt'; end if;
    delete from public.checks where family_id = f.id and day = d and item_id = it.id;
    perform private.add_tx(f.id, it.title || ' (취소)', -ex.amount, d);
  end if;
  return private.build_state(a.o_family, a.o_role, a.o_cred, d);
end $$;

-- 자녀: 심부름 신청 — 지난 날짜도 가능
create or replace function public.request_extra(p_secret text, p_item uuid, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; f public.families%rowtype; it public.items%rowtype; d date;
begin
  select * into a from private.check_secret(p_secret, 'child');
  select * into f from public.families where id = a.o_family for update;
  d := private.pick_day(f.id, p_day, true);
  select * into it from public.items where id = p_item and family_id = f.id and active and kind = 'extra';
  if not found then raise exception 'invalid'; end if;
  if private.status_of(f.balance, f.bankrupt_limit) = 'bankrupt' then raise exception 'bankrupt'; end if;
  if exists (select 1 from public.checks where family_id = f.id and day = d and item_id = it.id) then
    raise exception 'duplicate';
  end if;
  insert into public.requests (family_id, item_id, label, amount, day)
    values (f.id, it.id, it.title, it.amount, d) on conflict do nothing;
  return private.build_state(a.o_family, a.o_role, a.o_cred, d);
end $$;

-- 자녀: 미션 완료 신청
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
  insert into public.requests (family_id, mission_id, label, amount, day)
    values (f.id, m.id, '미션: ' || m.title, m.amount, m.day);
  return private.build_state(a.o_family, a.o_role, a.o_cred, p_day);
end $$;

-- 자녀: 포인트 쓰기 (PC / 환전) — 항상 오늘 기준
create or replace function public.consume(p_secret text, p_item uuid, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; f public.families%rowtype; it public.items%rowtype;
begin
  select * into a from private.check_secret(p_secret, 'child');
  select * into f from public.families where id = a.o_family for update;
  select * into it from public.items where id = p_item and family_id = f.id and active and kind = 'spend';
  if not found then raise exception 'invalid'; end if;
  if private.status_of(f.balance, f.bankrupt_limit) <> 'ok' then raise exception 'blocked'; end if;
  if f.balance < -it.amount then raise exception 'insufficient'; end if;
  perform private.add_tx(f.id, it.title, it.amount);
  return private.build_state(a.o_family, a.o_role, a.o_cred, p_day);
end $$;

-- 부모: 승인 / 거절 (대기 중인 요청만, 중복 승인 불가)
create or replace function public.decide_request(p_secret text, p_request bigint, p_ok boolean, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; r public.requests%rowtype;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  select * into r from public.requests
   where id = p_request and family_id = a.o_family and status = 'wait' for update;
  if not found then raise exception 'invalid'; end if;
  if p_ok then
    update public.requests set status = 'done', decided_at = now() where id = r.id;
    if r.mission_id is not null then
      update public.missions set status = 'done' where id = r.mission_id;
    elsif r.item_id is not null then
      insert into public.checks (family_id, day, item_id, amount)
        values (a.o_family, r.day, r.item_id, r.amount) on conflict do nothing;
    end if;
    perform private.add_tx(a.o_family, r.label, r.amount, r.day);
  else
    update public.requests set status = 'reject', decided_at = now() where id = r.id;
    if r.mission_id is not null then
      update public.missions set status = 'open' where id = r.mission_id;
    end if;
  end if;
  return private.build_state(a.o_family, a.o_role, a.o_cred, p_day);
end $$;

-- 부모: 해당 날짜 생활비(고정지출) 적용.
--   p_skip   = 제외할 항목 id 배열
--   p_meals  = 식비 끼니 수 (0~3)
--   p_amounts = 항목 id → 차감액(원, 양수) 직접 지정. 지정한 항목은 규칙 계산 대신 이 금액으로 차감
drop function if exists public.apply_fixed(text, date, jsonb, integer); -- 이전 시그니처(업그레이드용, 새로 만들 땐 무시됨)
create or replace function public.apply_fixed(
  p_secret text, p_day date default null, p_skip jsonb default '[]'::jsonb, p_meals integer default 2,
  p_amounts jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a record; f public.families%rowtype; d date; it record;
  amt integer; lbl text; skip uuid[]; per integer; ov jsonb; ovn numeric;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  select * into f from public.families where id = a.o_family for update;
  d := private.pick_day(f.id, p_day, true);
  if p_meals is null or p_meals not between 0 and 3 then raise exception 'invalid'; end if;
  ov := coalesce(p_amounts, '{}'::jsonb);
  if jsonb_typeof(ov) <> 'object' then raise exception 'invalid'; end if;
  skip := coalesce(array(select jsonb_array_elements_text(coalesce(p_skip, '[]'::jsonb))::uuid), '{}');
  for it in select * from public.items
             where family_id = f.id and kind = 'fixed' and active
             order by sort, created_at loop
    continue when it.id = any(skip);
    if ov ? it.id::text then
      if jsonb_typeof(ov -> it.id::text) <> 'number' then raise exception 'invalid'; end if;
      ovn := (ov ->> it.id::text)::numeric;
      if ovn < 0 or ovn > 10000000 or ovn <> trunc(ovn) then raise exception 'invalid'; end if;
      amt := -ovn::integer;
      lbl := split_part(it.title, ' (', 1) || ' (직접 입력 ' || to_char(ovn::integer, 'FM999,999,999') || 'P)';
    elsif it.slug = 'academy' then
      amt := -round(f.academy_monthly / 30.0)::integer;
      lbl := it.title || ' (' || to_char(amt, 'FM999,999,999') || 'P)';
    elsif it.slug = 'food' then
      per := round(abs(it.amount) / 2.0)::integer;
      amt := -p_meals * per;
      lbl := it.title || ' (' || p_meals || '끼)';
    else
      amt := it.amount;
      lbl := it.title;
    end if;
    insert into public.checks (family_id, day, item_id, amount)
      values (f.id, d, it.id, amt) on conflict do nothing;
    if found and amt <> 0 then
      perform private.add_tx(f.id, lbl, amt, d);
    end if;
  end loop;
  return private.build_state(a.o_family, a.o_role, a.o_cred, d);
end $$;

-- 부모: 미션 내주기 / 삭제
create or replace function public.create_mission(p_secret text, p_title text, p_amount integer, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; d date; ttl text;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  d := private.pick_day(a.o_family, p_day, true);
  ttl := left(trim(coalesce(p_title, '')), 40);
  if ttl = '' or p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'invalid'; end if;
  insert into public.missions (family_id, day, title, amount) values (a.o_family, d, ttl, p_amount);
  return private.build_state(a.o_family, a.o_role, a.o_cred, d);
end $$;

create or replace function public.delete_mission(p_secret text, p_mission bigint, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  delete from public.missions where id = p_mission and family_id = a.o_family;
  if not found then raise exception 'invalid'; end if;
  return private.build_state(a.o_family, a.o_role, a.o_cred, p_day);
end $$;

-- 부모: 벌금 / 보너스 (오늘 날짜로 기록)
create or replace function public.adjust(p_secret text, p_amount integer, p_reason text default '', p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000000 then raise exception 'invalid'; end if;
  perform private.add_tx(a.o_family,
    '[관리자] ' || left(coalesce(nullif(trim(p_reason), ''), '수동 조정'), 60), p_amount);
  return private.build_state(a.o_family, a.o_role, a.o_cred, p_day);
end $$;

-- 부모: 월 학원비
create or replace function public.set_academy(p_secret text, p_monthly integer, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  if p_monthly is null or p_monthly < 0 or p_monthly > 10000000 then raise exception 'invalid'; end if;
  update public.families set academy_monthly = p_monthly where id = a.o_family;
  update public.items set amount = -round(p_monthly / 30.0)::integer
   where family_id = a.o_family and slug = 'academy';
  return private.build_state(a.o_family, a.o_role, a.o_cred, p_day);
end $$;

-- 부모: 항목 추가 / 수정 (삭제 대신 사용 해제)
create or replace function public.upsert_item(
  p_secret text, p_item uuid, p_kind text, p_title text, p_descr text,
  p_amount integer, p_active boolean, p_survival boolean default false, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; it public.items%rowtype; ttl text; amt integer;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  ttl := left(trim(coalesce(p_title, '')), 40);
  if ttl = '' then raise exception 'invalid'; end if;
  if p_item is null then
    if p_kind is null or p_kind not in ('fixed', 'optional', 'base', 'extra', 'spend') then
      raise exception 'invalid';
    end if;
    if p_amount is null or p_amount = 0 or abs(p_amount) > 10000000 then raise exception 'invalid'; end if;
    amt := case when p_kind in ('base', 'extra') then abs(p_amount) else -abs(p_amount) end;
    insert into public.items (family_id, kind, title, descr, amount, survival, active, sort)
      values (a.o_family, p_kind, ttl, left(coalesce(p_descr, ''), 80), amt,
              coalesce(p_survival, false), coalesce(p_active, true),
              coalesce((select max(sort) from public.items where family_id = a.o_family), 0) + 10);
  else
    select * into it from public.items where id = p_item and family_id = a.o_family;
    if not found then raise exception 'invalid'; end if;
    if it.slug = 'academy' then
      amt := it.amount;
    else
      if p_amount is null or p_amount = 0 or abs(p_amount) > 10000000 then raise exception 'invalid'; end if;
      amt := case when it.kind in ('base', 'extra') then abs(p_amount) else -abs(p_amount) end;
    end if;
    update public.items
       set title = ttl, descr = left(coalesce(p_descr, it.descr), 80), amount = amt,
           active = coalesce(p_active, it.active), survival = coalesce(p_survival, it.survival)
     where id = it.id;
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
  return private.build_state(a.o_family, a.o_role, a.o_cred, d);
end $$;

-- 부모: 전체 초기화 (잔고·내역·체크·신청·미션 삭제, 항목·학원비 설정은 유지)
create or replace function public.reset_all(p_secret text, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  delete from public.txs where family_id = a.o_family;
  delete from public.checks where family_id = a.o_family;
  delete from public.requests where family_id = a.o_family;
  delete from public.missions where family_id = a.o_family;
  update public.families set balance = 0 where id = a.o_family;
  return private.build_state(a.o_family, a.o_role, a.o_cred, p_day);
end $$;

-- 기기 연결 관리
create or replace function public.issue_invite(p_secret text, p_role text, p_label text default '') returns text
language plpgsql security definer set search_path = '' as $$
declare a record; code text := ''; rb bytea; i integer;
  alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 헷갈리는 I L O 0 1 제외, 31자
begin
  select * into a from private.check_secret(p_secret, 'parent');
  if p_role is null or p_role not in ('parent', 'child') then raise exception 'invalid'; end if;
  if (select count(*) from public.invites
       where family_id = a.o_family and not used and expires_at > now()) >= 10 then
    raise exception 'busy';
  end if;
  rb := extensions.gen_random_bytes(8);
  for i in 0..7 loop
    code := code || substr(alpha, 1 + (get_byte(rb, i) % 31), 1);
  end loop;
  insert into public.invites (code_hash, family_id, role, label, expires_at)
    values (encode(extensions.digest(code, 'sha256'), 'hex'), a.o_family, p_role,
            left(coalesce(nullif(trim(p_label), ''), case when p_role = 'child' then '자녀 기기' else '부모 기기' end), 30),
            now() + interval '30 minutes');
  return code;
end $$;

create or replace function public.list_credentials(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'role', c.role, 'label', c.label,
                                        'revoked', c.revoked, 'created_at', c.created_at,
                                        'last_seen_at', c.last_seen_at, 'is_me', c.id = a.o_cred)
                     order by c.created_at)
      from public.credentials c where c.family_id = a.o_family), '[]'::jsonb);
end $$;

create or replace function public.revoke_credential(p_secret text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a record; c public.credentials%rowtype;
begin
  select * into a from private.check_secret(p_secret, 'parent');
  select * into c from public.credentials where id = p_id and family_id = a.o_family;
  if not found then raise exception 'invalid'; end if;
  if c.id = a.o_cred then raise exception 'last_parent'; end if;
  update public.credentials set revoked = true where id = c.id;
end $$;

create or replace function public.sign_out(p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from private.check_secret(p_secret);
  if a.o_role = 'parent' and (select count(*) from public.credentials
       where family_id = a.o_family and role = 'parent' and not revoked) <= 1 then
    raise exception 'last_parent';
  end if;
  update public.credentials set revoked = true where id = a.o_cred;
end $$;

-- ===== 권한: 위 RPC 만 공개 키(anon)로 호출 가능 =====
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.create_family(text, integer, integer, date), public.redeem_invite(text),
  public.get_state(text, date), public.toggle_item(text, uuid, boolean, date),
  public.request_extra(text, uuid, date), public.request_mission(text, bigint, date),
  public.consume(text, uuid, date), public.decide_request(text, bigint, boolean, date),
  public.apply_fixed(text, date, jsonb, integer, jsonb), public.create_mission(text, text, integer, date),
  public.delete_mission(text, bigint, date), public.adjust(text, integer, text, date),
  public.set_academy(text, integer, date),
  public.upsert_item(text, uuid, text, text, text, integer, boolean, boolean, date),
  public.reset_day(text, date), public.reset_all(text, date),
  public.issue_invite(text, text, text), public.list_credentials(text),
  public.revoke_credential(text, uuid), public.sign_out(text)
to anon;
