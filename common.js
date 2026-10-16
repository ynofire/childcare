// 가정 내 자본주의 — 공통 저장소 (자녀앱/부모앱 공유)
// 같은 브라우저에서는 localStorage + storage 이벤트로 자동 동기화.
// 다른 기기(애 패드 ↔ 부모 폰)에서는 동기화 코드(복사/붙여넣기)로 수동 동기화.
// 날짜 기준: 한국시간(KST) 자정. 운영 시작일: 2026-10-17, 시작 잔고 0P.
const DB_KEY = 'cc_v1';

const FIXED = [
  { id: 'rent', t: '숙박비 (잠자리·방 제공)', d: '외박·수련회면 제외', amt: -3000, def: true, survival: true },
  { id: 'food', t: '식비', d: '끼니당 1,000P · 외식한 끼는 제외', amt: -2000, def: true, survival: true, perMeal: true },
  { id: 'util', t: '수광열비 (샤워·전기·온수)', d: '매일 기본', amt: -1000, def: true },
  { id: 'shot', t: '키 크는 주사 (건강관리)', d: '매일 고정', amt: -10000, def: true, survival: true },
  { id: 'phone', t: '핸드폰 기본 유지비', d: '매일 고정', amt: -1000, def: true },
  { id: 'pad', t: '패드 사용료 (선택)', d: '쓴 날만 자녀가 직접 체크', amt: -2000, def: false },
  { id: 'academy', t: '학원비 (일할)', d: '월 학원비 ÷ 30 · 주말 쉬면 제외', amt: 'academy', def: true },
];
const BASE = [
  { id: 'school', t: '공부하기 (학교·숙제·주말 공부 포함)', d: '했으면 체크', amt: 10000 },
  { id: 'room', t: '내 방 스스로 정리하기', d: '침대·책상·바닥 정리', amt: 10000 },
];
const EXTRA = [
  { id: 'dish', t: '설거지 완벽 클리어', amt: 10000 },
  { id: 'trash', t: '쓰레기 비우기·분리수거', amt: 10000 },
  { id: 'laundry', t: '빨래 + 건조대 널기', amt: 10000 },
  { id: 'dog', t: '강아지 케어 (밥·배변·산책)', amt: 5000 },
  { id: 'grade', t: '성적 향상 / 목표 달성 보너스', amt: 10000 },
];

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// 한국시간 기준 오늘 (UTC+9). 기존 toISOString(UTC)은 새벽에 날짜가 어긋나서 교체.
function todayStr() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(ds, n) {
  const d = new Date(ds + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dowOf(ds) { return DOW[new Date(ds + 'T12:00:00').getDay()]; }
function fmtDate(ds) { const p = ds.split('-'); return (+p[1]) + '/' + (+p[2]) + '(' + dowOf(ds) + ')'; }

function defaultState() {
  return { balance: 0, academy: 300000, pw: '1234', daily: {}, txs: [], pending: [], missions: [], seq: 0 };
}
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch (e) {}
  if (!s || typeof s.balance !== 'number') s = defaultState();
  if (!Array.isArray(s.missions)) s.missions = [];
  if (!s.daily) s.daily = {};
  if (!Array.isArray(s.pending)) s.pending = [];
  if (!Array.isArray(s.txs)) s.txs = [];
  return s;
}
function save(S) { localStorage.setItem(DB_KEY, JSON.stringify(S)); }
function acadDay(S) { return -Math.round((S.academy || 0) / 30); }
function amtOf(S, it) { return it.id === 'academy' ? acadDay(S) : it.amt; }
function fmt(n) { return (n > 0 ? '+' : '') + n.toLocaleString() + 'P'; }
function statusOf(balance) {
  if (balance <= -30000) return 'bankrupt';
  if (balance < 0) return 'blocked';
  return 'ok';
}

// 부모가 선택한 항목만 날짜별로 1회 차감. 주말 스킵·외박·외식은 그냥 체크 해제.
// opts: { skip: {id:true}, meals: 0|1|2 } — pad는 자녀 직접 체크라 여기서 제외.
function applyFixed(S, dateStr, opts) {
  opts = opts || { skip: {}, meals: 2 };
  if (!S.daily[dateStr]) S.daily[dateStr] = {};
  const d = S.daily[dateStr];
  const applied = [];
  FIXED.forEach((it) => {
    if (!it.def || opts.skip[it.id] || d[it.id]) return;
    let amt = amtOf(S, it), label = it.t;
    if (it.id === 'food') {
      const n = opts.meals == null ? 2 : opts.meals;
      amt = -n * 1000; label = '식비 (' + n + '끼)';
      if (amt === 0) return;
    }
    if (it.id === 'academy') label = '학원비 일할 (' + amt.toLocaleString() + 'P)';
    d[it.id] = true;
    S.balance += amt;
    S.txs.unshift({ d: dateStr, label, amt, bal: S.balance });
    applied.push(it.id);
  });
  if (applied.length) save(S);
  return applied;
}

// 특별 미션 (주말 대청소·단어 외우기 등 부모가 생성)
// S.missions: [{id, date, title, amt, status: 'open'|'wait'|'done'}]
function addMission(S, dateStr, title, amt) {
  const m = { id: ++S.seq, date: dateStr, title, amt: Math.abs(+amt || 0), status: 'open' };
  S.missions.unshift(m); save(S); return m;
}

function exportCode(S) { return btoa(unescape(encodeURIComponent(JSON.stringify(S)))); }
function importCode(code) {
  const S = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  if (typeof S.balance !== 'number') throw new Error('bad data');
  return S;
}
