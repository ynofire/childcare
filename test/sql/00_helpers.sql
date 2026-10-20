-- 테스트 전용: 서버 '오늘'을 GUC(app.fake_today)로 바꿀 수 있게 한다. 운영 supabase.sql 에는 넣지 않는다.
create or replace function private.today() returns date
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.fake_today', true), '')::date, (now() at time zone 'Asia/Seoul')::date)
$$;
