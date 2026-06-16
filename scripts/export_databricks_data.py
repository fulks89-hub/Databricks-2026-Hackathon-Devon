#!/usr/bin/env python3
"""
export_databricks_data.py
=========================
Export the Asclepius **non-PII analytical** tables from Lakebase Postgres into
gzipped CSVs under `data/databricks_export/`, so they can be committed to the
public repo for judging/reproducibility.

WHAT IT EXPORTS (non-PII analytical layers only):
  app_read.*        synced facility / NFHS / pincode / crosswalk / ref tables
  trust.*           facility_trust_card, facility_trust_summary, facility_accreditation
  medical_desert.*  area_medical_scarcity, area_capability_desert, area_specialty_desert, facility_evidence
  readiness.*       data_readiness, readiness_gap_items, gold_district_supply_need, facility_contacts

WHAT IT DELIBERATELY REFUSES TO EXPORT:
  the `app` schema (accounts / reviews / notes / referrals / user_review_actions / ...)
  -> those hold real user identities + emails (PII). They MUST NOT go to a public
     repo. There is a hard guard below; do not remove it.

NOTE: facility *contact* emails (institutional, web-crawled) may appear in the
facility tables. Those are public business-contact info and already ship in the
committed `data/facilities_clean.csv.gz`; they are NOT user PII.

-------------------------------------------------------------------------------
HOW TO RUN (you have Lakebase access; run it in YOUR terminal):

  pip install pg8000                      # one-time
  databricks auth login -p team           # if not already logged in

  # one command -- it mints a short-lived read token for you automatically:
  python scripts/export_databricks_data.py

  # dry run (list tables + row counts, export nothing):
  python scripts/export_databricks_data.py --list

Then review data/databricks_export/ and:
  git add data/databricks_export
  git commit -m "Add exported Databricks analytical tables (non-PII)"
  git push
-------------------------------------------------------------------------------
"""

import csv
import datetime
import gzip
import json
import os
import re
import ssl
import subprocess
import sys

# --- connection facts: Asclepius production Lakebase (override via env if needed) ---
ENDPOINT   = os.environ.get("PGENDPOINT", "projects/asclepius/branches/production/endpoints/primary")
PGHOST     = os.environ.get("PGHOST", "ep-blue-bread-d88j2kbh.database.us-east-2.cloud.databricks.com")
PGUSER     = os.environ.get("PGUSER", "dakotabowles72956@gmail.com")
PGDATABASE = os.environ.get("PGDATABASE", "databricks_postgres")
PGPORT     = int(os.environ.get("PGPORT", "5432"))
PROFILE    = os.environ.get("DATABRICKS_PROFILE", "team")

# --- scope ---
INCLUDE_SCHEMAS = [s.strip() for s in
                   os.environ.get("EXPORT_SCHEMAS", "app_read,trust,medical_desert,readiness").split(",")
                   if s.strip()]
# Hard block: these never get exported, no matter what INCLUDE_SCHEMAS says.
PII_OR_SYSTEM = {"app", "pg_catalog", "information_schema", "pg_toast", "pg_temp_1", "pg_toast_temp_1"}

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT  = os.path.join(REPO_ROOT, "data", "databricks_export")
MAX_GZ_MB = 90  # GitHub hard-fails files > 100 MB; warn before that.

EMAIL_RE = re.compile(rb"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def get_token():
    """Use PGTOKEN/PGPASSWORD if set, else mint a short-lived read credential via the CLI."""
    tok = os.environ.get("PGTOKEN") or os.environ.get("PGPASSWORD")
    if tok:
        return tok
    print(f"[auth] minting a short-lived Lakebase credential (databricks postgres "
          f"generate-database-credential, profile={PROFILE})...")
    out = subprocess.check_output(
        ["databricks", "postgres", "generate-database-credential", ENDPOINT, "-p", PROFILE, "-o", "json"],
        text=True,
    )
    return json.loads(out)["token"]


def connect():
    import pg8000.dbapi
    return pg8000.dbapi.connect(
        host=PGHOST, port=PGPORT, database=PGDATABASE,
        user=PGUSER, password=get_token(),
        ssl_context=ssl.create_default_context(),
    )


def cell(v):
    """Serialize one Postgres value to a CSV-safe string (JSONB/array/dates handled)."""
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, default=str)
    if isinstance(v, (bytes, bytearray)):
        return v.decode("utf-8", "replace")
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()
    return str(v)


def list_tables(conn):
    cur = conn.cursor()
    cur.execute(
        "SELECT table_schema, table_name, table_type "
        "FROM information_schema.tables ORDER BY table_schema, table_name"
    )
    out = []
    for schema, name, _ttype in cur.fetchall():
        if schema in PII_OR_SYSTEM:
            continue
        if schema in INCLUDE_SCHEMAS:
            out.append((schema, name))
    return out


