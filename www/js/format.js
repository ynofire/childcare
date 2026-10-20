// 화면과 무관한 순수 함수들 (숫자·날짜 표기). 날짜는 'YYYY-MM-DD' 문자열끼리만 계산해 기기 시간대의 영향을 받지 않는다.
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export function money(n) { return Number(n).toLocaleString('ko-KR'); }
export function fmt(n) { return (n > 0 ? '+' : '') + money(n) + 'P'; }
export function shortTitle(t) { return String(t).split(' (')[0]; }

function ymd(ds) { return String(ds).split('-').map(Number); }
export function addDays(ds, n) {
  const [y, m, d] = ymd(ds);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
}
export function fmtDate(ds) {
  const [y, m, d] = ymd(ds);
  return m + '/' + d + '(' + DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ')';
}
