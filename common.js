// 가정 내 자본주의 — 공통 저장소 (자녀앱/부모앱 공유)
// 같은 PC·같은 브라우저에서는 localStorage + storage 이벤트로 자동 동기화.
// 다른 기기(애 패드 ↔ 부모 폰)에서는 동기화 코드(복사/붙여넣기)로 수동 동기화.
const DB_KEY = 'cc_v1';

const FIXED = [
  { id: 'rent', t: '숙박비 (잠자리·방 제공)', d: '매일 기본', amt: -3000, def: true, survival: true },
  { id: 'food', t: '식비 (아침·저녁 2끼)', d: '끼니당 1,000P', amt: -2000, def: true, survival: true },
  { id: 'util', t: '수광열비 (샤워·전기·온수)', d: '매일 기본', amt: -1000, def: true },
  { id: 'shot', t: '키 크는 주사 (건강관리)', d: '매일 고정', amt: -10000, def: true, survival: true },
  { id: 'phone', t: '핸드폰 기본 유지비', d: '매일 고정', amt: -1000, def: true },
  { id: 'pad', t: '패드 사용료 (선택)', d: '사용 체크 시에만 차감', amt: -2000, def: false },
  { id: 'academy', t: '학원비 (일할)', d: '월 학원비 ÷ 30', amt: 'academy', def: true },
];
const BASE = [
  { id: 'school', t: '학생으로서 오늘 할 일 끝내기', d: '출석·숙제 완수', amt: 10000 },
  { id: 'room', t: '내 공간 스스로 관리하기', d: '침대·책상·바닥 정리', amt: 10000 },
];
const EXTRA = [
  { id: 'dish', t: '설거지 완벽 클리어', amt: 10000 },
  { id: 'trash', t: '쓰레기 비우기·분리수거', amt: 10000 },
  { id: 'laundry', t: '빨래 + 건조대 널기', amt: 10000 },
  { id: 'dog', t: '강아지 케어 (밥·배변·산책)', amt: 5000 },
  { id: 'grade', t: '성적 향상 / 목표 달성 보너스', amt: 10000 },
];

function defaultState() {
  return { balance: 0, academy: 300000, pw: '1234', daily: {}, txs: [], pending: [], seq: 0 };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
    if (s && typeof s.balance === 'number') return s;
  } catch (e) {}
  const s = defaultState();
  localStorage.setItem(DB_KEY, JSON.stringify(s));
  return s;
}
function save(S) { localStorage.setItem(DB_KEY, JSON.stringify(S)); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function acadDay(S) { return -Math.round((S.academy || 0) / 30); }
function amtOf(S, it) { return it.id === 'academy' ? acadDay(S) : it.amt; }
function fmt(n) { return (n > 0 ? '+' : '') + n.toLocaleString() + 'P'; }
function statusOf(balance) {
  if (balance <= -30000) return 'bankrupt';
  if (balance < 0) return 'blocked';
  return 'ok';
}
// 고정지출 자동 적용: 하루 최초 진입 시 def:true 항목을 1회만 차감
function autoApplyFixed(S) {
  const d = todayStr();
  if (!S.daily[d]) S.daily[d] = {};
  let changed = false;
  FIXED.forEach((it) => {
    if (it.def && !S.daily[d][it.id]) {
      S.daily[d][it.id] = true;
      const amt = amtOf(S, it);
      S.balance += amt;
      S.txs.unshift({ d, label: it.t + (it.id === 'academy' ? ' (' + amt.toLocaleString() + 'P)' : ''), amt, bal: S.balance });
      changed = true;
    }
  });
  if (changed) save(S);
  return changed;
}
// 동기화 코드: 다른 기기로 옮길 때 사용 (base64 JSON)
function exportCode(S) { return btoa(unescape(encodeURIComponent(JSON.stringify(S)))); }
function importCode(code) {
  const S = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  if (typeof S.balance !== 'number') throw new Error('bad data');
  return S;
}
