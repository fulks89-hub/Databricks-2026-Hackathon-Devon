#!/usr/bin/env python
"""Track 4 (Data Readiness Desk) — native Lakebase Postgres build.

WHY native: on 2026-06-16 the Free-Edition daily limit was hit for BOTH the SQL
warehouse AND Online Tables (DLT sync), so the normal UC->synced-table path is
unavailable. Lakebase Postgres compute is separate and still works. This script
builds the Track 4 read layer directly in a `readiness` Postgres schema from:
  - app_read.facilities          (working facility fields + quality flags; already synced)
  - trust.facility_trust_card    (Track-1 corroboration='none' -> unverified claims; already synced)
  - app_read.facility_district   (Peter's join-gap / is_unmapped; already synced)
  - readiness.facility_contacts  (contacts loaded here from data/facilities_clean.csv, since
                                  contacts are NOT in app_read.facilities)
The equivalent UC build lives in sql/app_state/track4/*.sql for the post-reset synced path.

Run (main thread; token expires ~1h):
  PGHOST=ep-blue-bread-d88j2kbh.database.us-east-2.cloud.databricks.com \
  PGUSER=dakotabowles72956@gmail.com \
  PGTOKEN=$(databricks postgres generate-database-credential <EP> -p team -o json | jq -r .token) \
  python scripts/track4_lakebase_build.py
"""
import csv, os, ssl, sys
import pg8000.native

SP = "7021a56e-920b-4d4d-be1a-c1c2c95e3ae9"  # app service principal (Postgres role to GRANT)
CSV = os.path.join(os.path.dirname(__file__), "..", "data", "facilities_clean.csv")
NULLISH = {"", "null", "[]", "none", "na", "n/a"}


def present(x):
    return x is not None and x.strip() != "" and x.strip().lower() not in NULLISH


def first_phone(s):
    """phone_numbers is a list-as-string like ['+91...','...']; pull a usable value."""
    if not present(s):
        return None
    t = s.strip().strip("[]")
    for part in t.split(","):
        p = part.strip().strip("'\" ")
        if p and p.lower() not in NULLISH:
            return p
    return None


def run(con, sql, **kw):
    return con.run(sql, **kw)


def connect(retries=10, delay=8):
    import time
    last = None
    for i in range(retries):
        try:
            return pg8000.native.Connection(
                user=os.environ["PGUSER"], host=os.environ["PGHOST"], port=5432,
                database=os.environ.get("PGDATABASE", "databricks_postgres"),
                password=os.environ["PGTOKEN"], ssl_context=ssl.create_default_context(),
            )
        except Exception as e:  # noqa: BLE001
            last = e
            print(f"connect attempt {i+1}/{retries} failed: {str(e)[:90]} — retrying in {delay}s", flush=True)
            time.sleep(delay)
    raise last


