#!/usr/bin/env bash
# Stops the three Railway application services by removing their latest
# successful deployments. The services remain configured and can be restored
# with start-railway.sh. Postgres and Redis are intentionally left running.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
SERVICES=("@soccer/web" "@soccer/worker" "@soccer/api")
FAILED_SERVICES=()
cd "$ROOT_DIR"

if ! command -v railway >/dev/null 2>&1; then
  echo "Railway CLI is not installed. Install it, then run 'railway login' and 'railway link'."
  echo "See: https://docs.railway.com/guides/cli"
  exit 1
fi

if ! railway status >/dev/null 2>&1; then
  echo "This checkout is not authenticated and linked to the Railway project."
  echo "Run 'railway login' and 'railway link', then try again."
  exit 1
fi

echo "==> Stopping Railway application services in environment '$ENVIRONMENT'..."
for service in "${SERVICES[@]}"; do
  echo "==> Stopping $service..."
  if ! railway down \
    --service "$service" \
    --environment "$ENVIRONMENT" \
    --yes; then
    FAILED_SERVICES+=("$service")
  fi
done

if [ "${#FAILED_SERVICES[@]}" -gt 0 ]; then
  echo
  echo "Railway could not stop: ${FAILED_SERVICES[*]}"
  echo "The other application services were still processed. Check 'railway status' before retrying."
  exit 1
fi

cat <<EOF

Railway application services are stopped in '$ENVIRONMENT'.
Their service configuration is preserved; run scripts/start-railway.sh to
upload the current checkout and start them again.

Postgres and Redis remain running and their data was not touched.
EOF
