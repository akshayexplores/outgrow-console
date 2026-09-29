#!/usr/bin/env bash
# Rebuild the local scratch DB (stub + all migrations) and run the RLS tests. Local only.
set -euo pipefail
cd "$(dirname "$0")/.."
P="psql -q -h /tmp/pgtest -p 54329 -U postgres"
$P -d postgres -c "drop database if exists scratch" -c "create database scratch" >/dev/null
$P -d scratch -v ON_ERROR_STOP=1 -f supabase/tests/00_stub_supabase.sql >/dev/null
for f in supabase/migrations/*.sql; do $P -d scratch -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "FAILED $f"; exit 1; }; done
$P -d scratch -f supabase/tests/rls.sql 2>&1 | grep -E "RLS_TESTS_PASSED|ERROR|FAIL" | head -5
