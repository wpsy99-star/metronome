#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --cache /workspace/.npm-cache
npm run build
