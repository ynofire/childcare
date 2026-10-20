#!/usr/bin/env bash
# 릴리스 서명 키를 새로 만든다. 같은 키로 서명해야 앱을 지우지 않고 덮어쓰기 업데이트가 된다.
# 사용: bash scripts/gen-keystore.sh [출력 폴더]   (기본: ~/childcare-keystore — 저장소 바깥이어야 한다)
# 출력되는 4개 값을 GitHub 저장소 Settings > Secrets and variables > Actions 에 등록하세요. 키 파일은 안전한 곳에 백업!
set -euo pipefail
OUT="${1:-$HOME/childcare-keystore}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
case "$OUT/" in "$REPO"/*) echo "저장소 안에는 키를 만들 수 없어요: $OUT" >&2; exit 1;; esac
command -v keytool >/dev/null || { echo "keytool(JDK)이 필요해요." >&2; exit 1; }
[ -e "$OUT/childcare.jks" ] && { echo "이미 있어요: $OUT/childcare.jks (덮어쓰지 않습니다)" >&2; exit 1; }
PASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
keytool -genkeypair -v -keystore "$OUT/childcare.jks" -storetype PKCS12 -alias childcare \
  -keyalg RSA -keysize 2048 -validity 36500 -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=childcare, O=ynofire, C=KR" >/dev/null 2>&1
chmod 600 "$OUT/childcare.jks"
echo "키 파일: $OUT/childcare.jks  (절대 커밋하지 마세요)"
echo
echo "ANDROID_KEYSTORE_PASSWORD = $PASS"
echo "ANDROID_KEY_ALIAS         = childcare"
echo "ANDROID_KEY_PASSWORD      = $PASS"
echo "ANDROID_KEYSTORE_BASE64   = (아래 한 줄 전체)"
base64 -w0 "$OUT/childcare.jks" 2>/dev/null || base64 "$OUT/childcare.jks" | tr -d '\n'
echo
