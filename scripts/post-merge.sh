#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm -w run guard:schema-path
