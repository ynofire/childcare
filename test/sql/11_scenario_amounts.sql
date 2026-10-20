do $$
declare
  p text; fid uuid; s jsonb; t date := (now() at time zone 'Asia/Seoul')::date;
  food uuid; rent uuid; util uuid; b int;
begin
  p := (public.create_family('금액테스트', 300000, 0, t - 2))->>'secret';
  select family_id into fid from public.credentials where hash = encode(extensions.digest(p,'sha256'),'hex');
  select id into food from public.items where family_id=fid and slug='food';
  select id into rent from public.items where family_id=fid and slug='rent';
  select id into util from public.items where family_id=fid and slug='util';

  -- A. 식비 3끼 허용 (끼니당 1,000P → -3000), 4끼는 거부
  s := public.apply_fixed(p, null, (select jsonb_agg(id) from public.items where family_id=fid and kind='fixed' and slug<>'food'), 3);
  assert (s->'family'->>'balance')::int = -3000, 'A1 3끼 -3000 실제: '||(s->'family'->>'balance');
  assert exists (select 1 from jsonb_array_elements(s->'txs') x where x->>'label'='식비 (3끼)'), 'A1 라벨';
  begin perform public.apply_fixed(p, null, '[]'::jsonb, 4); assert false, 'A2 4끼 허용됨'; exception when others then assert sqlerrm='invalid','A2 '||sqlerrm; end;
  begin perform public.apply_fixed(p, null, '[]'::jsonb, -1); assert false, 'A3 -1끼 허용됨'; exception when others then assert sqlerrm='invalid','A3 '||sqlerrm; end;

  -- B. 어제: 금액 직접 입력 (숙박비 12345, 식비 2500), 나머지는 규칙대로
  s := public.apply_fixed(p, t-1, (select jsonb_agg(id) from public.items where family_id=fid and kind='fixed' and slug not in ('rent','food','util')),
        2, jsonb_build_object(rent::text, 12345, food::text, 2500));
  assert (s->'checks'->>rent::text)::int = -12345, 'B1 숙박비 직접 입력 -12345';
  assert (s->'checks'->>food::text)::int = -2500, 'B2 식비 직접 입력 -2500 (끼니 무시)';
  assert (s->'checks'->>util::text)::int = (select amount from public.items where id=util), 'B3 입력 안 한 항목은 규칙대로';
  assert exists (select 1 from jsonb_array_elements(s->'txs') x where x->>'label'='숙박비 (직접 입력 12,345P)' and (x->>'amount')::int=-12345), 'B4 내역 라벨/금액';
  b := (s->'family'->>'balance')::int;

  -- C. 직접 입력 0원: 체크는 0으로 남고 내역은 없음 (오늘 남은 항목: 식비 외 이미 적용 → 아무 변화 없어야 함)
  s := public.apply_fixed(p, t-1, (select jsonb_agg(id) from public.items where family_id=fid and kind='fixed' and slug<>'rent'), 2, jsonb_build_object(rent::text, 99999));
  assert (s->'family'->>'balance')::int = b, 'C1 이미 적용된 항목은 금액을 줘도 바뀌지 않음(멱등)';

  -- D. 잘못된 값
  begin perform public.apply_fixed(p, t-2, '[]'::jsonb, 2, jsonb_build_object(rent::text, -5)); assert false, 'D1 음수 허용됨'; exception when others then assert sqlerrm='invalid','D1 '||sqlerrm; end;
  begin perform public.apply_fixed(p, t-2, '[]'::jsonb, 2, jsonb_build_object(rent::text, '1000')); assert false, 'D2 문자열 허용됨'; exception when others then assert sqlerrm='invalid','D2 '||sqlerrm; end;
  begin perform public.apply_fixed(p, t-2, '[]'::jsonb, 2, jsonb_build_object(rent::text, 1.5)); assert false, 'D3 소수 허용됨'; exception when others then assert sqlerrm='invalid','D3 '||sqlerrm; end;
  begin perform public.apply_fixed(p, t-2, '[]'::jsonb, 2, jsonb_build_object(rent::text, 10000001)); assert false, 'D4 초과 허용됨'; exception when others then assert sqlerrm='invalid','D4 '||sqlerrm; end;
  begin perform public.apply_fixed(p, t-2, '[]'::jsonb, 2, '[1]'::jsonb); assert false, 'D5 배열 허용됨'; exception when others then assert sqlerrm='invalid','D5 '||sqlerrm; end;
  -- 실패한 호출은 아무것도 남기지 않음
  assert (select count(*) from public.checks where family_id=fid and day=t-2)=0, 'D6 실패 시 롤백';

  -- E. 0원 직접 입력 → 체크 0, 내역 증가 없음
  s := public.apply_fixed(p, t-2, (select jsonb_agg(id) from public.items where family_id=fid and kind='fixed' and slug<>'rent'), 2, jsonb_build_object(rent::text, 0));
  assert (s->'checks'->>rent::text)::int = 0, 'E1 0원 체크 기록';
  assert not exists (select 1 from jsonb_array_elements(s->'txs') x where x->>'label' like '숙박비 (직접 입력 0%'), 'E2 0원 내역 없음';

  -- F. anon 이 새 시그니처만 실행 가능, 옛 시그니처는 없음
  assert (select count(*) from pg_proc where proname='apply_fixed' and pronamespace='public'::regnamespace)=1, 'F1 오버로드 1개';
  assert has_function_privilege('anon','public.apply_fixed(text,date,jsonb,integer,jsonb)','execute'), 'F2 anon 실행 가능';
  assert not has_function_privilege('authenticated','public.apply_fixed(text,date,jsonb,integer,jsonb)','execute'), 'F3 authenticated 불가';
  raise exception 'AMOUNTS_OK';
end $$;
