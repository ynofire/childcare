// 새 버전 알림: GitHub Releases 의 최신 버전(v<번호>)이 지금 설치된 앱의 빌드 번호보다 크면 알려준다.
// 안드로이드는 앱이 스스로 설치할 수 없으므로, '받기'를 누르면 APK 를 내려받는 데까지만 돕는다.
export const RELEASES_API = 'https://api.github.com/repos/ynofire/childcare/releases/latest';
const DISMISS_KEY = 'cc_upd_dismiss_v1';

export function parseBuild(tag) {
  const m = /^v(\d+)$/.exec(String(tag == null ? '' : tag));
  return m ? Number(m[1]) : null;
}

// 실패하면 null (알림은 부가 기능이라 조용히 넘어간다)
export async function checkUpdate({ current, fetchImpl, api = RELEASES_API, timeoutMs = 8000 } = {}) {
  if (!Number.isFinite(current)) return null;
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await doFetch(api, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl ? ctl.signal : undefined });
    if (!res.ok) return null;
    const body = await res.json();
    const build = parseBuild(body && body.tag_name);
    if (build == null) return null;
    const apk = ((body.assets || []).find((a) => /\.apk$/i.test(a.name || '')) || {}).browser_download_url || null;
    return { available: build > current, build, apk, url: body.html_url || null };
  } catch (e) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 확인 간격을 두고(gapMs) 새 버전을 찾아 onChange(info|null)로 알린다. '나중에'로 닫은 버전은 다시 알리지 않는다.
export function createUpdateWatch({ getBuild, fetchImpl, api, now = Date.now, gapMs = 30 * 60 * 1000, storage, onChange = () => {} } = {}) {
  let last = null, info = null;
  const dismissed = () => { try { return storage && storage.getItem(DISMISS_KEY); } catch (e) { return null; } };
  async function check(force = false) {
    const t = now();
    if (!force && last != null && t - last < gapMs) return info;
    last = t;
    const current = await getBuild();
    const r = await checkUpdate({ current, fetchImpl, api });
    if (!r) return info; // 실패: 이전 결과 유지
    info = r.available && String(r.build) !== dismissed() ? r : null;
    onChange(info);
    return info;
  }
  function dismiss() {
    if (info) { try { storage && storage.setItem(DISMISS_KEY, String(info.build)); } catch (e) { /* 저장 못 해도 이번엔 닫는다 */ } }
    info = null;
    onChange(null);
  }
  return { check, dismiss, get info() { return info; } };
}