def main():
    con = connect()
    print("connected", con.run("SELECT current_user")[0][0], flush=True)

    # ---- 1. parse contacts from the cleaned CSV --------------------------------------
    rows = []
    with open(CSV, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            uid = (r.get("unique_id") or "").strip()
            if not uid:
                continue
            phone = r.get("officialPhone") if present(r.get("officialPhone")) else first_phone(r.get("phone_numbers"))
            email = r.get("email").strip() if present(r.get("email")) else None
            website = r.get("officialWebsite") if present(r.get("officialWebsite")) else (r.get("websites") if present(r.get("websites")) else None)
            fb = r.get("facebookLink").strip() if present(r.get("facebookLink")) else None
            phone = phone.strip() if phone else None
            website = website.strip() if website else None
            addr = ", ".join(p.strip() for p in [r.get("address_line1"), r.get("address_city"),
                    r.get("address_stateOrRegion"), r.get("address_zipOrPostcode")] if present(p))
            has_phone, has_email = phone is not None, email is not None
            has_website, has_fb = website is not None, fb is not None
            if has_phone:   channel, value = "phone", phone
            elif has_email: channel, value = "email", email
            elif has_website: channel, value = "website", website
            elif has_fb:    channel, value = "facebook", fb
            else:           channel, value = "none", None
            rows.append((uid, has_phone, has_email, has_website, has_fb,
                         phone, email, website, fb, channel, value, addr or None))
    print(f"parsed {len(rows)} contact rows from CSV")

    # ---- 2. schema + contacts table + bulk load --------------------------------------
    run(con, "CREATE SCHEMA IF NOT EXISTS readiness")
    run(con, "DROP TABLE IF EXISTS readiness.facility_contacts CASCADE")
    run(con, """CREATE TABLE readiness.facility_contacts (
        unique_id text PRIMARY KEY, has_phone bool, has_email bool, has_website bool, has_facebook bool,
        phone_value text, email_value text, website_value text, facebook_value text,
        contact_channel text, contact_value text, address_text text)""")
    cols = ["unique_id","has_phone","has_email","has_website","has_facebook","phone_value",
            "email_value","website_value","facebook_value","contact_channel","contact_value","address_text"]
    B = 400
    for i in range(0, len(rows), B):
        chunk = rows[i:i+B]
        ph, params = [], {}
        for j, row in enumerate(chunk):
            ph.append("(" + ",".join(f":p{j}_{k}" for k in range(len(cols))) + ")")
            for k, v in enumerate(row):
                params[f"p{j}_{k}"] = v
        run(con, f"INSERT INTO readiness.facility_contacts ({','.join(cols)}) VALUES {','.join(ph)}", **params)
    print("loaded contacts:", con.run("SELECT count(*) FROM readiness.facility_contacts")[0][0])

    # ---- 3. data_readiness -----------------------------------------------------------
    run(con, "DROP TABLE IF EXISTS readiness.data_readiness CASCADE")
    run(con, """
    CREATE TABLE readiness.data_readiness AS
    WITH tc AS (
      SELECT unique_id,
             count(*) FILTER (WHERE corroboration='none') AS n_unverified,
             max(claimed_specialty) FILTER (WHERE corroboration='none') AS sample_unverified_specialty
      FROM trust.facility_trust_card GROUP BY unique_id
    ),
    base AS (
      SELECT f.id AS unique_id, f.name AS facility_name, f.state, f.district, f.lat, f.lng,
             COALESCE(f.data_quality_flag,false) AS data_quality_flag,
             COALESCE(f.possible_entity_dup,false) AS possible_entity_dup,
             COALESCE(f.id_valid,true) AS id_valid,
             (f.coord_source <> 'none' AND f.lat IS NOT NULL AND f.lng IS NOT NULL) AS has_coords,
             (f.capability IS NULL OR btrim(f.capability)='') AS sparse_capability,
             (f.procedure  IS NULL OR btrim(f.procedure)='')  AS sparse_procedure,
             (f.equipment  IS NULL OR btrim(f.equipment)='')  AS sparse_equipment,
             (f.beds IS NOT NULL AND f.beds>0) AS has_beds,
             (f.year IS NOT NULL AND f.year>0) AS has_year,
             COALESCE(jsonb_array_length(f.specialties),0) AS n_specialties,
             (f.beds IS NULL OR f.beds<=0) AS sparse_beds,
             (f.year IS NULL OR f.year<=0) AS sparse_year,
             (COALESCE(jsonb_array_length(f.specialties),0)=0) AS sparse_specialties,
             COALESCE(c.has_phone,false) AS has_phone, COALESCE(c.has_email,false) AS has_email,
             COALESCE(c.has_website,false) AS has_website, COALESCE(c.has_facebook,false) AS has_facebook,
             c.phone_value, c.email_value, c.website_value, c.facebook_value,
             COALESCE(c.contact_channel,'none') AS contact_channel, c.contact_value, c.address_text,
             COALESCE(tc.n_unverified,0)::int AS unverified_claims, tc.sample_unverified_specialty,
             (fd.unique_id IS NULL OR fd.match_status='unmapped' OR fd.nfhs_district IS NULL) AS is_unmapped
      FROM app_read.facilities f
      LEFT JOIN readiness.facility_contacts c ON c.unique_id = f.id
      LEFT JOIN tc ON tc.unique_id = f.id
      LEFT JOIN app_read.facility_district fd ON fd.unique_id = f.id
    ),
    scored AS (
      SELECT *,
        round(100.0 * ( has_coords::int + (contact_channel<>'none')::int + (NOT sparse_capability)::int
          + (NOT sparse_procedure)::int + (NOT sparse_equipment)::int + has_beds::int + has_year::int
          + (n_specialties>0)::int ) / 8.0)::int AS completeness_score,
        GREATEST(0.0, LEAST(1.0, round((1.0
          - (CASE WHEN data_quality_flag THEN 0.30 ELSE 0 END)
          - (CASE WHEN NOT id_valid THEN 0.20 ELSE 0 END)
          - (CASE WHEN possible_entity_dup THEN 0.25 ELSE 0 END)
          - (CASE WHEN unverified_claims>0 THEN 0.15 ELSE 0 END)
          - (CASE WHEN NOT has_coords THEN 0.10 ELSE 0 END)
          - (CASE WHEN sparse_capability THEN 0.10 ELSE 0 END))::numeric, 2))::float8) AS data_confidence
      FROM base
    )
    SELECT unique_id, facility_name, state, district, lat, lng,
      has_phone, has_email, has_website, has_facebook, has_coords,
      data_quality_flag, possible_entity_dup, id_valid,
      sparse_capability, sparse_procedure, sparse_equipment,
      sparse_beds, sparse_year, sparse_specialties,
      unverified_claims, sample_unverified_specialty, is_unmapped,
      phone_value, email_value, website_value, facebook_value,
      contact_channel, contact_value, address_text,
      completeness_score, data_confidence,
      CASE
        WHEN (data_quality_flag OR NOT id_valid) THEN 'flagged_quality'
        WHEN possible_entity_dup THEN 'possible_duplicate'
        WHEN unverified_claims>0 THEN 'unverified_claims'
        WHEN NOT has_coords THEN 'missing_coords'
        WHEN (NOT has_email AND NOT has_facebook) THEN 'missing_contact'
        WHEN (sparse_capability OR sparse_procedure OR sparse_equipment
              OR sparse_beds OR sparse_year OR sparse_specialties) THEN 'sparse_fields'
        ELSE 'none' END AS primary_gap_type,
      (is_unmapped OR ((data_quality_flag OR NOT id_valid) AND contact_channel<>'none')) AS high_leverage
    FROM scored
    """)
    run(con, "ALTER TABLE readiness.data_readiness ADD PRIMARY KEY (unique_id)")
    print("data_readiness:", con.run("SELECT count(*) FROM readiness.data_readiness")[0][0])

    # ---- 4. readiness_gap_items (one row per facility x firing gap) -------------------
    run(con, "DROP TABLE IF EXISTS readiness.readiness_gap_items CASCADE")
    run(con, """
    CREATE TABLE readiness.readiness_gap_items AS
    WITH dr AS (SELECT * FROM readiness.data_readiness)
    SELECT unique_id||'__flagged_quality' AS gap_id, unique_id, facility_name, state, district,
      'flagged_quality' AS gap_type,
      'Review flagged field; patch the value or quarantine the record.' AS suggested_action,
      contact_channel, contact_value,
      concat_ws(', ', CASE WHEN data_quality_flag THEN 'data_quality_flag' END,
                      CASE WHEN NOT id_valid THEN 'invalid_id' END) AS missing_fields,
      high_leverage, 'open' AS status, data_confidence, completeness_score,
      sample_unverified_specialty, unverified_claims, 1 AS severity_rank
    FROM dr WHERE (data_quality_flag OR NOT id_valid)
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
    FROM dr WHERE unverified_claims>0 AND NOT (data_quality_flag OR NOT id_valid)
    UNION ALL
    SELECT unique_id||'__missing_coords', unique_id, facility_name, state, district,
      'missing_coords',
      CASE WHEN contact_channel<>'none'
        THEN 'Geocode from address ('||COALESCE(address_text,'unknown')||'); confirm via '||contact_channel||'.'
        ELSE 'Geocode from address ('||COALESCE(address_text,'unknown')||'); verify by field visit.'
      END,
      contact_channel, contact_value, 'lat/lng (coord_source=none)',
      high_leverage, 'open', data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 4
    FROM dr WHERE NOT has_coords AND NOT (data_quality_flag OR NOT id_valid)
    UNION ALL
    SELECT unique_id||'__missing_contact', unique_id, facility_name, state, district,
      'missing_contact',
      CASE WHEN has_phone THEN 'Call '||COALESCE(phone_value,'')||' to collect/confirm email & social contact.'
           ELSE 'Field visit / external lookup to obtain contact details.' END,
      contact_channel, contact_value,
      concat_ws(', ', CASE WHEN NOT has_email THEN 'email' END, CASE WHEN NOT has_facebook THEN 'facebook' END,
                      CASE WHEN NOT has_phone THEN 'phone' END),
      high_leverage, 'open', data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 5
    FROM dr WHERE (NOT has_email AND NOT has_facebook) AND NOT (data_quality_flag OR NOT id_valid)
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
                   OR sparse_beds OR sparse_year OR sparse_specialties) AND NOT (data_quality_flag OR NOT id_valid)
    """)
    run(con, "ALTER TABLE readiness.readiness_gap_items ADD PRIMARY KEY (gap_id)")
    run(con, "CREATE INDEX ix_gap_type ON readiness.readiness_gap_items (gap_type)")
    run(con, "CREATE INDEX ix_gap_uid ON readiness.readiness_gap_items (unique_id)")

    # ---- 5. grant the app service principal ------------------------------------------
    run(con, f'GRANT USAGE ON SCHEMA readiness TO "{SP}"')
    run(con, f'GRANT SELECT ON ALL TABLES IN SCHEMA readiness TO "{SP}"')
    run(con, f'ALTER DEFAULT PRIVILEGES IN SCHEMA readiness GRANT SELECT ON TABLES TO "{SP}"')

    # ---- 6. verify -------------------------------------------------------------------
    print("gap_items total:", con.run("SELECT count(*) FROM readiness.readiness_gap_items")[0][0])
    print("by gap_type:")
    for gt, n, hl in con.run("SELECT gap_type, count(*), sum(high_leverage::int) FROM readiness.readiness_gap_items GROUP BY gap_type ORDER BY count(*) DESC"):
        print(f"   {gt:20s} {n:6d}  (high_leverage {hl})")
    print("high_leverage facilities:", con.run("SELECT count(*) FROM readiness.data_readiness WHERE high_leverage")[0][0])
    print("contact_channel dist:", con.run("SELECT contact_channel, count(*) FROM readiness.data_readiness GROUP BY contact_channel ORDER BY 2 DESC")[0:6])
    con.close()
    print("DONE")


if __name__ == "__main__":
    main()
