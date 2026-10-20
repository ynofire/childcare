// 처음 실행 화면: ① 연결 코드로 들어가기(아들·아내 폰) ② 우리 집 새로 시작하기(부모)
import { SECRET_KEY, storage } from '../storage.js';
import { errText } from '../api.js';

// 영문/숫자만 남기고 대문자로 맞춘다 (소문자·공백·하이픈을 섞어 입력해도 연결되게)
export function normalizeCode(text) { return String(text || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }

export function mountConnect(root, { rpc, ui, onConnected, notice }) {
  const { h, toast } = ui;
  let busy = false;

  async function run(btn, job) {
    if (busy) return;
    busy = true; btn.disabled = true;
    try { await job(); } catch (e) { toast(errText(e), 'err'); } finally { busy = false; btn.disabled = false; }
  }
  function keep(secret) {
    storage.setItem(SECRET_KEY, secret);
    if (storage.getItem(SECRET_KEY) !== secret) throw Object.assign(new Error('storage'), { code: 'error' });
  }

  const code = h('input', { id: 'code', class: 'input code-input', placeholder: 'ABCD-EFGH', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '20', 'aria-label': '연결 코드' });
  const btnJoin = h('button', { id: 'btnJoin', class: 'btn kid', type: 'button' }, '연결하기');
  btnJoin.onclick = () => {
    const norm = normalizeCode(code.value);
    if (norm.length !== 8) { toast('연결 코드는 8글자예요. 부모님 화면의 코드를 확인해 주세요.', 'err'); return; }
    run(btnJoin, async () => {
      const res = await rpc('redeem_invite', { p_code: norm });
      keep(res.secret);
      onConnected();
    });
  };
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnJoin.click(); });

  const fname = h('input', { id: 'fname', class: 'input', value: '우리 가족', maxlength: '30', 'aria-label': '가족 이름' });
  const facad = h('input', { id: 'facad', class: 'input', type: 'number', inputmode: 'numeric', value: '300000', min: '0', 'aria-label': '월 학원비' });
  const btnCreate = h('button', { id: 'btnCreate', class: 'btn primary', type: 'button' }, '가족 만들기');
  btnCreate.onclick = () => run(btnCreate, async () => {
    const acad = Math.max(0, parseInt(facad.value, 10) || 0);
    const res = await rpc('create_family', { p_name: fname.value.trim() || '우리 가족', p_academy: acad, p_opening: 0 });
    keep(res.secret);
    storage.setItem('cc_welcome', '1');
    onConnected();
  });

  const view = h('main', { class: 'connect' },
    h('header', { class: 'brand' },
      h('img', { src: 'icon.svg', alt: '', width: '56', height: '56' }),
      h('h1', {}, '가정 내 자본주의'),
      h('p', { class: 'muted' }, '용돈과 집안일을 우리 집 장부에 기록해요')),
    notice ? h('div', { class: 'notice' }, notice) : null,
    h('section', { class: 'card' },
      h('h2', {}, '연결 코드로 들어가기'),
      h('p', { class: 'muted' }, '부모님 앱의 설정에서 만든 코드를 입력하세요. 30분 안에 한 번만 쓸 수 있어요.'),
      code, btnJoin),
    h('section', { class: 'card' },
      h('h2', {}, '우리 집 새로 시작하기'),
      h('p', { class: 'muted' }, '부모가 한 번만 만들어요. 이 폰이 부모 기기가 되고, 아들·아내 폰은 코드로 연결해요.'),
      h('label', { class: 'field' }, h('span', {}, '가족 이름'), fname),
      h('label', { class: 'field' }, h('span', {}, '월 학원비 (원)'), facad),
      btnCreate));
  root.replaceChildren(view);
  return () => root.replaceChildren();
}
