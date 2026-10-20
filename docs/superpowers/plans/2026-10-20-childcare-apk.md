# 가정 내 자본주의 APK 재구축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부모 폰·아들 폰이 Supabase로 동기화되는 Capacitor 안드로이드 앱(APK)을, 서버가 정답이고 아들 동작이 하나도 버려지지 않는 구조로 처음부터 다시 만든다.

**Architecture:** `www/`의 정적 ES 모듈 웹앱(빌드 도구 없음)을 Capacitor 셸이 감싼다. 상태는 서버 응답으로만 갱신하는 `store.js`(직렬 액션 큐 + 폴링)가 맡고, 화면은 store를 구독해 그린다. 서버는 기존 Supabase RPC 구조를 유지하고 `create or replace`로만 3개 함수를 바꾼다.

**Tech Stack:** 순수 JS(ES 모듈), Capacitor 8.x (`@capacitor/core|cli|android|app|share|haptics`), PostgreSQL 16(로컬 테스트), Node 22(`node:test`, `pg`), Playwright(Chromium), GitHub Actions(Java 17 + Android SDK).

**Spec:** `docs/superpowers/specs/2026-10-20-childcare-apk-design.md`

## Global Constraints

- 폴링 간격 **5초**(화면 켜진 동안), 앱 시작·복귀(`resume`/`visibilitychange`)·네트워크 복구·동작 직후에는 즉시 갱신.
- 터치 영역 **최소 56px**, 하단 탭 바는 안전 영역(`env(safe-area-inset-bottom)`) 반영. `alert`/`confirm`/`prompt` 사용 금지(앱 내 시트·토스트 사용).
- 연결 코드: **8글자**, 알파벳 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`(31자), 유효 **30분**, 1회용, 동시 유효 10개 제한 유지. 표시는 `ABCD-EFGH`, 입력은 영문/숫자 외 제거 + 대문자화.
- 미션은 날짜와 무관: `status <> 'done'` 이거나 만든 지 **3일 이내**인 완료 건. `recent`(처리된 요청)는 **2일 이내**.
- 서버 SQL은 **`drop` 없이 `create or replace`(시그니처 동일)만** 사용. 적용 후 `anon`만 실행 가능, `authenticated`·`public` 불가.
- 앱 ID `kr.ynofire.childcare`, 앱 이름 "가정 내 자본주의". 서명 키스토어는 **레포에 커밋 금지**(GitHub Secrets 4개: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`).
- 앱에는 Supabase URL·공개(publishable) 키 외 비밀 값을 넣지 않는다. 기기 열쇠는 WebView 로컬 저장소.
- 사용자 대상 문구는 전부 한국어. 레포는 공개.

## Review Focus

1. 연결 코드를 **소문자·공백·하이픈 섞어** 입력 → 정상 연결, 만료/재사용은 `invalid_invite` 안내 (Task 1, 4).
2. **자정을 넘기는 순간** 어제 화면이 열려 있는 앱 → 다음 갱신에서 오늘로 바뀌고 미완료 미션 유지 (Task 1, 5).
3. 부모가 **승인한 직후** 아들이 같은 심부름을 다시 요청 / 이미 대기 중인 요청 → `duplicate` 한글 안내 후 카드는 서버 상태로 (Task 5).
4. **열쇠가 해제된(revoke) 기기**가 동작을 보낼 때 → 큐 폐기 후 연결 화면으로 이동, 무한 재시도 없음 (Task 3, 5).
5. 미션 제목에 `<img onerror>`·매우 긴 글자·이모지, 금액 상한(10,000,000) 경계 → 이스케이프되고 레이아웃 유지, 서버 `invalid` 안내 (Task 5, 6).

---

## File Structure

```
supabase.sql                         (수정) 전체 스키마 v3 — build_state/issue_invite/redeem_invite 갱신
www/index.html                       셸 (viewport-fit=cover, <div id="app">, 모듈 로드)
www/css/app.css                      테마·탭 바·카드·시트·토스트
www/js/config.js                     SUPABASE_URL, SUPABASE_KEY, POLL_MS=5000
www/js/api.js                        rpc(), 오류코드→한글(ERR), errText()
www/js/store.js                      상태·액션 큐·폴링·복귀 갱신 (화면과 분리)
www/js/ui.js                         h() 렌더 헬퍼, esc, fmt, 날짜 도우미, toast, sheet, confirmSheet, haptic
www/js/lock.js                       PIN 잠금(PBKDF2) — 기존 기능 이식
www/js/app.js                        부팅, 역할 판별, 탭 라우팅
www/js/views/connect.js              연결 코드 입력 / 가족 만들기
www/js/views/child.js                아들 3탭(오늘·내역·설정)
www/js/views/parent.js               부모 4탭(현황·승인 / 정산 / 관리 / 설정)
test/sql/*.sql                       SQL 시나리오 (ALL_OK 규약)
test/run-sql.sh                      로컬 PG16 부트스트랩 + 시나리오 실행
test/shim/server.js                  PostgREST 호환 RPC 서버 + www 정적 서빙 + 테스트 훅
test/unit/*.test.js                  store/api 단위 테스트 (node:test)
test/e2e/*.spec.js                   Playwright 부모/아들 2기기 시나리오
capacitor.config.json, package.json, android/ (생성물 커밋)
.github/workflows/apk.yml            APK 빌드·릴리스
README.md                            설치·서명 키 등록·업데이트 방법
```

