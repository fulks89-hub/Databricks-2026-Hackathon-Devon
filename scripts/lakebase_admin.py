#!/usr/bin/env python
"""Run SQL against the Asclepius Lakebase Postgres via OAuth (pure-python pg8000).

Usage:
  PGHOST=... PGUSER=... PGTOKEN=... PGSQL="SELECT 1; SELECT 2" python scripts/lakebase_admin.py

Token: databricks postgres generate-database-credential \
  projects/asclepius/branches/production/endpoints/primary -p team -o json  -> .token
Host : ep-blue-bread-d88j2kbh.database.us-east-2.cloud.databricks.com
User : the Databricks identity (project owner email) for admin/GRANT work.
"""
import os
import ssl
import sys

import pg8000.native

host = os.environ["PGHOST"]
user = os.environ["PGUSER"]
password = os.environ["PGTOKEN"]
database = os.environ.get("PGDATABASE", "databricks_postgres")
sql = os.environ.get("PGSQL", "SELECT current_user")

ctx = ssl.create_default_context()
con = pg8000.native.Connection(
    user=user, host=host, port=5432, database=database, password=password, ssl_context=ctx
)
print(f"connected to {host} as {user} / db={database}")
for stmt in sql.split(";"):
    s = stmt.strip()
    if not s:
        continue
    try:
        rows = con.run(s)
        preview = rows[:8] if rows else "(no rows / DDL ok)"
        print(f"OK  | {s[:70]}\n    -> {preview}")
    except Exception as e:  # noqa: BLE001
        print(f"ERR | {s[:70]}\n    -> {type(e).__name__}: {e}", file=sys.stderr)
con.close()
