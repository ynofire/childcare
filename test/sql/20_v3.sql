-- 서버 v3: 미션 날짜 무관 노출 · recent · 짧은 연결 코드
do $$
declare
  p text; c text; code text; code2 text; s jsonb; fid uuid; mid bigint; mid2 bigint; rid bigint;
  t date := (now() at time zone 'Asia/Seoul')::date;
  dish uuid; trash uuid; n int; p3 text;
begin
  p := (public.create_family('v3', 300000, 0, t - 2))->>'secret';
  select family_id into fid from public.credentials where hash = encode(extensions.digest(p,'sha256'),'hex');
  code := public.issue_invite(p, 'child', '아들폰');
  c := (public.redeem_invite(code))->>'secret';

  -- m1: 오늘 만든 미완료 미션은 며칠이 지나도 남는다
  mid := (select (public.create_mission(p, 'm1-오늘', 1000)->'missions'->0->>'id')::bigint);
  perform set_config('app.fake_today', (t + 2)::text, false);
  assert exists (select 1 from jsonb_array_elements(public.get_state(c)->'missions') x where x->>'title' = 'm1-오늘' and x->>'status' = 'open'), 'm1 며칠 뒤에도 미션이 보여야 함';
  perform set_config('app.fake_today', '', false);

  -- m2: 부모가 어제 날짜로 만든 미션이 아들의 오늘 화면(p_day null)에 보인다
  perform public.create_mission(p, 'm2-어제', 2000, t - 1);
  assert exists (select 1 from jsonb_array_elements(public.get_state(c)->'missions') x where x->>'title' = 'm2-어제'), 'm2 어제 날짜로 만든 미션이 오늘에 보여야 함';
  assert public.get_state(c)->>'day' = t::text, 'm2 아들 화면은 오늘 기준';

  -- m3: 완료된 미션은 3일 안엔 보이고 3일이 지나면 사라진다
  select (x->>'id')::bigint into mid2 from jsonb_array_elements(public.get_state(c)->'missions') x where x->>'title' = 'm2-어제';
  perform public.request_mission(c, mid2);
  rid := (public.get_state(p)->'pending'->0->>'id')::bigint;
  perform public.decide_request(p, rid, true);
  assert exists (select 1 from jsonb_array_elements(public.get_state(c)->'missions') x where x->>'id' = mid2::text and x->>'status' = 'done'), 'm3 완료 직후엔 보임';
  update public.missions set created_at = now() - interval '4 days' where id = mid2;
  assert not exists (select 1 from jsonb_array_elements(public.get_state(c)->'missions') x where x->>'id' = mid2::text), 'm3 4일 지난 완료 미션은 숨김';

  -- r1: 처리된 요청이 recent 로 내려온다 (최신순, 2일 이내)
  select id into dish from public.items where family_id = fid and slug = 'dish';
  select id into trash from public.items where family_id = fid and slug = 'trash';
  perform public.request_extra(c, dish);
  rid := (select (x->>'id')::bigint from jsonb_array_elements(public.get_state(p)->'pending') x where (x->>'item_id')::uuid = dish);
  perform public.decide_request(p, rid, true);
  update public.requests set decided_at = now() - interval '1 hour' where id = rid;
  perform public.request_extra(c, trash);
  rid := (select (x->>'id')::bigint from jsonb_array_elements(public.get_state(p)->'pending') x where (x->>'item_id')::uuid = trash);
  perform public.decide_request(p, rid, false);
  s := public.get_state(c);
  assert jsonb_array_length(s->'recent') >= 3, 'r1 recent 3건 이상(미션 승인 포함): '||jsonb_array_length(s->'recent');
  assert s->'recent'->0->>'status' = 'reject' and (s->'recent'->0->>'item_id')::uuid = trash, 'r1 최신은 거절된 심부름';
  assert exists (select 1 from jsonb_array_elements(s->'recent') x where (x->>'item_id')::uuid = dish and x->>'status' = 'done'), 'r1 승인 건 포함';
  assert (s->'recent'->0) ? 'decided_at' and (s->'recent'->0) ? 'label' and (s->'recent'->0) ? 'amount', 'r1 필드';
  update public.requests set decided_at = now() - interval '3 days' where family_id = fid and status in ('done','reject');
  assert jsonb_array_length(public.get_state(c)->'recent') = 0, 'r1 3일 지난 처리 건은 빠짐';

  -- i1: 8글자 코드, 30분 유효
  code2 := public.issue_invite(p, 'child', '두번째');
  assert code2 ~ '^[A-HJKMNP-Z2-9]{8}$', 'i1 코드 형식: '||code2;
  assert (select expires_at from public.invites where code_hash = encode(extensions.digest(code2,'sha256'),'hex'))
         between now() + interval '29 minutes' and now() + interval '31 minutes', 'i1 유효시간 30분';

  -- i2: 소문자·하이픈·공백이 섞여도 연결, 재사용·만료·잘못된 코드는 거절
  s := public.redeem_invite(' ' || lower(substr(code2,1,4)) || '-' || lower(substr(code2,5)) || ' ');
  assert s->>'role' = 'child' and length(s->>'secret') = 48, 'i2 느슨한 입력으로 연결';
  begin perform public.redeem_invite(code2); assert false, 'i2 재사용 허용됨'; exception when others then assert sqlerrm = 'invalid_invite', 'i2 재사용: '||sqlerrm; end;
  code2 := public.issue_invite(p, 'child', '만료');
  update public.invites set expires_at = now() - interval '1 minute' where code_hash = encode(extensions.digest(code2,'sha256'),'hex');
  begin perform public.redeem_invite(code2); assert false, 'i2 만료 허용됨'; exception when others then assert sqlerrm = 'invalid_invite', 'i2 만료: '||sqlerrm; end;
  begin perform public.redeem_invite('ABCDEFG'); assert false, 'i2 7글자 허용됨'; exception when others then assert sqlerrm = 'invalid_invite', 'i2 7글자: '||sqlerrm; end;
  begin perform public.redeem_invite('0000000O'); assert false, 'i2 없는 코드 허용됨'; exception when others then assert sqlerrm = 'invalid_invite', 'i2 없는 코드: '||sqlerrm; end;
  begin perform public.redeem_invite(null); assert false, 'i2 null 허용됨'; exception when others then assert sqlerrm = 'invalid_invite', 'i2 null: '||sqlerrm; end;

  -- i3: 동시 유효 코드 10개 제한
  p3 := (public.create_family('v3-busy', 300000, 0, t))->>'secret';
  for n in 1..10 loop perform public.issue_invite(p3, 'child', 'x'); end loop;
  begin perform public.issue_invite(p3, 'child', 'x'); assert false, 'i3 11번째 허용됨'; exception when others then assert sqlerrm = 'busy', 'i3 '||sqlerrm; end;

  -- g1: 권한 — anon 만 실행 가능
  assert has_function_privilege('anon', 'public.issue_invite(text,text,text)', 'execute')
     and has_function_privilege('anon', 'public.redeem_invite(text)', 'execute')
     and has_function_privilege('anon', 'public.get_state(text,date)', 'execute'), 'g1 anon 실행';
  assert not has_function_privilege('authenticated', 'public.issue_invite(text,text,text)', 'execute')
     and not has_function_privilege('authenticated', 'public.redeem_invite(text)', 'execute')
     and not has_function_privilege('authenticated', 'public.get_state(text,date)', 'execute'), 'g1 authenticated 불가';

  raise exception 'V3_OK';
end $$;