기존 `index.html`, `parent.html`, `child.html`, `common.js`는 Task 8에서 삭제한다(앱 전환 완료 시점).

---

### Task 1: 서버 v3 SQL (미션 노출·recent·짧은 연결 코드) + SQL 테스트 하네스

**Files:**
- Modify: `supabase.sql` (`private.build_state`, `public.issue_invite`, `public.redeem_invite`)
- Create: `test/run-sql.sh`, `test/sql/00_helpers.sql`, `test/sql/10_scenario_base.sql`, `test/sql/11_scenario_amounts.sql`, `test/sql/20_v3.sql`
- (기존 시나리오 2개는 작업 폴더 `scratchpad/cctest/scenario.sql`, `scenario_amounts.sql`에서 `test/sql/`로 복사)

**Interfaces:**
- Produces: `get_state(...)` 응답에 `missions`(날짜 무관 규칙, 항목 `{id,title,amount,status,day}`)와 새 키 `recent`(`[{id,item_id,mission_id,label,amount,status,decided_at}]`); `issue_invite(p_secret,p_role,p_label) -> text`(8글자 대문자, 하이픈 없음); `redeem_invite(p_code) -> {secret, role}`.
- Produces(테스트 전용): `test/sql/00_helpers.sql`이 `private.today()`를 `current_setting('app.fake_today', true)`가 있으면 그 날짜를 돌려주도록 덮어쓴다. **운영 `supabase.sql`에는 넣지 않는다.**

- [ ] **Step 1: 하네스 작성** — `test/run-sql.sh`: `/tmp/pgtest_cc`에 PG16 클러스터를 만들어 `extensions` 스키마·pgcrypto 준비 → `supabase.sql` 로드 → `00_helpers.sql` → `test/sql/[1-9]*.sql`을 차례로 실행하고, 각 파일의 마지막 `raise exception '<NAME>_OK'`를 성공으로 판정(다른 오류면 실패, 종료코드 ≠ 0). 로컬 PG 사용법은 지난 세션과 동일(`su postgres`, 포트 5544, 소켓 `/tmp/pgtest_cc`).
- [ ] **Step 2: 기존 시나리오 이식 실행** — `bash test/run-sql.sh` → `10_scenario_base`, `11_scenario_amounts` 모두 OK.
- [ ] **Step 3: 실패하는 신규 테스트** `test/sql/20_v3.sql` (끝에 `raise exception 'V3_OK'`), 단언:
  - `m1`: 오늘 `create_mission`한 뒤 `fake_today`를 +2일로 바꿔도 `get_state(child)->'missions'`에 `status='open'` 항목이 남는다.
  - `m2`: 어제(`p_day := 어제`)로 만든 미션도 아들의 오늘(`p_day := null`) 상태에 보인다.
  - `m3`: 승인(`done`)된 미션은 3일 안엔 보이고 `fake_today`+4일(생성 시각은 `created_at`를 직접 갱신해 시뮬레이션)에는 사라진다.
  - `r1`: 아이템 요청 승인 후 `recent`에 `status='done'`, 거절 후 `status='reject'`가 `decided_at` 내림차순으로 들어 있고, `decided_at`을 3일 전으로 돌리면 빠진다.
  - `i1`: `issue_invite`가 `^[A-HJKMNP-Z2-9]{8}$`에 맞는 코드를 반환하고 `expires_at ≈ now()+30분`(±1분).
  - `i2`: `redeem_invite(lower(substr(c,1,4)||'-'||substr(c,5)))`처럼 소문자·하이픈·앞뒤 공백이 섞여도 성공, 같은 코드 재사용은 `invalid_invite`, `expires_at`을 과거로 돌리면 `invalid_invite`, 7글자·`'0000000O'`(허용 안 되는 글자)는 `invalid_invite`.
  - `i3`: 유효 코드 10개 발급 뒤 11번째는 `busy`.
