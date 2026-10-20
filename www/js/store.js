// 상태 보관 + 직렬 액션 큐 + 폴링/복귀 갱신. 화면과 완전히 분리돼 있어 단독 테스트가 가능하다.
// 원칙: ① 화면 상태는 서버 응답으로만 바뀐다 ② 사용자 동작은 큐에 쌓여 순서대로 전송되며 버려지지 않는다.
const SECRET_KEY = 'cc_secret_v2';
const QUEUE_KEY = 'cc_queue_v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createStore({ rpc, storage, pollMs = 5000, retryMs = 2000, env } = {}) {
  const doc = (env && env.doc) || globalThis.document;
  const win = (env && env.win) || globalThis.window;
  let state = null, online = true, day = null;
  let seq = 0, applied = 0, entrySeq = 0;
  let queue = [], running = false, stopped = false, refreshing = null, timer = null;
  const listeners = new Set();
  const keyOf = (e) => e.key != null ? e.key : `${e.fn}#${e.id}`;

  function notify(meta = {}) { for (const fn of [...listeners]) fn(state, meta); }
  function persist() {
    storage.setItem(QUEUE_KEY, JSON.stringify(queue.map(({ id, fn, args, key }) => ({ id, fn, args, key }))));
  }
  function settle(entry, result) { for (const r of entry.resolvers) r(result); entry.resolvers = []; }
  const hasSecret = () => !!storage.getItem(SECRET_KEY);

  async function call(fn, args) {
    const id = ++seq;
    const s = await rpc(fn, { p_secret: storage.getItem(SECRET_KEY) || '', p_day: day, ...(args || {}) });
    online = true;
    return { id, s };
  }

  // 응답 번호가 이미 반영된 것보다 작으면(= 더 먼저 보낸 요청의 늦은 응답) 버린다.
  function apply(id, s) {
    if (id < applied) return false;
    applied = id;
    const roleChanged = !!(state && s && state.role && s.role && state.role !== s.role);
    state = s;
    notify({ roleChanged });
    return true;
  }

  // 열쇠가 해제됨: 열쇠·큐를 지우고 모든 대기 동작을 실패로 끝낸다. 재시도하지 않는다.
  function fatal() {
    storage.removeItem(SECRET_KEY);
    const dropped = queue; queue = []; persist();
    for (const e of dropped) settle(e, { ok: false, code: 'unauthorized' });
    notify({ error: { code: 'unauthorized' } });
  }

  async function pump() {
    if (running) return;
    running = true;
    let worked = false;
    try {
      while (queue.length && !stopped) {
        const e = queue[0];
        e.inflight = true;
        try {
          const { id, s } = await call(e.fn, e.args);
          apply(id, s);
          queue.shift(); persist(); worked = true;
          settle(e, { ok: true });
          notify({ reason: 'pending' });
        } catch (err) {
          e.inflight = false;
          const code = (err && err.code) || 'error';
          if (code === 'offline') { online = false; notify({ reason: 'net' }); await sleep(retryMs); continue; }
          if (code === 'unauthorized') { fatal(); worked = false; break; }
          queue.shift(); persist(); worked = true;
          settle(e, { ok: false, code });
          notify({ error: { code, fromAction: e.fn } });
        }
      }
    } finally {
      running = false;
    }
    if (worked && !stopped && !queue.length) refresh();
  }

  function act(fn, args = {}, opts = {}) {
    return new Promise((resolve) => {
      const key = opts.key;
      const same = key != null ? queue.find((e) => e.key === key && !e.inflight && e.fn === fn) : null;
      if (same) { same.args = args; same.resolvers.push(resolve); }
      else queue.push({ id: ++entrySeq, fn, args, key, resolvers: [resolve], inflight: false });
      persist();
      notify({ reason: 'pending' });
      pump();
    });
  }

  function refresh() {
    if (!hasSecret()) return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const { id, s } = await call('get_state');
        apply(id, s);
      } catch (err) {
        const code = (err && err.code) || 'error';
        if (code === 'offline') { online = false; notify({ reason: 'net' }); }
        else if (code === 'unauthorized') fatal();
        else notify({ error: { code, fromAction: 'get_state' } });
      } finally { refreshing = null; }
    })();
    return refreshing;
  }

  const onVisible = () => { if (!(doc && doc.hidden)) refresh(); };
  const onOnline = () => { refresh(); pump(); };
  const onFocus = () => { refresh(); };

  function start() {
    stopped = false;
    try { queue = (JSON.parse(storage.getItem(QUEUE_KEY) || '[]') || []).map((e) => ({ ...e, resolvers: [], inflight: false })); } catch (e) { queue = []; }
    entrySeq = queue.reduce((m, e) => Math.max(m, e.id || 0), 0);
    doc && doc.addEventListener('visibilitychange', onVisible);
    win && win.addEventListener('online', onOnline);
    win && win.addEventListener('focus', onFocus);
    timer = setInterval(() => { if (!(doc && doc.hidden)) refresh(); }, pollMs);
    if (queue.length) { notify({ reason: 'pending' }); pump(); }
    refresh();
  }
  function stop() {
    stopped = true;
    clearInterval(timer); timer = null;
    doc && doc.removeEventListener('visibilitychange', onVisible);
    win && win.removeEventListener('online', onOnline);
    win && win.removeEventListener('focus', onFocus);
  }
  function setDay(d) { day = d || null; return refresh(); }
  function signOutLocal() {
    stop();
    storage.removeItem(SECRET_KEY);
    for (const e of queue) settle(e, { ok: false, code: 'unauthorized' });
    queue = []; persist(); state = null;
  }

  return {
    get state() { return state; },
    get online() { return online; },
    get day() { return day; },
    get pending() { return new Set(queue.map(keyOf)); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start, stop, refresh, setDay, act, signOutLocal,
  };
}
