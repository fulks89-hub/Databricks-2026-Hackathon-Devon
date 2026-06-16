#!/usr/bin/env python
"""Native Lakebase Postgres rebuild of Peter's corrected gold_district_supply_need.

Mirrors workspace.virtue_foundation_clean_v4.gold_district_supply_need (already deployed in
UC) but computed directly in Postgres, because Online Tables (DLT sync) hit the Free-Edition
daily limit on 2026-06-16 and cannot sync v4 into Lakebase today. Inputs already in Lakebase:
  app_read.gold_district_supply_need  -> the 7 NFHS need indicators (unchanged by the fix)
  app_read.facility_district          -> live mapped recount (FIX-1) + supply-unknown flag
Output: readiness.gold_district_supply_need (17 cols, NULL desert for 189 unknown-supply).
The /api/data/deserts route is repointed at this table so the fix is live for the Atlas drill.
"""
import os, ssl, time
import pg8000.native

SP = "7021a56e-920b-4d4d-be1a-c1c2c95e3ae9"


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
con.run("DROP TABLE IF EXISTS readiness.gold_district_supply_need CASCADE")
con.run("""
CREATE TABLE readiness.gold_district_supply_need AS
WITH live_counts AS (
  SELECT nfhs_district, nfhs_state AS state, count(*) AS mapped_facility_count
  FROM app_read.facility_district
  WHERE match_status <> 'unmapped' AND nfhs_district IS NOT NULL
  GROUP BY nfhs_district, nfhs_state
),
base AS (
  SELECT g.nfhs_district, g.state,
    g.institutional_birth_5y_pct, g.mothers_who_had_at_least_4_anc_visits_lb5y_pct,
    g.hh_use_improved_sanitation_pct, g.hh_member_covered_health_insurance_pct,
    g.child_u5_who_are_stunted_height_for_age_18_pct, g.child_u5_who_are_underweight_weight_for_age_18_pct,
    g.all_w15_49_who_are_anaemic_pct,
    COALESCE(lc.mapped_facility_count,0)::bigint AS facility_count
  FROM app_read.gold_district_supply_need g
  LEFT JOIN live_counts lc ON g.nfhs_district=lc.nfhs_district AND g.state=lc.state
),
need_pct AS (
  SELECT *, round((((100.0 - percent_rank() OVER (ORDER BY institutional_birth_5y_pct)*100)
    + (100.0 - percent_rank() OVER (ORDER BY mothers_who_had_at_least_4_anc_visits_lb5y_pct)*100)
    + (100.0 - percent_rank() OVER (ORDER BY hh_use_improved_sanitation_pct)*100)
    + (100.0 - percent_rank() OVER (ORDER BY hh_member_covered_health_insurance_pct)*100)
    + (percent_rank() OVER (ORDER BY child_u5_who_are_stunted_height_for_age_18_pct)*100)
    + (percent_rank() OVER (ORDER BY child_u5_who_are_underweight_weight_for_age_18_pct)*100)
    + (percent_rank() OVER (ORDER BY all_w15_49_who_are_anaemic_pct)*100))/7.0)::numeric,1) AS need_score
  FROM base
),
classified AS (
  SELECT *, (facility_count>0) AS has_facilities, (facility_count>0) AS supply_known,
    CASE WHEN facility_count>0
      THEN round((100.0 - percent_rank() OVER (PARTITION BY (facility_count>0) ORDER BY facility_count)*100)::numeric,1)
      ELSE NULL END AS supply_scarcity
  FROM need_pct
),
scored AS (
  SELECT *, CASE WHEN supply_known THEN round((0.35*supply_scarcity+0.65*need_score)::numeric,1) ELSE NULL END AS desert_score,
    CASE WHEN supply_known THEN 'mapped' ELSE 'insufficient_supply_data' END AS coverage_flag
  FROM classified
),
ranked AS (
  SELECT *, CASE WHEN supply_known
      THEN rank() OVER (ORDER BY (CASE WHEN supply_known THEN round((0.35*supply_scarcity+0.65*need_score)::numeric,1) END) DESC NULLS LAST, need_score DESC, state, nfhs_district)::bigint
      ELSE NULL END AS desert_rank
  FROM scored
)
SELECT nfhs_district, state,
  institutional_birth_5y_pct, mothers_who_had_at_least_4_anc_visits_lb5y_pct,
  hh_use_improved_sanitation_pct, hh_member_covered_health_insurance_pct,
  child_u5_who_are_stunted_height_for_age_18_pct, child_u5_who_are_underweight_weight_for_age_18_pct,
  all_w15_49_who_are_anaemic_pct,
  facility_count, need_score, supply_scarcity, desert_score, desert_rank,
  has_facilities, supply_known, coverage_flag
FROM ranked
""")
con.run("ALTER TABLE readiness.gold_district_supply_need ADD PRIMARY KEY (nfhs_district, state)")
con.run(f'GRANT SELECT ON readiness.gold_district_supply_need TO "{SP}"')

n, mapped, nulld, sumf = con.run("""SELECT count(*), sum((coverage_flag='mapped')::int),
  sum((desert_score IS NULL)::int), sum(facility_count) FROM readiness.gold_district_supply_need""")[0]
print(f"rows={n} mapped={mapped} null_desert={nulld} sum_fac={sumf}")
print("top5 deserts:")
for r in con.run("SELECT desert_rank, nfhs_district, state, facility_count, need_score, desert_score FROM readiness.gold_district_supply_need WHERE desert_rank<=5 ORDER BY desert_rank"):
    print("  ", r)
con.close()
print("DONE")
