#!/usr/bin/env bash
# Reset a throwaway database, seed it, start the backend, run the API tests
# (and optionally the browser smoke test), then stop everything.
#
#   QA_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/majestronicz_qa qa/run.sh
#
# Settings (all optional):
#   QA_DATABASE_URL   throwaway database. ALL DATA IN IT IS DELETED. The name must contain "qa" or "test".
#   QA_PORT           backend port (default 4100)
#   QA_AUTH_SECRET    local signing secret for the test backend (default: a dummy local value)
#   QA_SMOKE=1        also start the frontend and run the Playwright smoke test
#   QA_FRONTEND_PORT  frontend port for the smoke test (default 5199)
#   QA_PLAYWRIGHT     path to playwright's index.mjs (default: the preinstalled one)
#   QA_TEST_FILTER    passed to node --test-name-pattern (e.g. "SAL3-1")
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA_DATABASE_URL="${QA_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/majestronicz_qa}"
QA_PORT="${QA_PORT:-4100}"
QA_AUTH_SECRET="${QA_AUTH_SECRET:-local-qa-dummy-secret-0123456789}"
QA_SMOKE="${QA_SMOKE:-0}"
QA_FRONTEND_PORT="${QA_FRONTEND_PORT:-5199}"
LOG_DIR="${QA_LOG_DIR:-$ROOT/qa/.logs}"
mkdir -p "$LOG_DIR"

# Safety: this script wipes the database. Refuse anything that does not look like a test database.
DB_NAME="${QA_DATABASE_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
case "$DB_NAME" in
  *qa*|*test*) ;;
  *) echo "Refusing to reset database '$DB_NAME': the name must contain 'qa' or 'test'." >&2; exit 2 ;;
esac
case "$QA_DATABASE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) [ "${QA_ALLOW_REMOTE_DB:-0}" = "1" ] || { echo "Refusing a non-local database (set QA_ALLOW_REMOTE_DB=1 to override)." >&2; exit 2; } ;;
esac

# Never pick up a developer's backend/.env (it may hold real keys or a production URL).
export DOTENV_CONFIG_PATH="$ROOT/qa/.no-dotenv"

PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
}
trap cleanup EXIT

wait_for() { # url, seconds
  for _ in $(seq 1 "$2"); do
    curl -fsS -o /dev/null "$1" 2>/dev/null && return 0
    sleep 1
  done
  echo "Timed out waiting for $1" >&2
  return 1
}

echo "==> Preparing backend dependencies"
cd "$ROOT/backend"
[ -d node_modules ] || npm ci --no-audit --no-fund
npx prisma generate >/dev/null

echo "==> Resetting and seeding $DB_NAME"
DATABASE_URL="$QA_DATABASE_URL" npx prisma db push --force-reset --skip-generate --accept-data-loss >"$LOG_DIR/db-push.log" 2>&1
DATABASE_URL="$QA_DATABASE_URL" AUTH_SECRET="$QA_AUTH_SECRET" npm run seed >"$LOG_DIR/seed.log" 2>&1

echo "==> Starting backend on port $QA_PORT"
CORS="http://127.0.0.1:$QA_FRONTEND_PORT,http://localhost:$QA_FRONTEND_PORT"
DATABASE_URL="$QA_DATABASE_URL" PORT="$QA_PORT" AUTH_SECRET="$QA_AUTH_SECRET" CORS_ORIGINS="$CORS" \
  node_modules/.bin/tsx src/index.ts >"$LOG_DIR/backend.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:$QA_PORT/api/health" 60

echo "==> Running API tests"
cd "$ROOT"
set +e
FILTER_ARGS=()
[ -n "${QA_TEST_FILTER:-}" ] && FILTER_ARGS=(--test-name-pattern="$QA_TEST_FILTER")
QA_API_URL="http://127.0.0.1:$QA_PORT" QA_AUTH_SECRET="$QA_AUTH_SECRET" DATABASE_URL="$QA_DATABASE_URL" \
  node --test --test-concurrency=1 "${FILTER_ARGS[@]}" qa/api/*.test.mjs 2>&1 | tee "$LOG_DIR/api-tests.tap"
API_STATUS=${PIPESTATUS[0]}
set -e

SMOKE_STATUS=0
if [ "$QA_SMOKE" = "1" ]; then
  echo "==> Starting frontend on port $QA_FRONTEND_PORT"
  [ -d node_modules ] || npm ci --no-audit --no-fund
  VITE_API_URL="http://127.0.0.1:$QA_PORT" node_modules/.bin/vite --port "$QA_FRONTEND_PORT" --strictPort --host 127.0.0.1 \
    >"$LOG_DIR/frontend.log" 2>&1 &
  PIDS+=($!)
  wait_for "http://127.0.0.1:$QA_FRONTEND_PORT/" 60
  echo "==> Running browser smoke test"
  set +e
  QA_FRONTEND_URL="http://127.0.0.1:$QA_FRONTEND_PORT" QA_API_URL="http://127.0.0.1:$QA_PORT" QA_SHOTS="$LOG_DIR" \
    node qa/smoke/smoke.mjs 2>&1 | tee "$LOG_DIR/smoke.log"
  SMOKE_STATUS=${PIPESTATUS[0]}
  set -e
fi

echo "==> API tests exit code: $API_STATUS; smoke exit code: $SMOKE_STATUS (logs in $LOG_DIR)"
[ "$API_STATUS" -eq 0 ] && [ "$SMOKE_STATUS" -eq 0 ]