- [ ] **Step 4: 실패 확인** — `bash test/run-sql.sh` → `20_v3`이 `m1` 또는 `i1`에서 실패.
- [ ] **Step 5: 구현** (`supabase.sql`, 모두 `create or replace`, 시그니처 불변):
  - `private.build_state`: `missions` 서브쿼리의 `m.day = d` 조건을 `(m.status <> 'done' or m.created_at > now() - interval '3 days')`로 교체. 최상위에 `'recent'` 추가: `requests` 중 `status in ('done','reject') and decided_at > now() - interval '2 days'`, 최대 20건, `decided_at desc`.
  - `public.issue_invite`: 8글자 코드는 알파벳 31자에서 `get_byte(gen_random_bytes(8), i) % 31`로 뽑는다. 해시는 정규화된 대문자 코드로 저장, 만료 `interval '30 minutes'`.
  - `public.redeem_invite`: `norm := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'))`, `length(norm) <> 8`이면 `invalid_invite`, `norm`의 해시로 조회.
  - 파일 하단 grant 구문은 시그니처가 같으므로 그대로 둔다.
- [ ] **Step 6: 통과 확인** — `bash test/run-sql.sh` → 전부 OK. 이어서 권한 단언 추가 확인: `has_function_privilege('anon', ...)`는 true, `authenticated`는 false(20_v3 마지막에 포함).
- [ ] **Step 7: Commit** — `git add supabase.sql test && git commit -m "서버 v3: 미션 날짜 무관 노출, recent 목록, 8글자 연결 코드 + SQL 테스트 하네스"`

---

### Task 2: PostgREST 호환 테스트 서버(shim) + 정적 서빙 + 테스트 훅

**Files:**
- Create: `test/shim/server.js`, `test/unit/shim.test.js`, `package.json`(devDependencies: `pg`, `playwright-core`는 Task 3에서)

**Interfaces:**
- Produces: `startShim({ pgUrl, port=0, wwwDir }) -> Promise<{ url, close(), setFakeToday(date|null) }>`.
  - `POST /rest/v1/rpc/<fn>`: 본문 JSON의 키(`p_*`)를 **이름 있는 인자**로 `select public.<fn>(p_a := $1, ...)`에 바인딩(jsonb 인자는 `::jsonb`, 날짜는 `::date`는 PG가 추론). 성공 시 200 + 결과 JSON(스칼라/`null` 포함). 예외 시 **HTTP 400 + `{"message": <예외 메시지>}`**(PostgREST와 동일 규약). 알 수 없는 함수/인자는 404/`PGRST202` 형태.
  - 매 호출을 트랜잭션으로 감싸고 `set_config('app.fake_today', <값>, true)` 적용.
  - 응답에 `Access-Control-Allow-Origin: *`, `OPTIONS` 처리. `GET /*`는 `wwwDir` 정적 서빙.
- Consumes: Task 1의 로컬 PG(`test/run-sql.sh --keep`으로 DB 유지 모드 추가).

- [ ] **Step 1: 실패하는 테스트** `test/unit/shim.test.js` (`node:test`): ① `create_family` 호출이 `{secret}` 반환 ② 잘못된 열쇠로 `get_state` → 400 `{message:'unauthorized'}` ③ `setFakeToday('2030-01-02')` 후 `get_state(...).today === '2030-01-02'` ④ 정의되지 않은 인자 이름 → 4xx.
- [ ] **Step 2: 실패 확인** — `node --test test/unit/shim.test.js` (모듈 없음으로 FAIL).
- [ ] **Step 3: 구현** `startShim` (Node `http` + `pg` 풀). 응답 JSON 직렬화는 PG가 돌려준 jsonb를 그대로 사용.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: Commit** — `"테스트용 PostgREST 호환 서버(shim)"`

---

### Task 3: 앱 코어 — `api.js` + `store.js` (단위 테스트로 동작 고정)

**Files:**
- Create: `www/js/config.js`, `www/js/api.js`, `www/js/store.js`, `test/unit/store.test.js`

