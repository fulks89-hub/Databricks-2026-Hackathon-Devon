#!/usr/bin/env python
"""Rebuild readiness.readiness_gap_items from readiness.data_readiness (Lakebase).

Demo-quality refinement: column-shifted / invalid-id records (data_quality_flag OR
NOT id_valid) carry garbage in name/coords/contact columns. Their real, blocking issue
is the corruption itself, so they are routed to the flagged_quality section ONLY and
excluded from the four "clean" sections (missing_coords / missing_contact /
unverified_claims / sparse_fields) — keeping those queues readable (real facility names).
possible_duplicate keeps its own signal. Same logic mirrored in
sql/app_state/track4/readiness_gap_items.sql and scripts/track4_lakebase_build.py.
"""
import os, ssl, time
import pg8000.native

SP = "7021a56e-920b-4d4d-be1a-c1c2c95e3ae9"
CLEAN = "AND NOT (data_quality_flag OR NOT id_valid)"  # corrupted -> flagged_quality only


def connect(retries=10, delay=8):
    last = None
    for i in range(retries):
        try:
            return pg8000.native.Connection(
                user=os.environ["PGUSER"], host=os.environ["PGHOST"], port=5432,
                database=os.environ.get("PGDATABASE", "databricks_postgres"),
                password=os.environ["PGTOKEN"], ssl_context=ssl.create_default_context())
        except Exception as e:  # noqa: BLE001
            last = e; print(f"connect {i+1}/{retries}: {str(e)[:80]} — retry {delay}s", flush=True); time.sleep(delay)
    raise last


