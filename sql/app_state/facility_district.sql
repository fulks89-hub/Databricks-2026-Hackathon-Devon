-- app_state.facility_district
-- Facility -> NFHS district crosswalk, ONE ROW PER FACILITY (10,077 unique_id).
--
-- JOIN PATH:
--   facilities.address_zipOrPostcode::bigint = pincode.pincode
--     -> pincode.district / statename (UPPERCASE)
--     -> district_crosswalk.pincode_district / pincode_state (UPPERCASE)
--     -> district_crosswalk.nfhs_district / nfhs_state
--   THEN canonicalise (nfhs_district, nfhs_state) against gold_district_supply_need
--   so the documented downstream join is an EXACT (no lower()) match.
--
-- STATE / DISTRICT CASE CONVENTION (DEFECT-1 FIX):
--   The district_crosswalk emits nfhs_state UPPERCASE (e.g. 'HARYANA','BIHAR') and
--   nfhs_district in the crosswalk's own casing. BUT the canonical app_state
--   district tables -- gold_district_supply_need.state and district_demand.state --
--   are Title Case (e.g. 'Bihar','Jammu & Kashmir','Dadra and Nagar Haveli & Daman
--   and Diu'). A naive equi-join facility_district -> gold ON (nfhs_district,
--   nfhs_state) therefore returned 0 rows; it only worked when both sides were
--   lower()-ed.
--   FIX: after resolving the crosswalk (nfhs_district, nfhs_state), LEFT JOIN to
--   gold_district_supply_need ON a CASE-INSENSITIVE match of (district, state) and
--   emit GOLD's nfhs_district + state as the canonical output. gold's
--   (nfhs_district, state) key is unique (706 rows, no case-collisions), so this
--   stays 1 row per facility, and the emitted spelling is guaranteed to match gold
--   (and district_demand, which shares gold's keys) EXACTLY. Every crosswalk-mapped
--   facility (9,018) currently has a gold match; if one ever did not, we fall back
--   to the crosswalk's own nfhs_district/UPPER(nfhs_state) so the row is preserved.
--
-- DATA-QUALITY HANDLING:
--   * The source pincode table has many post-office rows per pincode, and
--     ~1,258 pincodes span 2-4 distinct districts. To guarantee one row per
--     facility we first collapse pincode -> ONE district deterministically:
--     the most frequent district for that pincode (tie-break alphabetically).
--     This is the pin_one CTE (one row per pincode).
--   * ~257 facilities have a non-castable / missing address_zipOrPostcode
--     (try_cast -> NULL); they resolve to nfhs_district = NULL, match_status='unmapped'.
--   * Facilities whose pincode is castable but absent from the pincode table,
--     or whose district doesn't match the crosswalk, also get nfhs_district = NULL
--     and match_status = 'unmapped'.
--   * match_status otherwise carries the crosswalk.status (auto | resolved_agent
--     | resolved_manual) so downstream can weight match confidence.
--
-- COLUMNS: unique_id, pincode, pincode_district, pincode_state,
--          nfhs_district, nfhs_state, match_status
CREATE OR REPLACE VIEW workspace.app_state.facility_district AS
WITH pin_one AS (
  -- collapse the pincode table to ONE (district,state) per pincode
  SELECT pincode, district AS pincode_district, statename AS pincode_state
  FROM (
    SELECT
      pincode,
      district,
      statename,
      ROW_NUMBER() OVER (
        PARTITION BY pincode
        ORDER BY COUNT(*) DESC, district ASC
      ) AS rn
    FROM workspace.virtue_foundation_clean_v2.pincode
    WHERE district IS NOT NULL AND district <> ''
    GROUP BY pincode, district, statename
  )
  WHERE rn = 1
),
fac AS (
  SELECT
    unique_id,
    try_cast(address_zipOrPostcode AS bigint) AS pincode
  FROM workspace.virtue_foundation_clean_v2.facilities
),
-- resolve the raw crosswalk (nfhs_district, nfhs_state) per facility (pre-canonicalisation)
resolved AS (
  SELECT
    f.unique_id,
    f.pincode,
    p.pincode_district,
    p.pincode_state,
    x.nfhs_district AS xw_district,
    x.nfhs_state    AS xw_state,
    COALESCE(x.status, 'unmapped') AS match_status
  FROM fac f
  LEFT JOIN pin_one p
    ON f.pincode = p.pincode
  LEFT JOIN workspace.virtue_foundation_clean_v3.district_crosswalk x
    ON UPPER(p.pincode_district) = UPPER(x.pincode_district)
   AND UPPER(p.pincode_state)    = UPPER(x.pincode_state)
)
SELECT
  r.unique_id,
  r.pincode,
  r.pincode_district,
  r.pincode_state,
  -- canonical district/state: gold's exact spelling when matched, else crosswalk fallback.
  -- NULL stays NULL (unmapped facilities) since xw_district is NULL -> g.* NULL.
  CASE WHEN r.xw_district IS NULL THEN NULL
       ELSE COALESCE(g.nfhs_district, r.xw_district) END AS nfhs_district,
  CASE WHEN r.xw_district IS NULL THEN NULL
       ELSE COALESCE(g.state, UPPER(r.xw_state)) END     AS nfhs_state,
  r.match_status
FROM resolved r
LEFT JOIN workspace.app_state.gold_district_supply_need g
  ON LOWER(r.xw_district) = LOWER(g.nfhs_district)
 AND LOWER(r.xw_state)    = LOWER(g.state);
