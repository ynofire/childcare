// E2E 하네스: 로컬 PG + PostgREST 호환 shim + Chromium. 부모 폰/아들 폰을 각각 독립된 브라우저 컨텍스트(저장소 분리)로 띄운다.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startShim } from '../shim/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PG = { host: '/tmp/pgtest_cc', port: 5544, user: 'postgres', database: 'cc' };
export const SECRET_KEY = 'cc_secret_v2';

export async function newWorld({ viewport = { width: 390, height: 844 }, pollMs = 600 } = {}) {
  execFileSync('bash', ['test/run-sql.sh', 'up'], { cwd: ROOT, stdio: 'pipe' });
  const shim = await startShim({ pg: PG, wwwDir: path.join(ROOT, 'www') });
  const browser = await chromium.launch();
  const errors = [];
  const contexts = [];

  async function newPhone(name = 'phone') {
    const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ko-KR' });
    await ctx.addInitScript(`window.__CC_API__ = location.origin; window.__CC_POLL_MS__ = ${pollMs};`);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
    contexts.push(ctx);
    return { ctx, page };
  }
  const p = await newPhone('parent');
  const c = await newPhone('child');

  async function rpc(fn, args = {}) {
    const res = await fetch(`${shim.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'x' }, body: JSON.stringify(args) });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(body && body.message), { code: body && body.message, status: res.status });
    return body;
  }
  // 날짜 도우미 (서버 '오늘'과 같은 한국 시간 기준)
  const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const addDays = (ds, n) => new Date(Date.parse(ds + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
  // 슬러그 → 항목 (부모 열쇠로 서버 상태를 읽어 id 를 얻는다)
  async function items(parentSecret) {
    const st = await rpc('get_state', { p_secret: parentSecret });
    return Object.fromEntries(st.items.map((i) => [i.slug || i.title, i]));
  }
  const secretOf = (page) => page.evaluate((k) => localStorage.getItem(k), SECRET_KEY);

  // 서버 쪽에서 가족을 만들고 두 폰에 열쇠를 심은 뒤 앱을 연다 (연결 화면을 거치지 않는 빠른 준비)
  async function seedFamily({ academy = 300000, opening = 0, start } = {}) {
    const parentSecret = (await rpc('create_family', { p_name: '테스트 가족', p_academy: academy, p_opening: opening, p_start: start ?? null })).secret;
    const code = await rpc('issue_invite', { p_secret: parentSecret, p_role: 'child', p_label: '아들폰' });
    const childSecret = (await rpc('redeem_invite', { p_code: code })).secret;
    for (const [page, secret] of [[p.page, parentSecret], [c.page, childSecret]]) {
      await page.goto(shim.url + '/');
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SECRET_KEY, secret]);
      await page.reload();
    }
    return { parentSecret, childSecret };
  }

  return {
    url: shim.url, shim, rpc, errors, secretOf, seedFamily, newPhone, kstToday, addDays, items,
    parent: p.page, child: c.page,
    setFakeToday: (d) => shim.setFakeToday(d),
    async teardown() {
      for (const ctx of contexts) await ctx.close().catch(() => {});
      await browser.close().catch(() => {});
      await shim.close().catch(() => {});
      execFileSync('bash', ['test/run-sql.sh', 'down'], { cwd: ROOT, stdio: 'pipe' });
    },
  };
}
