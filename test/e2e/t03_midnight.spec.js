// T3: 자정을 넘겨도(서버 '오늘'이 바뀌어도) 열려 있던 아들 화면이 오늘로 갱신되고 미완료 미션은 남는다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w, keys;
before(async () => { w = await newWorld(); keys = await w.seedFamily(); });
after(async () => { await w.teardown(); });

test('t03 자정을 넘기면 오늘 라벨이 바뀌고 미완료 미션은 유지된다', async () => {
  const { child } = w;
  await w.rpc('create_mission', { p_secret: keys.parentSecret, p_title: '숙제 끝내기', p_amount: 5000 });
  const mission = child.locator('[data-section="missions"] [data-card]', { hasText: '숙제 끝내기' });
  await mission.waitFor();
  const today = w.kstToday(), tomorrow = w.addDays(today, 1);
  const label = async () => child.locator('#segT').innerText();
  assert.match(await label(), new RegExp(`${Number(today.slice(5, 7))}/${Number(today.slice(8))}\\(`));

  w.setFakeToday(tomorrow);
  await child.waitForFunction((t) => document.querySelector('#segT')?.textContent.includes(t), `${Number(tomorrow.slice(5, 7))}/${Number(tomorrow.slice(8))}(`, { timeout: 5000 });
  await mission.waitFor();
  assert.equal(await mission.getAttribute('data-state'), 'todo');
  // 어제 버튼은 이제 '원래의 오늘'을 가리킨다
  assert.match(await child.locator('#segY').innerText(), new RegExp(`${Number(today.slice(5, 7))}/${Number(today.slice(8))}\\(`));
  assert.deepEqual(w.errors, []);
});
