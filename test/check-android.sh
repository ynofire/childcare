#!/usr/bin/env bash
# 안드로이드 셸 점검 (Gradle 빌드는 GitHub Actions 에서). 실패하면 이유를 출력하고 1 로 종료.
cd "$(dirname "$0")/.." || exit 1
fail=0
ok() { echo "OK   $1"; }
bad() { echo "FAIL $1"; fail=1; }

node -e '
const c=require("./capacitor.config.json");
const e=[];
if(c.appId!=="kr.ynofire.childcare")e.push("appId");
if(c.webDir!=="www")e.push("webDir");
if(!c.server||c.server.androidScheme!=="https")e.push("server.androidScheme");
if(e.length){console.error("bad: "+e.join(","));process.exit(1)}' 2>/dev/null && ok "capacitor.config.json" || bad "capacitor.config.json (appId/webDir/androidScheme)"

[ -f android/app/src/main/assets/public/index.html ] && ok "cap sync 결과(assets/public/index.html)" || bad "cap sync 결과 없음 (npx cap sync android)"
grep -q 'android.permission.INTERNET' android/app/src/main/AndroidManifest.xml 2>/dev/null && ok "INTERNET 권한" || bad "INTERNET 권한"
grep -q 'ANDROID_KEYSTORE_PATH' android/app/build.gradle 2>/dev/null && ok "release 서명이 환경변수를 읽음" || bad "build.gradle 서명 설정"
grep -q 'getenv\|System.getenv' android/app/build.gradle 2>/dev/null && ok "환경변수 사용" || bad "build.gradle 환경변수 사용"
python3 - <<'PY' && ok "워크플로 YAML 구문" || bad "워크플로 YAML 구문"
import sys, yaml
d = yaml.safe_load(open('.github/workflows/apk.yml', encoding='utf-8'))
on = d.get(True) or d.get('on')
assert 'push' in on and 'workflow_dispatch' in on, 'trigger'
steps = d['jobs']['build']['steps']
uses = ' '.join(s.get('uses', '') for s in steps)
for need in ('actions/setup-node@v4', 'actions/setup-java@v4', 'android-actions/setup-android@v3', 'actions/upload-artifact'):
    assert need in uses, need
PY
cmp -s node_modules/@capacitor/core/dist/index.js www/vendor/capacitor-core.js && ok "vendor/capacitor-core.js 가 설치된 @capacitor/core 와 같음" || bad "vendor/capacitor-core.js 가 오래됨 (npm run vendor)"
bad_keys=$(git ls-files | grep -E '\.(jks|keystore)$' || true)
[ -z "$bad_keys" ] && ok "서명 키 파일이 저장소에 없음" || bad "서명 키 파일이 추적됨: $bad_keys"
[ $fail -eq 0 ] && echo "ANDROID_CHECK_OK" || { echo "ANDROID_CHECK_FAILED"; exit 1; }
