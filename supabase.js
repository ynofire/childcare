// 가정 내 자본주의 — Supabase 클라이언트
// 이 파일의 SUPABASE_URL / SUPABASE_ANON_KEY를 본인 프로젝트 값으로 바꾸세요.
// Supabase Dashboard > Settings > API 에서 확인 가능.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const STATE_ID = 1;
export const STATE_FAMILY = 'default';

export function defaultState() {
  return { balance: 0, academy: 300000, pw: '1234', daily: {}, txs: [], pending: [], missions: [], seq: 0 };
}

function toAppState(row) {
  if (!row) return defaultState();
  return {
    balance: typeof row.balance === 'number' ? row.balance : 0,
    academy: typeof row.academy === 'number' ? row.academy : 300000,
    pw: row.pw || '1234',
    daily: row.daily || {},
    txs: Array.isArray(row.txs) ? row.txs : [],
    pending: Array.isArray(row.pending) ? row.pending : [],
    missions: Array.isArray(row.missions) ? row.missions : [],
    seq: typeof row.seq === 'number' ? row.seq : 0,
    _updated_at: row.updated_at,
  };
}

export async function loadFromDb() {
  const { data, error } = await supabase.from('state').select('*').eq('id', STATE_ID).single();
  if (error || !data) return defaultState();
  return toAppState(data);
}

export async function saveToDb(S) {
  const { error } = await supabase.from('state').upsert({
    id: STATE_ID,
    family_id: STATE_FAMILY,
    balance: S.balance,
    academy: S.academy,
    pw: S.pw,
    daily: S.daily,
    txs: S.txs,
    pending: S.pending,
    missions: S.missions,
    seq: S.seq,
    updated_at: new Date().toISOString(),
  });
  return error;
}

export function subscribeToChanges(onChange) {
  const channel = supabase
    .channel('state-changes')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'state', filter: `id=eq.${STATE_ID}` },
      (payload) => {
        const remote = toAppState(payload.new);
        if (onChange) onChange(remote);
      }
    )
    .subscribe();
  return channel;
}