con = connect()
print("connected", con.run("SELECT current_user")[0][0], flush=True)
con.run("DROP TABLE IF EXISTS readiness.readiness_gap_items CASCADE")
con.run(f"""
CREATE TABLE readiness.readiness_gap_items AS
WITH dr AS (SELECT * FROM readiness.data_readiness)
SELECT unique_id||'__corrupted' AS gap_id, unique_id, facility_name, state, district,
  'corrupted' AS gap_type,
  'Corrupted record - column-shifted / invalid (non-UUID) id. Re-extract from source or quarantine.' AS suggested_action,
  contact_channel, contact_value,
  concat_ws(', ', 'invalid_id', CASE WHEN data_quality_flag THEN 'data_quality_flag' END) AS missing_fields,
  high_leverage, 'open' AS status, data_confidence, completeness_score,
  sample_unverified_specialty, unverified_claims, 1 AS severity_rank
FROM dr WHERE NOT id_valid
UNION ALL
SELECT unique_id||'__flagged_quality' AS gap_id, unique_id, facility_name, state, district,
  'flagged_quality' AS gap_type,
  'Review flagged field; patch the value or quarantine the record.' AS suggested_action,
  contact_channel, contact_value,
  concat_ws(', ', CASE WHEN data_quality_flag THEN 'data_quality_flag' END) AS missing_fields,
  high_leverage, 'open' AS status, data_confidence, completeness_score,
  sample_unverified_specialty, unverified_claims, 1 AS severity_rank
FROM dr WHERE (data_quality_flag AND id_valid)
UNION ALL
SELECT unique_id||'__possible_duplicate', unique_id, facility_name, state, district,
  'possible_duplicate',
  'Compare with candidate facility; merge or keep distinct, then record the decision in dup_decisions.',
  contact_channel, contact_value, 'possible_entity_dup',
  high_leverage, 'open', data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 2
FROM dr WHERE possible_entity_dup
UNION ALL
SELECT unique_id||'__unverified_claims', unique_id, facility_name, state, district,
  'unverified_claims',
  CASE WHEN contact_channel<>'none'
    THEN 'Contact via '||contact_channel||' ('||COALESCE(contact_value,'')||') to confirm claimed '
         ||COALESCE(sample_unverified_specialty,'specialty')||' ('||unverified_claims||' unverified claim(s)).'
    ELSE 'Flag for review - no contact channel to confirm claimed '
         ||COALESCE(sample_unverified_specialty,'specialty')||' ('||unverified_claims||' unverified claim(s)).'
  END,
  contact_channel, contact_value, 'corroboration=none x'||unverified_claims,
  high_leverage, 'open', data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 3
FROM dr WHERE unverified_claims>0 {CLEAN}
UNION ALL
SELECT unique_id||'__missing_coords', unique_id, facility_name, state, district,
  'missing_coords',
  CASE WHEN contact_channel<>'none'
    THEN 'Geocode from address ('||COALESCE(address_text,'unknown')||'); confirm via '||contact_channel||'.'
    ELSE 'Geocode from address ('||COALESCE(address_text,'unknown')||'); verify by field visit.'
  END,
  contact_channel, contact_value, 'lat/lng (coord_source=none)',
  high_leverage, 'open', data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 4
FROM dr WHERE NOT has_coords {CLEAN}
UNION ALL
SELECT unique_id||'__missing_contact', unique_id, facility_name, state, district,
  'missing_contact',
  CASE WHEN has_phone THEN 'Call '||COALESCE(phone_value,'')||' to collect/confirm email & social contact.'
       ELSE 'Field visit / external lookup to obtain contact details.' END,
  contact_channel, contact_value,
  concat_ws(', ', CASE WHEN NOT has_email THEN 'email' END, CASE WHEN NOT has_facebook THEN 'facebook' END,
                  CASE WHEN NOT has_phone THEN 'phone' END),
  high_leverage, 'open', data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 5
FROM dr WHERE (NOT has_email AND NOT has_facebook) {CLEAN}
UNION ALL
SELECT unique_id||'__sparse_fields', unique_id, facility_name, state, district,
  'sparse_fields',
  CASE WHEN contact_channel<>'none'
    THEN 'Enrich '||concat_ws(', ', CASE WHEN sparse_capability THEN 'capability' END,
          CASE WHEN sparse_procedure THEN 'procedure' END, CASE WHEN sparse_equipment THEN 'equipment' END,
          CASE WHEN sparse_beds THEN 'beds' END, CASE WHEN sparse_year THEN 'year' END,
          CASE WHEN sparse_specialties THEN 'specialties' END)
         ||' from '||contact_channel||' / source URL.'
    ELSE 'Enrich '||concat_ws(', ', CASE WHEN sparse_capability THEN 'capability' END,
          CASE WHEN sparse_procedure THEN 'procedure' END, CASE WHEN sparse_equipment THEN 'equipment' END,
          CASE WHEN sparse_beds THEN 'beds' END, CASE WHEN sparse_year THEN 'year' END,
          CASE WHEN sparse_specialties THEN 'specialties' END)
         ||' from source URL / external lookup.'
  END,
  contact_channel, contact_value,
  concat_ws(', ', CASE WHEN sparse_capability THEN 'capability' END,
                  CASE WHEN sparse_procedure THEN 'procedure' END, CASE WHEN sparse_equipment THEN 'equipment' END,
                  CASE WHEN sparse_beds THEN 'beds' END, CASE WHEN sparse_year THEN 'year' END,
                  CASE WHEN sparse_specialties THEN 'specialties' END),
  high_leverage, 'open', data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 6
FROM dr WHERE (sparse_capability OR sparse_procedure OR sparse_equipment
               OR sparse_beds OR sparse_year OR sparse_specialties) {CLEAN}
""")
con.run("ALTER TABLE readiness.readiness_gap_items ADD PRIMARY KEY (gap_id)")
con.run("CREATE INDEX ix_gap_type ON readiness.readiness_gap_items (gap_type)")
con.run("CREATE INDEX ix_gap_uid ON readiness.readiness_gap_items (unique_id)")
con.run(f'GRANT SELECT ON readiness.readiness_gap_items TO "{SP}"')

print("total:", con.run("SELECT count(*) FROM readiness.readiness_gap_items")[0][0])
for gt, n, hl in con.run("SELECT gap_type, count(*), sum(high_leverage::int) FROM readiness.readiness_gap_items GROUP BY gap_type ORDER BY count(*) DESC"):
    print(f"   {gt:20s} {n:6d}  (high_leverage {hl})")
con.close()
print("DONE")
