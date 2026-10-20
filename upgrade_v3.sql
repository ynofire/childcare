-- 가정 내 자본주의 — 서버 업그레이드 v3 (기존 v2 DB 위에 그대로 실행, 여러 번 실행해도 안전)
-- 바뀌는 것: ① 미션은 날짜와 상관없이(미완료이거나 최근 3일 이내 완료) 보임 ② 최근 승인/거절 목록(recent) 추가
--          ③ 연결 코드가 8글자(헷갈리는 글자 제외, 30분·1회용), 입력은 소문자·공백·하이픈 섞어도 됨
-- 삭제 구문 없음(create or replace 만). 실행 권한(anon 만 호출 가능)은 그대로 유지됩니다.

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
