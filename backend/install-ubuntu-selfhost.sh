#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  SUDO="sudo"
else
  SUDO=""
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer supports Ubuntu/Debian systems with apt-get."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

echo "Updating apt package index..."
$SUDO apt-get update -y

echo "Installing required base packages..."
$SUDO apt-get install -y curl ca-certificates gnupg

NEEDS_NODE_INSTALL=0
if ! command -v node >/dev/null 2>&1; then
  NEEDS_NODE_INSTALL=1
else
  NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [[ -z "${NODE_MAJOR}" || "${NODE_MAJOR}" -lt 20 ]]; then
    NEEDS_NODE_INSTALL=1
  fi
fi

if [[ "${NEEDS_NODE_INSTALL}" -eq 1 ]]; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
else
  echo "Node.js $(node -v) is already installed."
fi

echo "Installing backend dependencies..."
cd "${SCRIPT_DIR}"
npm install

if [[ ! -f "${ENV_FILE}" ]]; then
  cat >"${ENV_FILE}" <<EOF
HOST=0.0.0.0
PORT=4000
WS_PORT=4001
PUBLIC_BASE_URL=http://localhost:4000
EOF
  echo "Created ${ENV_FILE} with default values."
else
  echo "${ENV_FILE} already exists. Keeping current values."
fi

echo
echo "Hydra self-host backend setup is complete."
echo "Start it with:"
echo "  ./run-ubuntu-selfhost.sh"