**Interfaces:**
- `api.js`: `export const ERR: Record<string,string>`; `export function errText(e): string`; `export function makeRpc({ url, key, fetchImpl=fetch, timeoutMs=15000 }): (fn: string, args?: object) => Promise<any>` — 실패 시 `Error`에 `code`(서버 메시지가 `ERR`에 있으면 그 값, 네트워크 문제면 `'offline'`, 그 외 `'error'`)와 `status`. `config.js`의 URL은 `globalThis.__CC_API__`가 있으면 그것을 우선.
- `store.js`: `export function createStore({ rpc, storage, pollMs=5000, now=Date.now }): Store`
  - `Store`: `state` (마지막 서버 상태 | null), `online: boolean`, `pending: Set<string>`(큐에 있거나 전송 중인 키), `subscribe(fn): unsubscribe`, `start(): void`, `stop(): void`, `refresh(): Promise<void>`, `setDay(day: string|null): Promise<void>`, `act(fn: string, args?: object, opts?: { key?: string }): Promise<{ ok: boolean, code?: string }>`, `signOutLocal(): void`.
  - 규칙: 모든 RPC 호출에 `p_secret`(storage `cc_secret_v2`)과 `p_day`(현재 보는 날짜)를 자동 첨부. 응답 `role`이 다르면 `onRoleMismatch` 구독 이벤트. 이벤트: `subscribe` 콜백은 `(state, meta)`를 받고 `meta.error`로 `{code, fromAction}`를 전달.
  - 큐: FIFO 직렬. `opts.key`가 같은 **전송 전** 항목은 새 args로 교체(이전 `act` Promise는 `{ok:true}`로 해결). 전송 중 항목은 합치지 않는다. 큐는 `storage` 키 `cc_queue_v1`에 JSON으로 보존하고 `start()` 때 복원.
  - 오류 처리: `offline` → 큐 유지 + `online=false` + 2초 간격 재시도; `unauthorized` → 큐 폐기, `signOutLocal()`, `meta.error.code='unauthorized'`; 그 외 → 해당 항목만 폐기, `{ok:false, code}` 반환, 직후 `refresh()`.
  - 갱신: 모든 응답에 단조 증가 요청 번호를 붙여 번호가 현재 적용된 것보다 작으면 폐기. `start()` 후 즉시 1회 + `pollMs`마다, `document` 가시성/`window` `online`/`focus` 이벤트는 `globalThis` 이벤트 타깃에 연결(테스트에서 주입 가능하도록 `env` 옵션 `{ doc, win }`).

- [ ] **Step 1: 실패하는 테스트** `test/unit/store.test.js` — 가짜 `rpc`(호출 기록·지연·실패 주입)와 메모리 `storage`로:
  - `s1 no-drop`: 느린 첫 `act` 처리 중에 서로 다른 key의 `act` 2개를 추가 → 3개 모두 **순서대로** `rpc`에 도달.
  - `s2 coalesce`: 전송 전 같은 key로 `toggle(on)→toggle(off)→toggle(on)` → 서버에는 마지막 한 번(`on`)만 가고 모든 Promise가 해결.
  - `s3 always-apply`: 서버 응답 상태가 직전과 **같아도** 구독자에게 `(state, meta)`가 다시 전달됨(화면이 항상 서버 상태로 재설정).
  - `s4 stale`: 먼저 보낸 `refresh` 응답이 나중 `act` 응답보다 늦게 도착하면 폐기.
  - `s5 offline-retry`: 첫 호출 `offline` → `online=false`, 큐 유지, 복구 후 자동 재전송되어 `ok:true`.
  - `s6 persist`: 오프라인 중 `act` 후 `stop()`, 새 store를 같은 storage로 `start()` → 큐가 복원되어 전송.
  - `s7 revoked`: `unauthorized` 응답 → 큐 비움, 열쇠 삭제, `meta.error.code==='unauthorized'`, 이후 재시도 없음.
  - `s8 reject`: `duplicate` 응답 → `{ok:false, code:'duplicate'}`, 다음 큐 항목은 계속 진행, 직후 `refresh` 호출.
  - `s9 auto-args`: 모든 호출에 `p_secret`, `p_day`(기본 null, `setDay('2026-10-16')` 후엔 그 값) 포함.
  - `s10 resume`: `visibilitychange`(visible)·`online`·`focus` 이벤트가 즉시 `refresh`를 일으킴, `pollMs` 간격으로 반복.
- [ ] **Step 2: 실패 확인** — `node --test test/unit/store.test.js` → FAIL(모듈 없음).
- [ ] **Step 3: 구현** `api.js`, `config.js`, `store.js` (위 인터페이스 그대로). `ERR` 맵은 기존 `common.js`의 항목을 이식하고 `invalid_day`, `busy`, `last_parent`, `offline` 포함.
- [ ] **Step 4: 통과 확인** — 같은 명령 전부 PASS.
- [ ] **Step 5: Commit** — `"앱 코어: api.js + 직렬 액션 큐 store.js"`

---

