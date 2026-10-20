// 테스트 전용: Supabase(PostgREST)의 /rest/v1/rpc/<함수> 규약을 흉내내는 얇은 서버.
// - 본문 JSON 키(p_*)를 이름 있는 인자로 넘기고, anon 역할로 실행해 권한·RLS 를 실제와 같게 검증한다.
// - 서버 예외는 HTTP 400 {message}, 없는 함수/인자는 404 {code:'PGRST202'} (PostgREST 와 동일한 모양).
// - www/ 정적 파일도 같은 오리진에서 서빙한다(CORS 없이 E2E 가능).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const FN_RE = /^[a-z_][a-z0-9_]*$/;
const ARG_RE = /^p_[a-z0-9_]+$/;

export async function startShim({ pg: pgConfig, port = 0, wwwDir = null } = {}) {
  const pool = new pg.Pool({ ...pgConfig, max: 8 });
  let fakeToday = null;

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };
  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...extra });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  async function callRpc(fn, args) {
    const keys = Object.keys(args);
    const params = keys.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} := $${i + 1}`).join(', ')}) as r`;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.fake_today', $1, true)", [fakeToday ?? '']);
      await client.query('set local role anon');
      const out = await client.query(sql, params);
      await client.query('commit');
      return { ok: true, value: out.rows[0].r };
    } catch (e) {
      await client.query('rollback').catch(() => {});
      return { ok: false, error: e };
    } finally {
      client.release();
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

      const m = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
      if (m) {
        if (req.method !== 'POST') return send(res, 405, { message: 'method not allowed' });
        const fn = m[1];
        let raw = '';
        for await (const chunk of req) raw += chunk;
        let args = {};
        try { args = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, { message: 'invalid json' }); }
        if (!FN_RE.test(fn) || !args || typeof args !== 'object' || Array.isArray(args) || !Object.keys(args).every((k) => ARG_RE.test(k))) {
          return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
        }
        const r = await callRpc(fn, args);
        if (r.ok) return send(res, 200, r.value === undefined ? null : r.value);
        const e = r.error;
        if (e.code === '42883') return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}`, details: e.message });
        if (e.code === '42501') return send(res, 401, { code: e.code, message: e.message });
        return send(res, 400, { code: e.code, message: e.message });
      }

      if (url.pathname.startsWith('/rest/v1/')) return send(res, 401, { code: '42501', message: 'permission denied' });

      if (wwwDir && req.method === 'GET') {
        let rel = decodeURIComponent(url.pathname);
        if (rel.endsWith('/')) rel += 'index.html';
        const file = path.join(wwwDir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
        if (!file.startsWith(path.resolve(wwwDir))) { res.writeHead(403); return res.end(); }
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
          return fs.createReadStream(file).pipe(res);
        }
      }
      res.writeHead(404, cors); res.end('not found');
    } catch (e) {
      send(res, 500, { message: String(e && e.message) });
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: realPort } = server.address();
  return {
    url: `http://127.0.0.1:${realPort}`,
    setFakeToday(d) { fakeToday = d; },
    async close() {
      await new Promise((r) => server.close(r));
      server.closeAllConnections?.();
      await pool.end();
    },
  };
}
