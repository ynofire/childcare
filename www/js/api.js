// Supabase RPC 호출과 오류 코드 → 한글 안내.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const ERR = {
  unauthorized: '이 기기의 연결이 해제됐어요. 다시 연결해 주세요.',
  forbidden: '권한이 없어요.',
  bankrupt: '파산 상태라 할 수 없어요.',
  blocked: '마이너스라 지금은 할 수 없어요.',
  insufficient: '포인트가 모자라요! 먼저 앞가림이나 심부름을 하세요.',
  duplicate: '이미 처리됐거나 신청 중인 항목이에요.',
  invalid: '값이 올바르지 않아요.',
  invalid_day: '고를 수 없는 날짜예요. (운영 시작일 이전이거나 미래 날짜)',
  invalid_invite: '연결 코드가 틀렸거나 만료됐어요. 부모님께 새 코드를 받아 주세요.',
  busy: '잠시 후 다시 시도해 주세요.',
  last_parent: '이 기기는 마지막 부모 기기라 해제할 수 없어요.',
  offline: '인터넷 연결을 확인해 주세요.',
};

export function errText(e) {
  const code = e && e.code;
  return ERR[code] || '문제가 생겼어요. 잠시 후 다시 해주세요.';
}

export function makeRpc({ url = SUPABASE_URL, key = SUPABASE_KEY, fetchImpl, timeoutMs = 15000 } = {}) {
  return async function rpc(fn, args = {}) {
    const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
    const headers = { 'Content-Type': 'application/json', apikey: key };
    if (key.split('.').length === 3) headers.Authorization = 'Bearer ' + key; // 옛 방식(JWT) 키일 때만
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await doFetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), signal: ctl.signal });
    } catch (e) {
      throw Object.assign(new Error('offline'), { code: 'offline' });
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try { body = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) {
      const msg = (body && body.message) || 'error';
      throw Object.assign(new Error(msg), { code: ERR[msg] ? msg : 'error', status: res.status });
    }
    return body;
  };
}
