do $$
declare
  p text; c text; code text; s jsonb; fid uuid; t date := (now() at time zone 'Asia/Seoul')::date; y date := (now() at time zone 'Asia/Seoul')::date - 1;
  iid uuid; rid bigint; mid bigint; b int; n int; items jsonb; errs text;
  procedure_ok int := 0;
  function_dummy int;
begin
  -- 1. 가족 생성: 자동 차감 없음, 시작일 지정
  p := (public.create_family('테스트', 300000, 0, t - 2))->>'secret';
  select family_id into fid from public.credentials where hash = encode(extensions.digest(p,'sha256'),'hex');
  s := public.get_state(p);
  assert (s->'family'->>'balance')::int = 0, '01 balance 0';
  assert jsonb_array_length(s->'txs') = 0, '01 자동 차감 없음(내역 0)';
  assert s->>'day' = t::text and s->>'start_date' = (t-2)::text, '01 day/start_date';
  assert jsonb_array_length(s->'items') = 17, '01 items 17';
  assert (s->'checks') = '{}'::jsonb, '01 checks 비어있음';
  procedure_ok := procedure_ok + 1;

  -- 2. 초대/자녀 열쇠
  code := public.issue_invite(p,'child','아들폰');
  c := (public.redeem_invite(code))->>'secret';
  begin perform public.redeem_invite(code); assert false, '02 초대 재사용이 막히지 않음'; exception when others then assert sqlerrm = 'invalid_invite', '02 '||sqlerrm; end;
  assert public.get_state(c)->>'role' = 'child', '02 role';

  -- 3. 생활비 적용: 숙박비 제외 + 식비 1끼 (오늘)
  select jsonb_agg(id) into items from public.items where family_id=fid and slug='rent';
  s := public.apply_fixed(p, null, items, 1);
  assert (s->'family'->>'balance')::int = -23000, '03 balance -23000 실제: '||(s->'family'->>'balance');
  assert jsonb_array_length(s->'txs') = 5, '03 txs 5';
  assert (select count(*) from jsonb_object_keys(s->'checks')) = 5, '03 checks 5';
  assert exists (select 1 from jsonb_array_elements(s->'txs') x where x->>'label' = '식비 (1끼)' and (x->>'amount')::int = -1000), '03 식비 1끼 라벨/금액';
  assert exists (select 1 from jsonb_array_elements(s->'txs') x where (x->>'label') like '학원비 (%' and (x->>'amount')::int = -10000), '03 학원비 일할 -10000';

  -- 4. 같은 날 다시 적용 → 이미 적용된 건 건너뛰고 숙박비만 추가
  s := public.apply_fixed(p, null, '[]'::jsonb, 2);
  assert (s->'family'->>'balance')::int = -26000, '04 balance -26000 실제: '||(s->'family'->>'balance');
  s := public.apply_fixed(p, null, '[]'::jsonb, 2);
  assert (s->'family'->>'balance')::int = -26000, '04b 멱등성(재호출해도 그대로)';
  assert (select count(*) from jsonb_object_keys(s->'checks')) = 6, '04 checks 6';

  -- 5. 어제 적용, 외식(0끼): 식비 체크는 0원으로 남고 내역은 안 생김
  s := public.apply_fixed(p, y, '[]'::jsonb, 0);
  assert (s->'family'->>'balance')::int = -51000, '05 balance -51000 실제: '||(s->'family'->>'balance');
  assert s->>'day' = y::text, '05 보고 있는 날짜 어제';
  assert (s->'checks'->>(select id::text from public.items where family_id=fid and slug='food'))::int = 0, '05 식비 0원 체크 기록';
  assert jsonb_array_length(s->'txs') = 11, '05 txs 11 실제: '||jsonb_array_length(s->'txs');
  assert (select day from public.txs where family_id=fid and label='숙박비 (잠자리·방 제공)' order by id desc limit 1) = y, '05 내역 날짜가 어제';
  assert (s->>'status') = 'bankrupt', '05 파산 상태';

  -- 6. 날짜 범위
  begin perform public.apply_fixed(p, t+1, '[]'::jsonb, 2); assert false, '06 미래 날짜 허용됨'; exception when others then assert sqlerrm = 'invalid_day', '06 '||sqlerrm; end;
  begin perform public.apply_fixed(p, t-3, '[]'::jsonb, 2); assert false, '06 시작일 이전 허용됨'; exception when others then assert sqlerrm = 'invalid_day', '06b '||sqlerrm; end;
  begin perform public.apply_fixed(p, null, '[]'::jsonb, 9); assert false, '06 끼니 9 허용됨'; exception when others then assert sqlerrm = 'invalid', '06c '||sqlerrm; end;
  assert public.get_state(p, t+10)->>'day' = t::text, '06 보기용 미래 날짜는 오늘로 맞춤';
  assert public.get_state(p, t-30)->>'day' = (t-2)::text, '06 보기용 과거 날짜는 시작일로 맞춤';

  -- 7. 파산 상태 규칙 + 보너스로 복구
  select id into iid from public.items where family_id=fid and slug='school';
  begin perform public.request_item(c, iid, y); assert false, '07 파산인데 앞가림 신청됨'; exception when others then assert sqlerrm = 'bankrupt', '07 '||sqlerrm; end;
  s := public.adjust(p, 100000, '보너스');
  assert (s->'family'->>'balance')::int = 49000, '07 보너스 후 49000';

  -- 8. 자녀: 어제 앞가림/패드 — 신청 후 부모가 승인해야 반영
  s := public.request_item(c, iid, y);
  assert (s->'family'->>'balance')::int = 49000 and jsonb_array_length(s->'pending') = 1, '08 신청만으로는 잔고 불변';
  s := public.decide_request(p, (s->'pending'->0->>'id')::bigint, true, y);
  assert (s->'family'->>'balance')::int = 59000 and s->>'day' = y::text, '08 어제 앞가림 승인 +10000';
  assert (select day from public.txs where family_id=fid and label='공부하기 (학교·숙제·주말 공부 포함)') = y, '08 내역 날짜 어제';
  begin perform public.request_item(c, iid, y); assert false, '08b 이미 한 날 재신청'; exception when others then assert sqlerrm = 'duplicate', '08b '||sqlerrm; end;
  select id into iid from public.items where family_id=fid and slug='pad';
  s := public.request_item(c, iid);
  s := public.decide_request(p, (s->'pending'->0->>'id')::bigint, true);
  assert (s->'family'->>'balance')::int = 57000, '08d 오늘 패드 승인 -2000';
  begin perform public.request_item(c, iid, t+1); assert false, '08e 미래 날짜 신청됨'; exception when others then assert sqlerrm = 'invalid_day', '08e '||sqlerrm; end;

  -- 9. 심부름: 어제 날짜로 신청 → 승인 시 어제 기록
  select id into iid from public.items where family_id=fid and slug='dish';
  s := public.request_extra(c, iid, y);
  assert jsonb_array_length(s->'pending') = 1 and (s->'pending'->0->>'day') = y::text, '09 신청 1건(어제)';
  s := public.request_extra(c, iid, y);
  assert jsonb_array_length(s->'pending') = 2, '09b (v4) 같은 날 여러 번 신청 가능';
  s := public.decide_request(p, (s->'pending'->0->>'id')::bigint, false);
  rid := (s->'pending'->0->>'id')::bigint;
  begin perform public.decide_request(c, rid, true); assert false, '09c 자녀가 승인함'; exception when others then assert sqlerrm = 'forbidden', '09c '||sqlerrm; end;
  s := public.decide_request(p, rid, true);
  assert (s->'family'->>'balance')::int = 67000, '09d 승인 +10000';
  assert (select day from public.txs where family_id=fid and label='설거지 완벽 클리어') = y, '09d 내역 날짜 어제';
  assert (public.get_state(c, y)->'done_counts'->>iid::text)::int = 1, '09d 어제 완료 횟수 1';
  begin perform public.decide_request(p, rid, true); assert false, '09e 중복 승인'; exception when others then assert sqlerrm = 'invalid', '09e '||sqlerrm; end;
  s := public.request_extra(c, iid, y);
  assert jsonb_array_length(s->'pending') = 1, '09f (v4) 이미 한 날에도 또 신청 가능';
  perform public.decide_request(p, (s->'pending'->0->>'id')::bigint, false);

  -- 10. 미션
  begin perform public.create_mission(c, '해킹', 100); assert false, '10 자녀가 미션 생성'; exception when others then assert sqlerrm = 'forbidden', '10 '||sqlerrm; end;
  begin perform public.create_mission(p, '  ', 100); assert false, '10b 빈 제목'; exception when others then assert sqlerrm = 'invalid', '10b '||sqlerrm; end;
  s := public.create_mission(p, '베란다 대청소', 20000);
  mid := (s->'missions'->0->>'id')::bigint;
  assert s->'missions'->0->>'status' = 'open', '10c 새 미션 open';
  assert public.get_state(c)->'missions'->0->>'title' = '베란다 대청소', '10d 자녀에게 보임';
  assert jsonb_array_length(public.get_state(c, y)->'missions') = 1, '10e (v3) 미션은 날짜와 무관하게 보임';
  s := public.request_mission(c, mid);
  assert s->'missions'->0->>'status' = 'wait' and jsonb_array_length(s->'pending') = 1, '10f 신청 → wait';
  begin perform public.request_mission(c, mid); assert false, '10g 중복 신청'; exception when others then assert sqlerrm = 'duplicate', '10g '||sqlerrm; end;
  rid := (select id from public.requests where mission_id = mid and status='wait');
  s := public.decide_request(p, rid, false);
  assert s->'missions'->0->>'status' = 'open' and jsonb_array_length(s->'pending') = 0, '10h 거절 → 다시 open';
  s := public.request_mission(c, mid);
  rid := (select id from public.requests where mission_id = mid and status='wait');
  b := (s->'family'->>'balance')::int;
  s := public.decide_request(p, rid, true);
  assert s->'missions'->0->>'status' = 'done' and (s->'family'->>'balance')::int = b + 20000, '10i 승인 → done, +20000';
  assert exists (select 1 from public.txs where family_id=fid and label='미션: 베란다 대청소' and day=t), '10i 미션 내역';
  -- 미션 삭제 시 대기 신청도 함께 삭제
  s := public.create_mission(p, '단어 외우기', 3000, y);
  mid := (select id from public.missions where family_id=fid and title='단어 외우기');
  perform public.request_mission(c, mid);
  assert (select count(*) from public.requests where mission_id = mid) = 1, '10j 신청 생성';
  s := public.delete_mission(p, mid);
  assert (select count(*) from public.requests where mission_id = mid) = 0 and not exists (select 1 from public.missions where id=mid), '10k 삭제 시 신청도 삭제';

  -- 11. 쓰기
  select id into iid from public.items where family_id=fid and slug='pc1';
  s := public.request_item(c, iid);
  assert (s->'family'->>'balance')::int = b + 20000, '11 신청만으로는 차감 안 됨';
  s := public.decide_request(p, (s->'pending'->0->>'id')::bigint, true);
  assert (s->'family'->>'balance')::int = b + 20000 - 10000, '11 PC 1시간 승인 -10000';
  begin perform public.request_item(p, iid); assert false, '11b 부모가 신청'; exception when others then assert sqlerrm = 'forbidden', '11b '||sqlerrm; end;

  -- 12. 날짜 초기화: 어제 체크를 전부 되돌리고 잔고도 맞춰짐
  b := (select balance from public.families where id=fid);
  n := (select coalesce(sum(amount),0) from public.checks where family_id=fid and day=y)
     + (select coalesce(sum(r.amount),0) from public.requests r join public.items i on i.id = r.item_id where r.family_id=fid and r.day=y and r.status='done' and i.kind='extra');
  s := public.reset_day(p, y);
  assert (s->'family'->>'balance')::int = b - n, '12 초기화 후 잔고 = '||(b-n)||' 실제 '||(s->'family'->>'balance');
  assert (select count(*) from public.checks where family_id=fid and day=y) = 0, '12 어제 체크 비어있음';
  -- 되돌린 날은 외박 포함해 다시 적용 가능 (학원비 변경 반영)
  s := public.set_academy(p, 150000);
  select jsonb_agg(id) into items from public.items where family_id=fid and slug='rent';
  b := (s->'family'->>'balance')::int;
  s := public.apply_fixed(p, y, items, 2);
  assert (s->'family'->>'balance')::int = b - 2000 - 1000 - 10000 - 1000 - 5000, '12b 재적용(숙박 제외, 학원비 5000) 실제 '||((s->'family'->>'balance')::int - b);

  -- 13. 항목 관리
  s := public.upsert_item(p, null, 'extra', '새 심부름', '', -500, true, false);
  assert (select amount from public.items where family_id=fid and title='새 심부름') = 500, '13 심부름 금액 양수화';
  select id into iid from public.items where family_id=fid and slug='trash';
  s := public.upsert_item(p, iid, 'extra', '쓰레기', null, 7000, false, null);
  assert not exists (select 1 from jsonb_array_elements(public.get_state(c)->'items') x where x->>'id' = iid::text), '13b 사용 해제 항목은 자녀에게 안 보임';
  assert exists (select 1 from jsonb_array_elements(public.get_state(p)->'items') x where x->>'id' = iid::text), '13c 부모에게는 보임';
  begin perform public.request_extra(c, iid, y); assert false, '13d 해제 항목 신청'; exception when others then assert sqlerrm = 'invalid', '13d '||sqlerrm; end;

  -- 14. 권한/열쇠
  begin perform public.get_state('0000000000000000000000000000'); assert false, '14 가짜 열쇠'; exception when others then assert sqlerrm = 'unauthorized', '14 '||sqlerrm; end;
  perform public.sign_out(c);
  begin perform public.get_state(c); assert false, '14b 로그아웃한 열쇠'; exception when others then assert sqlerrm = 'unauthorized', '14b '||sqlerrm; end;
  begin perform public.sign_out(p); assert false, '14c 마지막 부모 해제'; exception when others then assert sqlerrm = 'last_parent', '14c '||sqlerrm; end;
  assert jsonb_array_length(public.list_credentials(p)) = 2, '14d 기기 목록 2';

  -- 15. 전체 초기화
  s := public.reset_all(p);
  assert (s->'family'->>'balance')::int = 0 and jsonb_array_length(s->'txs') = 0 and jsonb_array_length(s->'missions') = 0, '15 전체 초기화';
  assert (select count(*) from public.items where family_id=fid) = 18, '15b 항목은 유지(17+새 심부름)';

  -- 16. 이어받기 / 시작일 보정
  p := (public.create_family('이어받기', 300000, 12345, t + 5))->>'secret';
  s := public.get_state(p);
  assert (s->'family'->>'balance')::int = 12345 and jsonb_array_length(s->'txs') = 1 and s->>'start_date' = t::text, '16 이어받기+미래 시작일 보정';
  assert (s->'checks') = '{}'::jsonb, '16b 이어받기해도 자동 차감 없음';

  raise exception 'ALL_OK %', procedure_ok;
end $$;
