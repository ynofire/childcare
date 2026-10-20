// 설정 탭: 기기 연결(코드 만들기·목록·해제) · 복구 코드 · 화면 잠금(PIN) · 초기화
import { storage, SECRET_KEY } from '../storage.js';
import { plugin } from '../native.js';

const secret = () => storage.getItem(SECRET_KEY) || '';
const validPin = (v) => /^[0-9]{4,6}$/.test(String(v || ''));
const prettyCode = (c) => c.slice(0, 4) + '-' + c.slice(4);

export const pinCardHooks = {
  async refreshCreds(ctx) {
    try { ctx.drafts.creds = await ctx.rpc('list_credentials', { p_secret: secret() }); ctx.draw(); } catch (e) { /* 목록은 없어도 됨 */ }
  },
};

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}
async function shareText(text) {
  const S = plugin('Share');
  try {
    if (S && S.share) { await S.share({ text, dialogTitle: '연결 코드 보내기' }); return true; }
    if (navigator.share) { await navigator.share({ text }); return true; }
  } catch (e) { /* 사용자가 닫음 */ }
  return false;
}

export function settingsTab(ctx, s) {
  const { ui, drafts, lock, store, rpc, errText } = ctx;
  const { h, toast, confirmSheet, fmtDate } = ui;

  async function makeInvite(role) {
    try {
      const code = await rpc('issue_invite', { p_secret: secret(), p_role: role, p_label: (drafts.v.invLabel || '').trim() });
      drafts.invite = { code, role, at: Date.now() };
      drafts.v.invLabel = '';
      ctx.draw(); pinCardHooks.refreshCreds(ctx);
    } catch (e) { toast(errText(e), 'err'); }
  }
  async function revoke(c) {
    const ok = await confirmSheet(`"${c.label}" 기기의 연결을 해제할까요?`, { okText: '해제', danger: true });
    if (!ok) return;
    try { await rpc('revoke_credential', { p_secret: secret(), p_id: c.id }); toast('연결을 해제했어요', 'ok'); } catch (e) { toast(errText(e), 'err'); }
    pinCardHooks.refreshCreds(ctx);
  }
  function seen(c) {
    if (!c.last_seen_at) return '접속 기록 없음';
    const m = Math.round((Date.now() - Date.parse(c.last_seen_at)) / 60000);
    return m < 2 ? '방금 전 접속' : m < 60 ? m + '분 전 접속' : m < 1440 ? Math.round(m / 60) + '시간 전 접속' : Math.round(m / 1440) + '일 전 접속';
  }

  // --- PIN ---
  async function savePin() {
    const old = String(drafts.v.pinOld || '').trim(), a = String(drafts.v.pinNew || '').trim(), b = String(drafts.v.pinNew2 || '').trim();
    const had = lock.hasPin();
    if (!validPin(a)) drafts.pinMsg = 'PIN은 4~6자리 숫자예요.';
    else if (a !== b) drafts.pinMsg = '새 PIN 두 칸이 달라요.';
    else {
      const r = await lock.setPin(a, old);
      if (r.ok) { for (const k of ['pinOld', 'pinNew', 'pinNew2']) drafts.v[k] = ''; drafts.pinMsg = had ? 'PIN을 바꿨어요.' : '화면 잠금을 켰어요. 앱을 닫거나 1분 이상 다른 화면에 있다 오면 PIN을 물어요.'; }
      else drafts.pinMsg = r.code === 'wrong_old' ? '현재 PIN이 맞지 않아요.' : '이 기기에서는 잠금을 켤 수 없어요.';
    }
    ctx.draw();
  }
  async function offPin() {
    const r = await lock.removePin(String(drafts.v.pinOld || '').trim());
    if (r.ok) { drafts.v.pinOld = ''; drafts.pinMsg = '화면 잠금을 껐어요.'; } else drafts.pinMsg = '현재 PIN을 입력해야 끌 수 있어요.';
    ctx.draw();
  }
  const pinOn = lock.hasPin();
  const pinInput = (k, ph, label) => ctx.input(k, { type: 'password', inputmode: 'numeric', maxlength: '6', autocomplete: 'off', placeholder: ph, 'aria-label': label, id: k });

  const inv = drafts.invite;
  const creds = (drafts.creds || []).filter((c) => !c.revoked);
  return [
    h('section', { class: 'card', 'data-section': 'devices' },
      h('h2', {}, '기기 연결'),
      h('p', { class: 'muted' }, '연결할 폰에서 앱을 열고 이 코드를 입력하면 돼요. 코드는 30분 안에 한 번만 쓸 수 있어요.'),
      h('label', { class: 'field' }, h('span', {}, '기기 이름 (선택)'), ctx.input('invLabel', { id: 'invLabel', maxlength: '30', placeholder: '예: 아들 폰' })),
      h('div', { class: 'row2' },
        h('button', { id: 'btnInvite', class: 'btn primary', type: 'button', onclick: () => makeInvite('child') }, '아들 폰 코드'),
        h('button', { id: 'btnInviteParent', class: 'btn ghost', type: 'button', onclick: () => makeInvite('parent') }, '부모 폰 코드')),
      inv ? h('div', { class: 'invite' },
        h('div', { class: 'invite-code', 'data-invite-code': inv.code }, prettyCode(inv.code)),
        h('div', { class: 'muted' }, (inv.role === 'child' ? '아들 폰용' : '부모 폰용') + ' · 30분 안에 한 번만'),
        h('div', { class: 'row2' },
          h('button', { id: 'btnCopy', class: 'btn small', type: 'button', onclick: async () => toast((await copyText(prettyCode(inv.code))) ? '복사했어요' : '복사하지 못했어요. 코드를 직접 적어 주세요.', 'info') }, '복사'),
          h('button', { id: 'btnShare', class: 'btn small ghost', type: 'button', onclick: async () => { if (!(await shareText('가정 내 자본주의 연결 코드: ' + prettyCode(inv.code) + ' (30분 안에 한 번만 쓸 수 있어요)'))) toast('공유하지 못했어요. 코드를 직접 알려 주세요.', 'info'); } }, '공유'))) : null,
      h('h3', { class: 'sub-h' }, '연결된 기기'),
      creds.length ? h('ul', { class: 'tx-list' }, creds.map((c) => h('li', { class: 'tx', 'data-cred': c.id },
        h('span', { class: 'tx-l' }, c.label, c.is_me ? h('small', { class: 'me' }, ' (이 기기)') : null, h('br'), h('small', { class: 'muted' }, (c.role === 'parent' ? '부모' : '아들') + ' · ' + seen(c))),
        c.is_me ? null : h('button', { class: 'btn small ghost', type: 'button', 'data-revoke': c.id, onclick: () => revoke(c) }, '해제')))) : h('p', { class: 'muted' }, '불러오는 중…')),

    h('section', { class: 'card' },
      h('h2', {}, '복구 코드'),
      h('p', { class: 'muted' }, '폰을 잃어버리거나 바꿀 때, 새 폰의 연결 화면에 이 코드를 넣으면 부모 기기로 다시 연결돼요. 남에게 보여주지 말고 안전한 곳에 적어 두세요.'),
      drafts.recovery ? h('input', { id: 'recoveryText', class: 'input mono', readonly: true, value: secret(), onclick: (e) => e.target.select(), 'aria-label': '복구 코드' }) : null,
      h('button', { id: 'btnRecovery', class: 'btn ghost', type: 'button', onclick: async () => {
        if (drafts.recovery) { drafts.recovery = false; ctx.draw(); return; }
        const ok = await confirmSheet('복구 코드를 화면에 보여줄까요? 옆에 다른 사람이 없는지 확인하세요.', { okText: '보여주기' });
        if (ok) { drafts.recovery = true; ctx.draw(); }
      } }, drafts.recovery ? '복구 코드 숨기기' : '복구 코드 보기')),

    h('section', { class: 'card' },
      h('h2', {}, '화면 잠금 (PIN) ', h('span', { class: 'pill', id: 'pinState' }, pinOn ? '켜짐' : '꺼짐')),
      h('p', { class: 'muted' }, '이 폰에서 부모 화면을 열 때 PIN을 물어요. 기기마다 따로 설정해요. (4~6자리 숫자)'),
      pinOn ? h('label', { class: 'field' }, h('span', {}, '현재 PIN'), pinInput('pinOld', '현재 PIN', '현재 PIN')) : null,
      h('label', { class: 'field' }, h('span', {}, pinOn ? '새 PIN' : 'PIN'), pinInput('pinNew', pinOn ? '새 PIN' : 'PIN (4~6자리)', '새 PIN')),
      h('label', { class: 'field' }, h('span', {}, '한 번 더'), pinInput('pinNew2', '한 번 더', '새 PIN 확인')),
      h('div', { class: 'row2' },
        h('button', { id: 'pinSave', class: 'btn', type: 'button', onclick: savePin }, pinOn ? 'PIN 변경' : 'PIN 설정'),
        pinOn ? h('button', { id: 'pinOff', class: 'btn ghost', type: 'button', onclick: offPin }, '잠금 끄기') : null),
      h('div', { id: 'pinMsg', class: 'pin-msg muted', role: 'status' }, drafts.pinMsg || 'PIN을 잊으면 이 기기의 연결을 해제하고 복구 코드로 다시 연결해야 해요.')),

    h('section', { class: 'card danger-zone' },
      h('h2', {}, '초기화'),
      h('button', { id: 'btnResetDay', class: 'btn ghost', type: 'button', onclick: async () => {
        const ok = await confirmSheet(`${fmtDate(s.day)}에 적용·체크된 항목을 모두 되돌릴까요? (잔고도 함께 되돌아가요)`, { okText: '되돌리기', danger: true });
        if (ok) store.act('reset_day', {}).then((r) => { if (r.ok) toast(fmtDate(s.day) + ' 기록을 되돌렸어요', 'ok'); });
      } }, fmtDate(s.day) + ' 기록 되돌리기'),
      h('button', { id: 'btnResetAll', class: 'btn danger', type: 'button', onclick: async () => {
        const a = await confirmSheet('잔고·내역·승인 기록·미션을 모두 지울까요? 되돌릴 수 없어요.', { okText: '계속', danger: true });
        if (!a) return;
        const b = await confirmSheet('정말 전체를 초기화할까요? 항목과 학원비 설정만 남아요.', { okText: '전체 초기화', danger: true });
        if (b) store.act('reset_all', {}).then((r) => { if (r.ok) toast('전체를 초기화했어요', 'ok'); });
      } }, '전체 초기화'))];
}
