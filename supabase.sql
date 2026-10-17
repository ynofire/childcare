-- 가정 내 자본주의 — Supabase 스키마
-- Supabase Dashboard > SQL Editor 에서 실행하세요.

create table if not exists state (
  id integer primary key default 1,
  family_id text not null default 'default',
  balance integer default 0,
  academy integer default 300000,
  pw text default '1234',
  daily jsonb default '{}'::jsonb,
  txs jsonb default '[]'::jsonb,
  pending jsonb default '[]'::jsonb,
  missions jsonb default '[]'::jsonb,
  seq integer default 0,
  updated_at timestamptz default now()
);

-- 최초 1행 생성 (이미 있으면 무시)
insert into state (id, family_id, balance, academy, pw)
values (1, 'default', 0, 300000, '1234')
on conflict (id) do nothing;

-- RLS 켜고, 익명(anon) 키로도 읽기/쓰기 허용 (가족 앱이므로 단순화)
alter table state enable row level security;
create policy "state select all" on state for select to anon using (true);
create policy "state insert all" on state for insert to anon with check (true);
create policy "state update all" on state for update to anon using (true);
create policy "state delete all" on state for delete to anon using (true);

-- Realtime publish
alter publication supabase_realtime add table state;
