#!/bin/bash
set -euo pipefail
pnpm install --frozen-lockfile
echo "Applying development database migrations..."
pnpm -w run migrate:development
pnpm -w run guard:schema-path