def export_table(conn, schema, table):
    if schema in PII_OR_SYSTEM:
        raise RuntimeError(f"refusing to export protected schema: {schema}")
    cur = conn.cursor()
    cur.execute(f'SELECT * FROM "{schema}"."{table}"')
    cols = [d[0] for d in cur.description]
    out_dir = os.path.join(OUT_ROOT, schema)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{table}.csv.gz")
    n = 0
    with gzip.open(path, "wt", newline="", encoding="utf-8") as gz:
        w = csv.writer(gz)
        w.writerow(cols)
        while True:
            rows = cur.fetchmany(5000)
            if not rows:
                break
            for row in rows:
                w.writerow([cell(v) for v in row])
                n += 1
    size_mb = os.path.getsize(path) / 1e6
    with gzip.open(path, "rb") as gz:
        email_hits = len(EMAIL_RE.findall(gz.read()))
    return {
        "schema": schema, "table": table, "rows": n, "columns": cols,
        "file": os.path.relpath(path, REPO_ROOT).replace("\\", "/"),
        "size_mb": round(size_mb, 2), "email_like_strings": email_hits,
    }


def main():
    # Safety guard: never let the PII schema slip into scope.
    bad = [s for s in INCLUDE_SCHEMAS if s in PII_OR_SYSTEM]
    if bad:
        sys.exit(f"ABORT: INCLUDE_SCHEMAS contains protected/PII schema(s): {bad}")

    print("=" * 72)
    print("Asclepius Databricks export  (NON-PII analytical tables only)")
    print(f"  include schemas : {INCLUDE_SCHEMAS}")
    print(f"  refused schemas : app (user PII) + system catalogs")
    print(f"  output          : {OUT_ROOT}")
    print("=" * 72)

    conn = connect()
    tables = list_tables(conn)
    print(f"[scope] {len(tables)} tables in scope\n")

    if "--list" in sys.argv:
        for schema, table in tables:
            cur = conn.cursor()
            cur.execute(f'SELECT count(*) FROM "{schema}"."{table}"')
            print(f"  {schema}.{table:38s} {cur.fetchone()[0]:>9d} rows")
        print("\n(--list: nothing exported)")
        return

    os.makedirs(OUT_ROOT, exist_ok=True)
    manifest, total_mb, warnings = [], 0.0, []
    for schema, table in tables:
        try:
            info = export_table(conn, schema, table)
        except Exception as e:  # noqa: BLE001 - keep going on a single bad table
            print(f"  !! FAILED {schema}.{table}: {e}")
            warnings.append(f"failed: {schema}.{table}: {e}")
            continue
        total_mb += info["size_mb"]
        note = ""
        if info["size_mb"] > MAX_GZ_MB:
            note += f"  !! {info['size_mb']}MB > {MAX_GZ_MB}MB (GitHub 100MB limit)"
            warnings.append(f"oversize: {info['file']} = {info['size_mb']}MB")
        if info["email_like_strings"]:
            note += f"  (~{info['email_like_strings']} email-like strings = facility contacts, not user PII)"
        print(f"  {schema}.{table:38s} {info['rows']:>9d} rows  {info['size_mb']:>7.2f}MB{note}")
        manifest.append(info)

    meta = {
        "exported_at_utc": datetime.datetime.utcnow().isoformat() + "Z",
        "endpoint": ENDPOINT,
        "included_schemas": INCLUDE_SCHEMAS,
        "excluded": "app (user PII) + system catalogs",
        "table_count": len(manifest),
        "total_size_mb": round(total_mb, 2),
        "tables": manifest,
    }
    with open(os.path.join(OUT_ROOT, "MANIFEST.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    with open(os.path.join(OUT_ROOT, "README.md"), "w", encoding="utf-8") as f:
        f.write(
            "# Databricks analytical export (non-PII)\n\n"
            f"Generated by `scripts/export_databricks_data.py` on "
            f"{meta['exported_at_utc']}.\n\n"
            "Gzipped CSV snapshots of the Asclepius Lakebase analytical tables, for "
            "reproducibility. **The `app` schema (user accounts/reviews/PII) is "
            "deliberately excluded.** Facility contact emails that appear are public "
            "web-crawled business contacts, not user data.\n\n"
            f"- Schemas: {', '.join(INCLUDE_SCHEMAS)}\n"
            f"- Tables: {len(manifest)} | Total: {round(total_mb,2)} MB\n\n"
            "See `MANIFEST.json` for per-table row counts, columns, and sizes.\n"
        )

    print("\n" + "=" * 72)
    print(f"Done: {len(manifest)} tables, {round(total_mb,2)} MB -> data/databricks_export/")
    if warnings:
        print("WARNINGS:")
        for w in warnings:
            print("  - " + w)
    print("\nNext:")
    print("  git add data/databricks_export")
    print('  git commit -m "Add exported Databricks analytical tables (non-PII)"')
    print("  git push")
    print("=" * 72)


if __name__ == "__main__":
    main()