### Task 4: UI 킷 + 셸 + 연결 화면 + 라우터, E2E 하네스 (T1)

**Files:**
- Create: `www/index.html`, `www/css/app.css`, `www/js/ui.js`, `www/js/app.js`, `www/js/views/connect.js`, `test/e2e/harness.js`, `test/e2e/t01_connect.spec.js`
- Modify: `package.json` (scripts: `test:unit`, `test:sql`, `test:e2e`)

**Interfaces:**
- `ui.js`: `h(tag, attrs?, ...children): HTMLElement`(텍스트는 항상 `textContent`로, HTML 문자열 삽입 금지); `fmt(n): string`("+1,000P"); `fmtDate(ymd): string`("10/17(토)"); `addDays(ymd, n)`; `toast(msg, kind?)`; `openSheet({title, body, actions}): { close() }`; `confirmSheet(msg, { okText, danger }): Promise<boolean>`; `haptic(kind='light')`(Capacitor Haptics 있으면 사용, 없으면 무시).
- `app.js`: `boot()` — 열쇠 없으면 `connect` 화면, 있으면 `get_state`로 역할 판별 후 `child`/`parent` 뷰 마운트. 뷰 계약: `export function mount(root, { store, ui }): () => void`(반환값은 unmount).
- `connect.js`: 두 카드 — 연결 코드 입력(`redeem_invite`), 가족 만들기(`create_family`, 가족 이름·월 학원비). 성공 시 열쇠 저장 후 `boot()` 재호출.
- `test/e2e/harness.js`: `async function newWorld()` → 로컬 PG 기동·shim 시작·Chromium 실행, `parent`/`child` 두 `BrowserContext`(390×844, `isMobile`, 각자 별도 저장소)를 열어 `{ parent: Page, child: Page, shim, setFakeToday(d), teardown() }` 반환. 페이지에는 `addInitScript`로 `window.__CC_API__ = location.origin` 주입.

- [ ] **Step 1: 실패하는 E2E** `t01_connect.spec.js`: 부모 페이지에서 "우리 집 새로 시작하기" → 가족 만들기 → 부모 홈 표시(`[data-tab="home"]`) → 설정 탭의 "연결 코드 만들기" 버튼 → 표시된 코드(`ABCD-EFGH` 형식)를 읽어 아들 페이지의 입력칸에 **소문자·공백 섞어** 입력 → 아들 홈(`[data-tab="today"]`) 표시, 부모 설정의 기기 목록에 2대. 같은 코드를 재입력하면 한글 오류 토스트. (연결 코드 만들기 UI는 Task 6에서 완성되므로, 이 단계 테스트는 임시로 shim으로 `issue_invite`를 직접 호출해 코드를 얻고, Task 6 완료 시 UI 경로로 교체한다.)
- [ ] **Step 2: 실패 확인** — `npm run test:e2e -- t01` → FAIL.
- [ ] **Step 3: 구현** 셸·CSS·`ui.js`·`app.js`·`connect.js`. 디자인: 어두운 남색 배경 + 노란 강조, 56px 이상 버튼, 하단 탭 바 안전 영역. 시각 다듬기는 `frontend-design` 스킬 지침을 따른다.
- [ ] **Step 4: 통과 확인 + 스크린샷 점검** — E2E PASS, Playwright로 390×844 스크린샷을 저장해 레이아웃 확인.
- [ ] **Step 5: Commit** — `"UI 킷·셸·연결 화면 + E2E 하네스"`

---

### Task 5: 아들 화면 (오늘·내역·설정) — E2E T2~T7, T10

**Files:**
- Create: `www/js/views/child.js`, `test/e2e/t02_mission.spec.js`, `t03_midnight.spec.js`, `t04_rapid.spec.js`, `t05_decide.spec.js`, `t06_resume.spec.js`, `t07_offline.spec.js`, `t10_rules.spec.js`
- Modify: `www/css/app.css`

**Interfaces:**
- Consumes: `store.act('toggle_item', { p_item, p_on }, { key: 'toggle:'+id })`, `act('request_extra', { p_item })`, `act('request_mission', { p_mission })`, `act('consume', { p_item })`; 상태 키 `items/checks/missions/pending/recent/txs/status/today/day/start_date`.
- 카드 상태 계산 `cardState(kind, id, state, store.pending): 'todo'|'sending'|'waiting'|'done'|'rejected'|'locked'` — 화면 내부 순수 함수로 두고 단위 테스트(`test/unit/cardstate.test.js`)로 고정. `sending`은 `store.pending`에 키가 있는 동안, `waiting`은 `pending`(서버 대기 요청)에 있을 때, `rejected`는 `recent`에 해당 항목의 최신 `reject`가 있고 이후 요청이 없을 때.
- DOM 계약(E2E용): 카드 `[data-card="<id>"][data-state="<state>"]`, 탭 `[data-tab="today|history|settings"]`, NEW 배지 `[data-badge="new"]`, 연결 띠 `[data-net="offline"]`.

