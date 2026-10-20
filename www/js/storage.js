// localStorage 가 막힌 환경(사생활 보호 등)에서도 예외 없이 동작하는 얇은 래퍼. 막히면 메모리에만 보관한다.
export const SECRET_KEY = 'cc_secret_v2';
const mem = new Map();
export const storage = {
  getItem(k) { try { return localStorage.getItem(k); } catch (e) { return mem.has(k) ? mem.get(k) : null; } },
  setItem(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem.set(k, String(v)); } },
  removeItem(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } mem.delete(k); },
};
