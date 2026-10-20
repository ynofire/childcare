// 공개(publishable) 키는 앱에 들어가도 안전하다. 실제 권한은 서버 함수가 기기 열쇠로 검사한다.
// 테스트에서는 globalThis.__CC_API__ 로 로컬 서버 주소를 덮어쓴다.
export const SUPABASE_URL = globalThis.__CC_API__ || 'https://ewepwpzqijwtaopzjiyr.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Mak0IyKPToK7_tvGaM_D4Q_Pi1x5hqN';
export const POLL_MS = Number(globalThis.__CC_POLL_MS__) || 5000; // 테스트에서만 덮어씀