- [ ] **Step 1: 카드 상태 단위 테스트(실패)** `cardstate.test.js`: todo→sending→waiting→done, reject 후 `rejected`→다시 요청 시 `sending`, 파산·마이너스일 때 앞가림 `locked`, 이미 `checks`에 있으면 `done`.
- [ ] **Step 2: E2E 작성(실패)** — 각 파일의 단언:
  - **T2** 부모 페이지가 날짜를 **어제**로 보는 상태에서 `create_mission` 실행(부모 UI는 Task 6 전이므로 shim 직접 호출 후 Task 6에서 UI 경로로 교체) → 아들 페이지에 **5초 이내** 미션 카드 + NEW 배지, 아들이 오늘/어제 전환해도 미션 유지.
  - **T3** `setFakeToday(+1일)` 후 아들 화면의 `today`가 갱신되고 미완료 미션은 그대로, 완료 3일 경과분은 사라짐.
  - **T4** 같은 카드를 10번 연타 → 서버에 요청 1건(중복 없음)이고 카드는 `waiting`; 서로 다른 카드 3개를 100ms 간격으로 → 3건 모두 서버 반영, 사라지는 동작 없음. 앞가림 토글 on/off/on 빠르게 → 최종 on.
  - **T5** 아들 요청 → (부모 쪽은 shim 호출로 승인) → 아들 카드 `done` + 잔고 증가; 거절 → `rejected` + 다시 하기로 재요청 가능; 승인 직후 같은 심부름 재요청 → `duplicate` 토스트와 카드 `done` 유지.
  - **T6** 아들 페이지를 `hidden` → 서버 상태 변경 → `visible` 이벤트 → **1초 이내** 갱신.
  - **T7** Playwright `context.setOffline(true)` 상태에서 요청 누름 → `[data-net="offline"]` 표시 + 카드 `sending` 유지 → 온라인 복구 후 자동 전송되어 `waiting`; 오프라인 중 페이지 리로드 후에도 큐 복원되어 전송.
  - **T10** 잔고 -35,000으로 만들고(파산) 앞가림이 `locked`, 쓰기 버튼 사유 표시; 마이너스(-5,000)면 앞가림만 허용.
  - **Review Focus 4·5**: 부모가 기기 해제 → 아들이 동작 → 연결 화면으로 이동·무한 재시도 없음; 미션 제목 `<img src=x onerror=window.__xss=1>`·200자 제목·이모지는 텍스트로 표시되고 `window.__xss`가 undefined.
- [ ] **Step 3: 실패 확인** — `npm run test:unit && npm run test:e2e -- t02 t03 t04 t05 t06 t07 t10` → FAIL.
- [ ] **Step 4: 구현 `child.js`** — 오늘(잔고, 시킨 일, 앞가림, 심부름, 쓰기, 날짜 전환/선택), 내역, 설정(연결 확인·마지막 동기화·연결 해제는 `confirmSheet`). 카드 탭 시 `haptic()` + 즉시 `sending` 표시(store.pending 기반, 체크 표시를 임의로 켜지 않음). NEW 배지는 `localStorage cc_seen_v1`(마지막 본 미션/요청 id) 기준.
- [ ] **Step 5: 통과 확인** — 위 명령 전부 PASS + 아들 화면 스크린샷 점검.
- [ ] **Step 6: Commit** — `"아들 화면: 상태 카드, 시킨 일, 내역, 설정 + E2E T2~T7,T10"`

---

### Task 6: 부모 화면 (현황·승인 / 정산 / 관리 / 설정) + PIN 잠금 — E2E T1(UI경로)·T8·T9

**Files:**
- Create: `www/js/views/parent.js`, `www/js/lock.js`, `test/unit/lock.test.js`, `test/e2e/t08_settle.spec.js`, `t09_pin.spec.js`, `t11_parent_flow.spec.js`
- Modify: `test/e2e/t01_connect.spec.js`, `t02_mission.spec.js`, `t05_decide.spec.js`(shim 직접 호출을 부모 UI 조작으로 교체), `www/css/app.css`

