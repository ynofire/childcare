// 카드 하나의 상태를 서버 상태 + 큐 상태로 계산하는 순수 함수 (화면과 분리).
// 아이가 하는 모든 일은 '신청'이고, 부모가 승인해야 잔고에 반영된다.
// 상태: todo(아직) · sending(보내는 중) · waiting(부모 승인 대기) · done(승인됨) · rejected(거절됨, 다시 하기) · locked(지금은 못 함)
//  - 앞가림·패드·미션: 하루(미션은 한 번) 한 번만 신청 → 위 상태 중 하나
//  - 심부름·쓰기(spend): 하루 여러 번 신청 → repInfo 의 횟수(sending/waiting/done)로 보여준다
export function pendingKey(kind, id) {
  return kind === 'mission' ? 'mission:' + id : 'req:' + id; // base · optional
}
// 반복 항목은 누를 때마다 다른 키 (같은 키는 큐에서 합쳐지므로)
export const repKey = (id, n) => 'rep:' + id + ':' + n;

const countKeys = (pending, id) => { let n = 0; const p = 'rep:' + id + ':'; for (const k of pending) if (String(k).startsWith(p)) n++; return n; };
const itemOf = (s, id) => (s.items || []).find((i) => i.id === id);

// 쓸 수 있는 포인트 = 잔고 − 승인 대기 중인 쓰기(서버) − 전송 중인 쓰기(큐)
export function spendable(s, pending) {
  let v = Number(s.family.balance);
  for (const r of s.pending || []) { const it = itemOf(s, r.item_id); if (it && it.kind === 'spend') v += Number(r.amount); }
  for (const i of s.items || []) if (i.kind === 'spend') v += Number(i.amount) * countKeys(pending, i.id);
  return v;
}

// 심부름·쓰기 카드: 전송 중/대기/완료 횟수와, 지금 새로 신청할 수 있는지(locked)
export function repInfo(kind, id, s, pending) {
  const waiting = (s.pending || []).filter((r) => r.item_id === id && r.day === s.day).length;
  const done = Number((s.done_counts || {})[id] || 0);
  let locked = s.status === 'bankrupt';
  if (kind === 'spend') {
    const it = itemOf(s, id);
    locked = s.status !== 'ok' || (it ? spendable(s, pending) < -Number(it.amount) : false);
  }
  return { sending: countKeys(pending, id), waiting, done, locked };
}

// 반복 미션이 보고 있는 날에 승인된 횟수
export const missionDone = (s, id) => Number((s.mission_done || {})[id] || 0);

export function cardState(kind, id, s, pending) {
  const bankrupt = s.status === 'bankrupt';
  const blocked = s.status !== 'ok';
  const lastReject = (pred) => { const last = (s.recent || []).find(pred); return !!last && last.status === 'reject'; }; // recent 는 최신순

  if (kind === 'extra' || kind === 'spend') {
    const r = repInfo(kind, id, s, pending);
    if (r.sending) return 'sending';
    if (r.waiting) return 'waiting';
    if (r.locked) return 'locked';
    return r.done ? 'done' : 'todo';
  }
  if (kind === 'base' || kind === 'optional') {
    if (pending.has(pendingKey(kind, id))) return 'sending';
    if (id in (s.checks || {})) return 'done';
    if ((s.pending || []).some((r) => r.item_id === id && r.day === s.day)) return 'waiting';
    if (kind === 'base' ? bankrupt : blocked) return 'locked';
    return lastReject((r) => r.item_id === id && r.day === s.day) ? 'rejected' : 'todo';
  }
  if (kind === 'mission') {
    if (pending.has(pendingKey(kind, id))) return 'sending';
    const m = (s.missions || []).find((x) => String(x.id) === String(id));
    if (!m) return 'todo';
    if (m.status === 'done') return 'done';
    if (m.status === 'wait') return 'waiting';
    if (bankrupt) return 'locked';
    if (lastReject((r) => String(r.mission_id) === String(id))) return 'rejected';
    return m.repeatable && missionDone(s, id) ? 'done' : 'todo'; // 반복 미션은 done 이어도 다시 누를 수 있다
  }
  return 'todo';
}
