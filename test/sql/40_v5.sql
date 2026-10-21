-- v5: 반복 미션 — 승인돼도 완료되지 않고 계속 열려 있어, 같은 날에도 여러 번 신청·승인할 수 있다
do $$
declare
  p text; c text; fid uuid; t date := (now() at time zone 'Asia/Seoul')::date; y date := (now() at time zone 'Asia/Seoul')::date - 1;
  s jsonb; m1 bigint; m2 bigint; rid bigint; b int;
begin
  p := (public.create_family('v5', 300000, 0, t - 3))->>'secret';
  select family_id into fid from public.credentials where hash = encode(extensions.digest(p,'sha256'),'hex');
  c := (public.redeem_invite(public.issue_invite(p, 'child', '아들')))->>'secret';

  -- r1: 반복 미션 만들기 (일반 미션은 그대로 한 번만)
  s := public.create_mission(p, '콩이 똥 치우기', 3000, y, true);
  m1 := (select id from public.missions where family_id = fid and title = '콩이 똥 치우기');
  s := public.create_mission(p, '베란다 대청소', 20000);
  m2 := (select id from public.missions where family_id = fid and title = '베란다 대청소');
  assert (select repeatable from public.missions where id = m1) and not (select repeatable from public.missions where id = m2), 'r1 repeatable 저장';
  s := public.get_state(c);
  assert (select (x->>'repeatable')::boolean from jsonb_array_elements(s->'missions') x where (x->>'id')::bigint = m1), 'r1b 상태에 repeatable 포함';

  -- r2: 승인해도 계속 열려 있고, 오늘 날짜로 기록되며, 횟수가 쌓인다
  for i in 1..3 loop
    s := public.request_mission(c, m1);
    assert (select x->>'status' from jsonb_array_elements(s->'missions') x where (x->>'id')::bigint = m1) = 'wait', 'r2 신청 → wait';
    begin perform public.request_mission(c, m1); assert false, 'r2b 대기 중 중복 신청'; exception when others then assert sqlerrm = 'duplicate', 'r2b '||sqlerrm; end;
    rid := (select id from public.requests where mission_id = m1 and status = 'wait');
    s := public.decide_request(p, rid, true);
    assert (select x->>'status' from jsonb_array_elements(s->'missions') x where (x->>'id')::bigint = m1) = 'open', 'r2c 승인 후에도 open';
  end loop;
  assert (s->'family'->>'balance')::int = 9000, 'r2d 3번 승인 +9000: '||(s->'family'->>'balance');
  assert (s->'mission_done'->>m1::text)::int = 3, 'r2e 오늘 완료 횟수 3';
  assert (select count(*) from public.txs where family_id = fid and day = t and label = '미션: 콩이 똥 치우기') = 3, 'r2f 내역은 오늘 날짜';
  assert not (public.get_state(c, y)->'mission_done' ? m1::text), 'r2g 어제 보기에는 오늘 횟수가 안 섞임';

  -- r3: 거절하면 다시 open, 일반 미션은 승인하면 done
  rid := (public.request_mission(c, m1)->'pending'->0->>'id')::bigint;
  s := public.decide_request(p, rid, false);
  assert (select x->>'status' from jsonb_array_elements(s->'missions') x where (x->>'id')::bigint = m1) = 'open' and (s->'family'->>'balance')::int = 9000, 'r3 거절: open, 잔고 그대로';
  s := public.request_mission(c, m2);
  s := public.decide_request(p, (s->'pending'->0->>'id')::bigint, true);
  assert (select x->>'status' from jsonb_array_elements(s->'missions') x where (x->>'id')::bigint = m2) = 'done', 'r3b 일반 미션은 done';
  begin perform public.request_mission(c, m2); assert false, 'r3c 완료된 일반 미션 재신청'; exception when others then assert sqlerrm = 'duplicate', 'r3c '||sqlerrm; end;

  -- r4: 옛 4개 인자 호출도 되고(일반 미션), 반복 미션은 삭제 가능
  s := public.create_mission(p, '옛 방식', 1000, null);
  assert (select not repeatable from public.missions where family_id = fid and title = '옛 방식'), 'r4 옛 호출은 일반 미션';
  s := public.delete_mission(p, m1);
  assert not exists (select 1 from public.missions where id = m1), 'r4b 삭제';

  raise exception 'V5_OK';
end $$;