**Interfaces:**
- `lock.js`: `export function createLock({ storage, session, subtle, now, relockMs=60000 }): { hasPin(): boolean, setPin(newPin, oldPin?): Promise<{ok, code?}>, removePin(oldPin): Promise<{ok, code?}>, unlock(pin): Promise<{ok, waitSec?, left?}>, isLocked(): boolean, lockNow(): void, onHidden(): void, onVisible(): void, forgot(): void }`. 저장은 `cc_pin_v2`(솔트+PBKDF2 10만 회 해시), 실패 카운터 `cc_pin_fail`(5회마다 30초×2^k, 최대 600초). PIN은 4~6자리 숫자. `forgot()`은 열쇠·PIN 삭제.
- `parent.js` DOM 계약: 탭 `[data-tab="home|settle|manage|settings"]`(승인 대기 건수 배지 `[data-badge="count"]`), 승인/거절 `[data-decide="<reqId>"][data-ok="1|0"]`, 정산 항목 `[data-fix="<itemId>"]`/`[data-amt="<itemId>"]`/`#mealSel`(3·2·1·0), 적용 `#applyBtn`, 미션 `#mTitle #mAmt #btnMission`, 연결 코드 `#btnInvite` → `[data-invite-code]`.
- Consumes: 기존 RPC 전부(`apply_fixed(p_secret,p_day,p_skip,p_meals,p_amounts)`, `adjust`, `set_academy`, `upsert_item`, `reset_day`, `reset_all`, `issue_invite`, `list_credentials`, `revoke_credential`).

- [ ] **Step 1: PIN 단위 테스트(실패)** `lock.test.js`: 설정→평문 미저장·해시 64자리, 변경/끄기는 현재 PIN 필요, 5회 오입력 시 30초 대기(대기 중 맞는 PIN도 거부), 대기 후 해제, 60초 이상 숨김 후 복귀 시 재잠금(30초는 유지), `forgot()`이 열쇠 삭제. (기존 `parent.html`의 동작을 그대로 고정)
- [ ] **Step 2: E2E 작성(실패)**:
  - **T8** 부모 정산 탭: 식비 선택지가 3·2·1·0, 숙박비 금액을 12,345로 수정·식비 3끼·학원비 제외 → 적용 → 아들 잔고/내역에 `숙박비 (직접 입력 12,345P)`, `식비 (3끼)` 반영; 소수·빈 값은 시트 안내 후 호출 없음; 같은 날 재적용은 변동 없음.
  - **T9** PIN 설정→앱 재시작 시 잠금 화면→오입력/대기→해제→60초 후 재잠금(`now` 주입 또는 가짜 타이머)→"PIN을 잊었어요"로 연결 해제.
  - **T11** 전체 부모 흐름: 부모가 어제 날짜에서 미션 만들기(UI) → 아들 5초 내 표시 → 아들 요청 → 부모 현황 탭 배지 1 → 승인(UI) → 아들 완료·잔고 증가. 연결 코드 만들기(UI)로 아들 연결(T1 UI 경로).
  - 미션 금액 10,000,001 → `invalid` 안내, 10,000,000은 성공.
- [ ] **Step 3: 실패 확인** — `npm run test:unit && npm run test:e2e -- t01 t08 t09 t11` → FAIL.
- [ ] **Step 4: 구현** `lock.js`, `parent.js`. 정산 입력칸은 폴링 갱신 중에도 값과 커서를 유지(입력 중 상태는 뷰 내부 `draft`에 보관). 위험 동작(초기화·기기 해제·전체 초기화)은 `confirmSheet`.
- [ ] **Step 5: 통과 확인** — 위 명령 + 앞서의 T2/T5 UI 경로 포함 전체 `npm test` PASS, 부모 화면 스크린샷 점검.
- [ ] **Step 6: Commit** — `"부모 화면 + PIN 잠금 + E2E T1,T8,T9,T11"`

---

### Task 7: Capacitor 셸 + GitHub Actions APK 빌드 + README

**Files:**
- Create: `capacitor.config.json`, `.github/workflows/apk.yml`, `README.md`, `android/`(생성물), `scripts/gen-keystore.sh`
- Modify: `package.json`, `www/js/app.js`(Capacitor `App` 플러그인 `resume`/`backButton` 연결, 없으면 무시), `android/app/build.gradle`(서명 설정이 환경변수에서 읽히도록)

