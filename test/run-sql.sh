#!/usr/bin/env bash
# 로컬 PostgreSQL 16 에 supabase.sql 을 올리고 test/sql/*.sql 시나리오를 실행한다.
#   bash test/run-sql.sh          # DB 기동 → 스키마 로드 → 시나리오 실행 → 종료
#   bash test/run-sql.sh up       # DB 기동 + 스키마 로드만 (E2E 용, 켜 둔 채로 둠)
#   bash test/run-sql.sh down     # DB 종료·삭제
# 각 시나리오는 마지막에 `raise exception '<NAME>_OK'` 로 성공을 알린다(롤백 목적).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D=/tmp/pgtest_cc; PORT=5544
PGB="$(ls -d /usr/lib/postgresql/*/bin | head -1)"
PSQL=("$PGB/psql" -h "$D" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)

pg_down() {
  if [ -d "$D/data" ]; then su postgres -c "$PGB/pg_ctl -D $D/data stop -m fast" >/dev/null 2>&1; fi
  rm -rf "$D"
}
pg_up() {
  pg_down
  mkdir -p "$D" && chown postgres "$D" && chmod 755 "$D"
  su postgres -c "$PGB/initdb -D $D/data -U postgres --auth=trust" >/dev/null || return 1
  su postgres -c "$PGB/pg_ctl -D $D/data -o '-p $PORT -k $D -c listen_addresses=' -l $D/log -w start" >/dev/null || return 1
  "${PSQL[@]}" -d postgres -c "create database cc" || return 1
  "${PSQL[@]}" -d cc -c "create schema extensions; create extension pgcrypto with schema extensions;" || return 1
  # Supabase 가 기본 제공하는 역할을 흉내낸다 (역할은 클러스터 전역이라 새 클러스터에서만 만들면 됨)
  "${PSQL[@]}" -d postgres -c "create role anon nologin; create role authenticated nologin;" || return 1
  "${PSQL[@]}" -d cc -f "$ROOT/supabase.sql" >/dev/null || return 1
  "${PSQL[@]}" -d cc -f "$ROOT/test/sql/00_helpers.sql" || return 1
}

case "${1:-test}" in
  down) pg_down; exit 0 ;;
  up)   pg_up || { echo "DB 기동 실패"; exit 1; }; echo "DB ready: socket=$D port=$PORT db=cc"; exit 0 ;;
esac

pg_up || { echo "DB 기동 실패"; exit 1; }
fail=0
for f in "$ROOT"/test/sql/[1-9]*.sql; do
  out="$("${PSQL[@]}" -d cc -f "$f" 2>&1)"
  if echo "$out" | grep -Eq 'ERROR:  [A-Z0-9_]+_OK'; then
    echo "PASS $(basename "$f")"
  else
    echo "FAIL $(basename "$f")"; echo "$out" | grep -E 'ERROR|CONTEXT|ASSERT' | head -5; fail=1
  fi
done
[ "${KEEP:-0}" = 1 ] || pg_down
exit $fail
