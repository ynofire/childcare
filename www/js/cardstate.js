// 카드 하나의 상태를 서버 상태 + 큐 상태로 계산하는 순수 함수 (화면과 분리).
// 상태: todo(아직) · sending(요청 중) · waiting(부모 승인 대기) · done(완료) · rejected(거절됨, 다시 하기) · locked(지금은 못 함)
export function pendingKey(kind, id) {
  if (kind === 'mission') return 'mission:' + id;
  if (kind === 'extra') return 'req:' + id;
  return 'toggle:' + id; // base · optional
}

export function cardState(kind, id, s, pending) {
  if (pending.has(pendingKey(kind, id))) return 'sending';
  const bankrupt = s.status === 'bankrupt';
  const blocked = s.status !== 'ok';
  const checks = s.checks || {};

  if (kind === 'base' || kind === 'optional') {
    const done = id in checks;
    if (kind === 'base' && bankrupt) return 'locked';        // 파산이면 체크도 취소도 못 함
    if (kind === 'optional' && !done && blocked) return 'locked';
    return done ? 'done' : 'todo';
  }
  if (kind === 'extra') {
    if (id in checks) return 'done';
    if ((s.pending || []).some((r) => r.item_id === id && r.day === s.day)) return 'waiting';
    if (bankrupt) return 'locked';
    const last = (s.recent || []).find((r) => r.item_id === id && r.day === s.day); // recent 는 최신순
    return last && last.status === 'reject' ? 'rejected' : 'todo';
  }
  if (kind === 'mission') {
    const m = (s.missions || []).find((x) => String(x.id) === String(id));
    if (!m) return 'todo';
    if (m.status === 'done') return 'done';
    if (m.status === 'wait') return 'waiting';
    if (bankrupt) return 'locked';
    const last = (s.recent || []).find((r) => String(r.mission_id) === String(id));
    return last && last.status === 'reject' ? 'rejected' : 'todo';
  }
  return 'todo';
}
