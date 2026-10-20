-- v4: 아이가 한 일은 전부 부모 승인 후 반영 + 심부름·쓰기는 하루 여러 번
do $$
declare
  p text; c text; fid uuid; t date := (now() at time zone 'Asia/Seoul')::date; y date := (now() at time zone 'Asia/Seoul')::date - 1;
  s jsonb; school uuid; pad uuid; dish uuid; pc1 uuid; pc2 uuid; rent uuid; rid bigint; b int; i int;
begin
  p := (public.create_family('v4', 300000, 30000, t - 3))->>'secret';
  select family_id into fid from public.credentials where hash = encode(extensions.digest(p,'sha256'),'hex');
  c := (public.redeem_invite(public.issue_invite(p, 'child', '아들')))->>'secret';
  select id into school from public.items where family_id = fid and slug = 'school';
  select id into pad from public.items where family_id = fid and slug = 'pad';
  select id into dish from public.items where family_id = fid and slug = 'dish';
  select id into pc1 from public.items where family_id = fid and slug = 'pc1';
  select id into pc2 from public.items where family_id = fid and slug = 'pc2';
  select id into rent from public.items where family_id = fid and slug = 'rent';

  -- a1: 앞가림은 신청만 되고, 승인해야 반영된다 (하루 한 번)
  s := public.request_item(c, school, y);
  assert (s->'family'->>'balance')::int = 30000, 'a1 신청만으로는 잔고 불변';
  assert jsonb_array_length(s->'pending') = 1 and (s->'pending'->0->>'day') = y::text, 'a1 대기 1건(어제)';
  assert s->'checks' = '{}'::jsonb, 'a1 체크 아직 없음';
  begin perform public.request_item(c, school, y); assert false, 'a1b 중복 신청'; exception when others then assert sqlerrm = 'duplicate', 'a1b '||sqlerrm; end;
  rid := (s->'pending'->0->>'id')::bigint;
  begin perform public.decide_request(c, rid, true); assert false, 'a1c 자녀가 승인'; exception when others then assert sqlerrm = 'forbidden', 'a1c '||sqlerrm; end;
  s := public.decide_request(p, rid, true);
  assert (s->'family'->>'balance')::int = 40000, 'a1d 승인 후 +10000';
  assert (select day from public.txs where family_id = fid and label like '공부하기%') = y, 'a1d 내역 날짜 어제';
  s := public.get_state(c, y);
  assert s->'checks' ? school::text, 'a1d 어제 체크 기록';
  begin perform public.request_item(c, school, y); assert false, 'a1e 완료한 날 재신청'; exception when others then assert sqlerrm = 'duplicate', 'a1e '||sqlerrm; end;

  -- a2: 거절하면 반영 없이 다시 신청 가능
  rid := (public.request_item(c, school)->'pending'->0->>'id')::bigint;
  s := public.decide_request(p, rid, false);
  assert (s->'family'->>'balance')::int = 40000 and jsonb_array_length(s->'pending') = 0, 'a2 거절: 잔고 불변';
  s := public.request_item(c, school);
  assert jsonb_array_length(s->'pending') = 1, 'a2b 거절 뒤 다시 신청';
  perform public.decide_request(p, (s->'pending'->0->>'id')::bigint, true);
  assert (select balance from public.families where id = fid) = 50000, 'a2c 승인 +10000';

  -- a3: 패드(선택 차감)도 승인해야 차감
  s := public.request_item(c, pad);
  assert (s->'family'->>'balance')::int = 50000 and jsonb_array_length(s->'pending') = 1, 'a3 신청만으로는 차감 안 됨';
  s := public.decide_request(p, (s->'pending'->0->>'id')::bigint, true);
  assert (s->'family'->>'balance')::int = 48000, 'a3b 승인 후 -2000';
  assert s->'checks' ? pad::text, 'a3b 패드 체크 기록';
  begin perform public.request_item(c, pad); assert false, 'a3c 패드 같은 날 재신청'; exception when others then assert sqlerrm = 'duplicate', 'a3c '||sqlerrm; end;

  -- a4: 쓰기(PC)도 승인해야 차감, 여러 번 신청 가능, 대기 중인 금액까지 합쳐 모자라면 거절
  perform public.adjust(p, -28000, '조정');                        -- 잔고 20000
  s := public.request_item(c, pc1);
  s := public.request_item(c, pc1);
  assert (s->'family'->>'balance')::int = 20000 and jsonb_array_length(s->'pending') = 2, 'a4 PC 두 번 신청, 잔고 불변';
  begin perform public.request_item(c, pc1); assert false, 'a4b 대기분 합치면 모자람'; exception when others then assert sqlerrm = 'insufficient', 'a4b '||sqlerrm; end;
  begin perform public.request_item(c, pc2); assert false, 'a4c PC2 모자람'; exception when others then assert sqlerrm = 'insufficient', 'a4c '||sqlerrm; end;
  s := public.decide_request(p, (s->'pending'->1->>'id')::bigint, true);
  assert (s->'family'->>'balance')::int = 10000, 'a4d 첫 승인 -10000';
  s := public.decide_request(p, (s->'pending'->0->>'id')::bigint, true);
  assert (s->'family'->>'balance')::int = 0, 'a4e 둘째 승인 -10000';
  -- 승인 시점에 잔고가 모자라면 승인 불가(거절은 가능)
  insert into public.requests (family_id, item_id, label, amount, day) values (fid, pc2, 'PC 2시간', -20000, t) returning id into rid;
  begin perform public.decide_request(p, rid, true); assert false, 'a4f 잔고 모자란데 승인됨'; exception when others then assert sqlerrm = 'insufficient', 'a4f '||sqlerrm; end;
  s := public.decide_request(p, rid, false);
  assert (s->'family'->>'balance')::int = 0, 'a4g 거절은 가능';
  -- 쓰기 신청은 항상 오늘 기준
  perform public.adjust(p, 30000, '보너스');
  s := public.request_item(c, pc1, y);
  assert (s->'pending'->0->>'day') = t::text, 'a4h 쓰기는 오늘로 기록';
  perform public.decide_request(p, (s->'pending'->0->>'id')::bigint, false);

  -- b1: 심부름은 같은 날 여러 번 신청·승인
  b := (select balance from public.families where id = fid);
  s := public.request_item(c, dish);
  s := public.request_item(c, dish);
  s := public.request_item(c, dish);
  assert jsonb_array_length(s->'pending') = 3, 'b1 같은 날 3번 신청';
  perform public.decide_request(p, (s->'pending'->2->>'id')::bigint, true);
  s := public.decide_request(p, (s->'pending'->1->>'id')::bigint, true);
  s := public.decide_request(p, (s->'pending'->0->>'id')::bigint, false);
  assert (s->'family'->>'balance')::int = b + 20000, 'b1b 두 번 승인(+20000), 한 번 거절';
  assert (s->'done_counts'->>dish::text)::int = 2, 'b1c 오늘 완료 횟수 2: '||(s->'done_counts');
  assert not (s->'checks' ? dish::text), 'b1d 심부름은 체크 칸을 쓰지 않음';
  assert (select count(*) from public.txs where family_id = fid and label = '설거지 완벽 클리어') = 2, 'b1e 내역 2건';
  -- 대기 한도(5건)
  for i in 1..5 loop perform public.request_item(c, dish); end loop;
  begin perform public.request_item(c, dish); assert false, 'b1f 대기 6건째 허용됨'; exception when others then assert sqlerrm = 'too_many', 'b1f '||sqlerrm; end;
  for rid in select id from public.requests where family_id = fid and status = 'wait' loop perform public.decide_request(p, rid, false); end loop;

  -- b2: 옛 이름(request_extra)도 같은 규칙
  s := public.request_extra(c, dish);
  s := public.request_extra(c, dish);
  assert jsonb_array_length(s->'pending') = 2, 'b2 request_extra 도 반복 가능';
  for rid in select id from public.requests where family_id = fid and status = 'wait' loop perform public.decide_request(p, rid, false); end loop;

  -- b3: 날짜 초기화는 그날 승인된 심부름도 되돌린다
  b := (select balance from public.families where id = fid);
  s := public.reset_day(p, t);
  assert not (s->'done_counts' ? dish::text), 'b3 심부름 완료 횟수 초기화';
  -- 오늘 승인된 것: 설거지 2번(+20000), 공부(+10000), 패드(-2000) → 모두 되돌려 -28000
  assert (s->'family'->>'balance')::int = b - 28000, 'b3 되돌림 후 잔고 '||(b - 28000)||' 실제 '||(s->'family'->>'balance');
  assert not exists (select 1 from public.requests where family_id = fid and day = t and status = 'done' and item_id = dish), 'b3 승인된 심부름 기록 삭제';

  -- c1: 옛 앱 호출은 승인 없이 반영되지 않도록 막힘
  begin perform public.toggle_item(c, school, true, y); assert false, 'c1 toggle_item 허용됨'; exception when others then assert sqlerrm = 'update_required', 'c1 '||sqlerrm; end;
  begin perform public.consume(c, pc1); assert false, 'c1b consume 허용됨'; exception when others then assert sqlerrm = 'update_required', 'c1b '||sqlerrm; end;

  -- d1: 권한·대상 검사
  begin perform public.request_item(p, school); assert false, 'd1 부모가 신청'; exception when others then assert sqlerrm = 'forbidden', 'd1 '||sqlerrm; end;
  begin perform public.request_item(c, rent); assert false, 'd1b 고정지출 신청'; exception when others then assert sqlerrm = 'invalid', 'd1b '||sqlerrm; end;
  update public.items set active = false where id = dish;
  begin perform public.request_item(c, dish); assert false, 'd1c 해제 항목'; exception when others then assert sqlerrm = 'invalid', 'd1c '||sqlerrm; end;
  begin perform public.request_item(c, school, t + 1); assert false, 'd1d 미래 날짜'; exception when others then assert sqlerrm = 'invalid_day', 'd1d '||sqlerrm; end;

  -- e1: 마이너스·파산 규칙은 신청 시점에 적용
  perform public.adjust(p, -(select balance from public.families where id = fid) - 5000, '마이너스');
  begin perform public.request_item(c, pad, y); assert false, 'e1 마이너스에서 패드'; exception when others then assert sqlerrm = 'blocked', 'e1 '||sqlerrm; end;
  begin perform public.request_item(c, pc1); assert false, 'e1b 마이너스에서 쓰기'; exception when others then assert sqlerrm = 'blocked', 'e1b '||sqlerrm; end;
  s := public.request_item(c, school, t - 2);
  assert jsonb_array_length(s->'pending') = 1, 'e1c 마이너스여도 앞가림 신청은 가능';
  perform public.adjust(p, -300000, '파산');
  begin perform public.request_item(c, school, t - 1); assert false, 'e1d 파산에서 신청'; exception when others then assert sqlerrm = 'bankrupt', 'e1d '||sqlerrm; end;

  raise exception 'V4_OK';
end $$;
