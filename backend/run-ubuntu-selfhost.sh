#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

cd "${SCRIPT_DIR}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  source "${ENV_FILE}"
  set +a
fi

if [[ ! -d node_modules ]]; then
  echo "Dependencies not found. Run ./install-ubuntu-selfhost.sh first."
  exit 1
fi

echo "Starting Hydra self-host backend..."
npm start