**Interfaces:**
- `capacitor.config.json`: `appId: "kr.ynofire.childcare"`, `appName: "가정 내 자본주의"`, `webDir: "www"`, `server.androidScheme: "https"`.
- 워크플로 입력: `push` to `main`(경로 `www/**`, `android/**`, `capacitor.config.json`, `package*.json`) + `workflow_dispatch`. Secrets 4개가 있으면 `assembleRelease` + 서명, 없으면 `assembleDebug`. 산출물: Artifacts(항상), GitHub Release `v<run_number>`(Secrets 서명 빌드일 때).
- `scripts/gen-keystore.sh`: `keytool`로 키스토어 생성 → 사용자에게만 보이는 위치에 파일/값 출력(커밋 금지, `.gitignore`에 `*.jks`).

- [ ] **Step 1: 실패하는 점검 스크립트** `test/check-android.sh`: ① `capacitor.config.json`의 appId/webDir ② `android/app/src/main/assets/public/index.html` 존재(= `cap sync` 결과) ③ `android/app/src/main/AndroidManifest.xml`에 `INTERNET` 권한 ④ 워크플로 YAML 구문(`node -e` 로 yaml 파싱 또는 `actionlint` 대체로 python `yaml.safe_load`) ⑤ 레포에 `*.jks`/`*.keystore` 없음. 실행 → FAIL.
- [ ] **Step 2: 구현** — `npm i @capacitor/core @capacitor/app @capacitor/share @capacitor/haptics` + `npm i -D @capacitor/cli @capacitor/android`; `npx cap add android`; `npx cap sync android`; 앱 아이콘/이름 설정; `build.gradle`의 `signingConfigs.release`가 `ANDROID_KEYSTORE_PATH`/비밀번호 환경변수를 읽도록 수정; 워크플로 작성(`actions/setup-node@v4` Node 22, `actions/setup-java@v4` Java 17, `android-actions/setup-android@v3`, `./gradlew` 실행, Secrets 있으면 base64 복원).
- [ ] **Step 3: 통과 확인** — `bash test/check-android.sh` OK. (Gradle 실제 빌드는 이 환경에서 불가 — 워크플로 첫 실행은 Task 8에서 GitHub 로그로 확인.)
- [ ] **Step 4: README** — APK 내려받기·설치("출처를 알 수 없는 앱 허용"), Secrets 4개 등록 순서, 업데이트(덮어쓰기) 방법, 문제 해결.
- [ ] **Step 5: Commit** — `"Capacitor 안드로이드 셸 + APK 빌드 워크플로"`

---

### Task 8: 라이브 반영 — 서버 적용, 정리, 병합, 빌드 확인

**Files:**
- Modify: `supabase.sql`(최종본 확인), 삭제: `index.html`, `parent.html`, `child.html`, `common.js`, `favicon.svg`(새 앱 아이콘으로 대체되면 유지 여부 결정)

**Interfaces:** Consumes: 모든 이전 Task 산출물.

- [ ] **Step 1: 전체 테스트** — `npm test` (SQL + unit + E2E) 전부 PASS를 확인한다. 실패 시 이 Task를 진행하지 않는다.
- [ ] **Step 2: 라이브 DB 적용** — `mcp__Supabase__apply_migration`으로 Task 1의 세 함수(`build_state`, `issue_invite`, `redeem_invite`)만 `create or replace`로 적용(삭제 구문 없음). 승인 팝업에 막히면 SQL 파일(`upgrade_v3.sql`)을 사용자에게 전달해 SQL Editor에서 실행하게 한다.
- [ ] **Step 3: 라이브 검증** — `execute_sql`로 ① `anon`만 실행 가능(권한 쿼리) ② 롤백되는 `do $$ ... raise exception '...' $$` 블록으로 Task 1의 `20_v3` 핵심 단언(미션 날짜 무관, 연결 코드 발급·소문자 입력 사용·재사용 거절) 실행 ③ 테이블 모두 RLS 켜짐.
- [ ] **Step 4: 정리·병합** — 구 웹 파일 삭제 커밋, `apk-rebuild`를 `main`에 fast-forward 병합·푸시.
- [ ] **Step 5: 키스토어·Secrets** — `scripts/gen-keystore.sh`로 키스토어 생성, base64와 비밀번호를 사용자에게 전달(채팅에서만), 사용자가 Secrets 4개 등록.
- [ ] **Step 6: 첫 APK 빌드 확인** — 푸시로 시작된 워크플로가 성공하고 Artifacts/Release에 APK가 있는지 확인(저장소의 Actions 로그를 사용자가 열어 보거나, 가능한 경우 `gh run list`). 실패 시 로그를 근거로 수정 후 재푸시.
- [ ] **Step 7: 사용자 폰 체크리스트 전달** — 설계 문서 §12의 7개 항목.
- [ ] **Step 8: Commit/Push** — 이미 병합됨. 메모리/문서 갱신은 불필요.
