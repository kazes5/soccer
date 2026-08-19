#!/usr/bin/env bash
# Uploads the current checkout and deploys the three Railway application
# services. Pair with stop-railway.sh, which removes their running deployments.
# Postgres and Redis are intentionally left untouched by both scripts.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
DEPLOY_MESSAGE="${RAILWAY_DEPLOY_MESSAGE:-Deploy current checkout with scripts/start-railway.sh}"
SERVICES=("@soccer/api" "@soccer/worker" "@soccer/web")
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

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "Warning: the working tree has uncommitted changes."
  echo "railway up uploads the current local files, including those changes."
fi

echo "==> Deploying the current checkout to Railway environment '$ENVIRONMENT'..."
for service in "${SERVICES[@]}"; do
  echo "==> Updating and starting $service..."
  railway up . \
    --service "$service" \
    --environment "$ENVIRONMENT" \
    --message "$DEPLOY_MESSAGE"
done

cat <<EOF

Railway application services are deployed in '$ENVIRONMENT':
  ${SERVICES[*]}

Postgres and Redis were left running and unchanged.
EOF
