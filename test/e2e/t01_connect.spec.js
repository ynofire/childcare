// T1: 가족 만들기 → 연결 코드 → 아들 폰 연결 (연결 코드는 소문자·공백·하이픈을 섞어 입력)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld } from './harness.js';

let w;
before(async () => { w = await newWorld(); });
after(async () => { await w.teardown(); });

test('t01 가족 만들기 → 연결 코드 → 아들 연결, 재사용·오타는 한글 안내', async () => {
  const { parent, child } = w;
  await parent.goto(w.url + '/');
  await parent.locator('#fname').fill('우리 가족');
  await parent.locator('#facad').fill('300000');
  await parent.locator('#btnCreate').click();
  await parent.locator('[data-tab="home"]').waitFor();

  const parentSecret = await w.secretOf(parent);
  assert.match(parentSecret, /^[0-9a-f]{48}$/);
  await parent.locator('[data-tab="settings"]').click();
  await parent.locator('#invLabel').fill('아들폰');
  await parent.locator('#btnInvite').click();
  const shown = (await parent.locator('[data-invite-code]').innerText()).trim();
  assert.match(shown, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  const code = shown.replace('-', '');

  await child.goto(w.url + '/');
  const sloppy = ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()} `;
  await child.locator('#code').fill(sloppy);
  await child.locator('#btnJoin').click();
  await child.locator('[data-tab="today"]').waitFor();
  assert.match(await w.secretOf(child), /^[0-9a-f]{48}$/);

  const creds = await w.rpc('list_credentials', { p_secret: parentSecret });
  assert.equal(creds.filter((x) => !x.revoked).length, 2);

  // 같은 코드를 다른 폰에서 다시 쓰면 한글 안내
  const other = await w.newPhone('other');
  await other.page.goto(w.url + '/');
  await other.page.locator('#code').fill(code);
  await other.page.locator('#btnJoin').click();
  await other.page.locator('.toast').first().waitFor();
  assert.match(await other.page.locator('.toast').first().innerText(), /연결 코드가 틀렸거나 만료/);
  assert.equal(await w.secretOf(other.page), null);

  // 코드 형식이 아닌 입력은 서버에 보내지 않고 안내
  await other.page.locator('#code').fill('abc');
  await other.page.locator('#btnJoin').click();
  await other.page.locator('.toast', { hasText: '8글자' }).first().waitFor();

  assert.deepEqual(w.errors, [], '브라우저 오류 없음');
});
