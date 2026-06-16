-- =====================================================================================
-- gold_district_supply_need_FIX.sql   (CORRECTED district-scoring build)
-- -------------------------------------------------------------------------------------
-- DRAFTED FOR PETER TO REVIEW — NOT YET RUN ON LIVE. Read the header, then decide the
-- target (see "DEPLOYMENT TARGET" below) before executing. All logic here was validated
-- READ-ONLY via SELECT/CTE against live workspace.virtue_foundation_clean_v3 + app_state
-- on 2026-06-16 (profile team); nothing was created/replaced/merged/deleted.
--
-- WHY THIS EXISTS (Peter's audit, corroborated by our live probe — all numbers reproduced)
--   The legacy v3 gold_district_supply_need scores join-gap zeros as if they were real
--   scarcity, and the desert ranking is dominated by that artifact:
--     * facility_count is a STALE SNAPSHOT: sum = 9,183. Live facility_district shows
--       9,018 MAPPED + 1,059 UNMAPPED (NULL nfhs_district) = 10,077 facilities. The
--       snapshot overcounts mapped supply by ~165 and its zero-fac membership has drifted
--       (18 districts the snapshot says HAVE facilities now have 0 mapped; 11 it calls
--       zero now have mapped facilities).
--     * supply_scarcity pins ALL zero-facility districts to the GLOBAL MAX = 87.0, which
--       sits ABOVE the entire non-zero band (which tops out at 66.8 at facility_count=1).
--       So a district with 0 MAPPED facilities — overwhelmingly a pincode/crosswalk JOIN
--       GAP, not a true absence of care — scores as maximal scarcity.
--     * desert_score = 0.5*supply_scarcity + 0.5*need_score (reverse-engineered, corr 1.0).
--       Because supply is half the score and the 87.0 pin is the max, the 189 zero-mapped
--       districts flood the top of the desert ranking: corr(desert,supply)=0.878 vs
--       corr(desert,need)=0.656 (supply DOMINATES); 128 of the worst-quartile deserts and
--       ALL of the worst 10 were zero-facility pins (Araria/Lakhisarai/Banka/Arwal/Jamui
--       Bihar; Pakur/Pashchimi Singhbhum/Sahibganj Jharkhand; Panna MP).
--   Net effect: the join gap was being scored as real medical scarcity. Peter is right.
--
-- WHAT THIS BUILD CHANGES (4 fixes, each labelled FIX-n inline below)
--   FIX-1  LIVE-RECOUNT facility_count from workspace.app_state.facility_district
--          (mapped facilities only) instead of trusting the stale gold snapshot.
--   FIX-2  SEPARATE "supply unknown" (0 MAPPED facilities — could be a join gap OR a true
--          absence; INDISTINGUISHABLE at district grain because the 1,059 unmapped
--          facilities carry NULL nfhs_district) from districts with known supply.
--          New columns: has_facilities (bool), supply_known (bool), coverage_flag
--          ('mapped' | 'insufficient_supply_data').
--   FIX-3  supply_scarcity is RANKED OVER MAPPED DISTRICTS ONLY (the 517 with >=1 mapped
--          facility). Unknown-supply districts get supply_scarcity = NULL — they are NOT
--          pinned to a global max and NOT injected into the scarcity distribution.
--          desert_score & desert_rank are likewise computed ONLY over mapped districts;
--          unknown-supply districts get NULL desert_score and NULL desert_rank and are
--          EXCLUDED from the "worst desert" ranking (coverage_flag tells the app why).
--          desert_score is NEED-LED (0.35*supply + 0.65*need) so deserts track unmet need
--          rather than the facility-join artifact — see the "WHY NOT 50/50" note at the
--          scored CTE. Validated corr(desert,need)=0.826 > corr(desert,supply)=0.797.
--   FIX-4  need_score is recomputed as the HONEST equal-weighted percentile of the 7 NFHS
--          indicators with direction applied (coverage indicators inverted, burden
--          indicators direct). This reproduces the legacy need_score (validated corr
--          0.99996, mean abs err 0.069) — it is unchanged in spirit, just made auditable
--          and decoupled from the supply defect. NFHS need is a real signal and is kept.
--
-- COLUMN CONTRACT (PRESERVED — the app reads these; do NOT rename/remove)
--   nfhs_district, state,
--   institutional_birth_5y_pct, mothers_who_had_at_least_4_anc_visits_lb5y_pct,
--   hh_use_improved_sanitation_pct, hh_member_covered_health_insurance_pct,
--   child_u5_who_are_stunted_height_for_age_18_pct,
--   child_u5_who_are_underweight_weight_for_age_18_pct, all_w15_49_who_are_anaemic_pct,
--   facility_count (bigint), need_score (double), supply_scarcity (double),
--   desert_score (double), desert_rank (bigint)
--   ADDED (new, nullable — additive only): has_facilities (boolean),
--   supply_known (boolean), coverage_flag (string).
--   NOTE: supply_scarcity / desert_score / desert_rank are now NULL for the 189
--   unknown-supply districts (previously they were a non-NULL 87.0 phantom). The app
--   MUST treat NULL desert_score as "not rankable / insufficient supply data" and use
--   coverage_flag to badge it, rather than sorting NULLs to the top. Confirm the app's
--   desert sort handles NULLs LAST before adopting (see UPSTREAM_FIX_NOTES.md).
--
-- DEPLOYMENT TARGET (Peter decides — both options shown; pick ONE, then uncomment it)
--   OPTION A (RECOMMENDED, non-breaking): materialize a NEW v4 table and have the
--            app_state passthrough view point at it once validated. Lets the team diff
--            v3 vs v4 side by side and roll back instantly.
--   OPTION B: CREATE OR REPLACE the v3 gold in place. Only after the app's NULL-handling
--            is confirmed, since it changes live values the deployed app reads.
--   The SELECT body is identical for both; only the leading DDL differs.
--
-- SOURCE TABLES
--   workspace.virtue_foundation_clean_v3.gold_district_supply_need  -- canonical 706 keys
--                                                                    -- + the 7 NFHS cols
--   workspace.app_state.facility_district                           -- live fac->district
--                                                                    -- truth (9,018 mapped)
-- =====================================================================================

-- ---- OPTION A: new v4 target (RECOMMENDED). Uncomment to run. --------------------------
-- CREATE OR REPLACE TABLE workspace.virtue_foundation_clean_v4.gold_district_supply_need AS

-- ---- OPTION B: replace v3 in place. Uncomment instead of Option A. ---------------------
-- CREATE OR REPLACE TABLE workspace.virtue_foundation_clean_v3.gold_district_supply_need AS

-- ---- VALIDATION HARNESS: leave the build as a plain SELECT to inspect before adopting.
-- ---- (Peter: run as-is first; it is READ-ONLY. Then prepend one of the DDL lines above.)
WITH
-- =====================================================================================
-- FIX-1: LIVE facility recount. One row per (district,state) with the COUNT of MAPPED
-- facilities. Unmapped facilities (match_status='unmapped', NULL nfhs_district) are
-- excluded — they never resolved to a district, so they cannot count as that district's
-- supply. This replaces gold.facility_count (the stale 9,183 snapshot) with the live
-- 9,018 mapped truth.
-- =====================================================================================
live_counts AS (
  SELECT
    nfhs_district,
    nfhs_state AS state,
    COUNT(*) AS mapped_facility_count
  FROM workspace.app_state.facility_district
  WHERE match_status <> 'unmapped'
    AND nfhs_district IS NOT NULL
  GROUP BY nfhs_district, nfhs_state
),

-- Canonical 706 NFHS district keys + the 7 NFHS need indicators come from gold (the
-- authoritative grain). LEFT JOIN the live recount so every gold district keeps its row;
-- districts with no mapped facility get COALESCE(...,0).
base AS (
  SELECT
    g.nfhs_district,
    g.state,
    g.institutional_birth_5y_pct,
    g.mothers_who_had_at_least_4_anc_visits_lb5y_pct,
    g.hh_use_improved_sanitation_pct,
    g.hh_member_covered_health_insurance_pct,
    g.child_u5_who_are_stunted_height_for_age_18_pct,
    g.child_u5_who_are_underweight_weight_for_age_18_pct,
    g.all_w15_49_who_are_anaemic_pct,
    CAST(COALESCE(lc.mapped_facility_count, 0) AS BIGINT) AS facility_count   -- FIX-1
  FROM workspace.virtue_foundation_clean_v3.gold_district_supply_need g
  LEFT JOIN live_counts lc
    ON g.nfhs_district = lc.nfhs_district
   AND g.state         = lc.state
),

-- =====================================================================================
-- FIX-4: HONEST need_score = equal-weighted mean of the 7 NFHS indicators' per-district
-- percentiles, with DIRECTION applied:
--   COVERAGE indicators (higher = better, so the GAP is the need) -> inverted as
--     100 - percent_rank*100:
--       institutional_birth_5y_pct, mothers_who_had_at_least_4_anc_visits_lb5y_pct,
--       hh_use_improved_sanitation_pct, hh_member_covered_health_insurance_pct
--   BURDEN indicators (higher = worse, direct) -> percent_rank*100:
--       child_u5_who_are_stunted_height_for_age_18_pct,
--       child_u5_who_are_underweight_weight_for_age_18_pct, all_w15_49_who_are_anaemic_pct
-- Validated against legacy gold.need_score: corr = 1.0000, mean abs err = 0.069.
-- This is computed over all 706 districts (need does not depend on supply).
-- =====================================================================================
need_pct AS (
  SELECT
    *,
    ROUND((
        (100.0 - PERCENT_RANK() OVER (ORDER BY institutional_birth_5y_pct)                       * 100)
      + (100.0 - PERCENT_RANK() OVER (ORDER BY mothers_who_had_at_least_4_anc_visits_lb5y_pct)    * 100)
      + (100.0 - PERCENT_RANK() OVER (ORDER BY hh_use_improved_sanitation_pct)                    * 100)
      + (100.0 - PERCENT_RANK() OVER (ORDER BY hh_member_covered_health_insurance_pct)            * 100)
      + (         PERCENT_RANK() OVER (ORDER BY child_u5_who_are_stunted_height_for_age_18_pct)    * 100)
      + (         PERCENT_RANK() OVER (ORDER BY child_u5_who_are_underweight_weight_for_age_18_pct)* 100)
      + (         PERCENT_RANK() OVER (ORDER BY all_w15_49_who_are_anaemic_pct)                    * 100)
    ) / 7.0, 1) AS need_score
  FROM base
),

-- =====================================================================================
-- FIX-2 + FIX-3: classify supply, then rank scarcity OVER MAPPED DISTRICTS ONLY.
--   has_facilities / supply_known = (facility_count > 0).
--   supply_scarcity: NULL when supply is unknown; otherwise the district's inverted
--     percentile of facility_count COMPUTED ONLY among mapped districts (PARTITION on the
--     boolean (facility_count>0) confines the window to the mapped subset; unknown rows
--     fall in their own partition but get NULL via the CASE so they never receive a rank).
--     0 mapped facilities is NO LONGER mapped to the global-max 87.0 phantom.
--     Among mapped districts, supply_scarcity spans a clean 0.0 (most-supplied) .. 100.0
--     (least-supplied, i.e. facility_count = 1). Validated: 517 mapped rows, range 0..100,
--     no 87.0 pin.
-- =====================================================================================
classified AS (
  SELECT
    *,
    (facility_count > 0)                                       AS has_facilities,  -- FIX-2
    (facility_count > 0)                                       AS supply_known,    -- FIX-2
    CASE WHEN facility_count > 0
         THEN ROUND(
                100.0 - PERCENT_RANK() OVER (
                  PARTITION BY (facility_count > 0)
                  ORDER BY facility_count
                ) * 100, 1)
         ELSE NULL                                                                 -- FIX-3
    END AS supply_scarcity
  FROM need_pct
),

-- desert_score is a NEED-LED blend (0.35*supply_scarcity + 0.65*need_score), computed
-- ONLY for mapped districts. Unknown-supply districts get NULL desert_score (they have an
-- honest need_score but no trustworthy supply term, so a desert score would be a
-- fabrication).
--
-- WHY NOT 50/50: a naive 0.5/0.5 blend does NOT make supply and need equal contributors,
-- because (validated live, mapped subset) supply_scarcity has ~1.73x the spread of
-- need_score (stddev 32.2 vs 18.6). A higher-variance term dominates a fixed-weight sum,
-- so 50/50 yields corr(desert,supply)=0.908 >> corr(desert,need)=0.687 — STILL supply-led,
-- the very bias Peter flagged. We swept weights live and the supply/need correlation
-- crossover is ~0.365/0.635; 0.35/0.65 is the clean weight that decisively puts NEED in
-- the lead with margin: validated corr(desert,need)=0.826 > corr(desert,supply)=0.797.
-- This is a deliberate DESIGN choice to satisfy "deserts must track unmet need, not the
-- facility-join artifact"; Peter can re-tune (z-score standardisation gives an exact
-- 0.812/0.812 tie; per-capita normalisation is the durable fix once population lands).
scored AS (
  SELECT
    *,
    CASE WHEN supply_known
         THEN ROUND(0.35 * supply_scarcity + 0.65 * need_score, 1)
         ELSE NULL
    END AS desert_score,
    CASE WHEN supply_known THEN 'mapped'
         ELSE 'insufficient_supply_data'                                           -- FIX-2
    END AS coverage_flag
  FROM classified
),

-- desert_rank: dense RANK over MAPPED districts only (worst desert = rank 1). Unknown-
-- supply districts get NULL rank (excluded from the "worst desert" leaderboard).
-- Tie-break by need_score DESC then keys so the order is deterministic (many mapped
-- districts share facility_count=1 -> supply_scarcity=100.0, so need breaks the tie —
-- which is the desired behaviour: among equally supply-poor districts, higher need ranks
-- worse).
ranked AS (
  SELECT
    *,
    CASE WHEN supply_known
         THEN CAST(RANK() OVER (
                ORDER BY desert_score DESC, need_score DESC, state, nfhs_district
              ) AS BIGINT)
         ELSE NULL
    END AS desert_rank
  FROM scored
)
SELECT
  -- ----- preserved column contract (order matches the existing passthrough view) -----
  nfhs_district,
  state,
  institutional_birth_5y_pct,
  mothers_who_had_at_least_4_anc_visits_lb5y_pct,
  hh_use_improved_sanitation_pct,
  hh_member_covered_health_insurance_pct,
  child_u5_who_are_stunted_height_for_age_18_pct,
  child_u5_who_are_underweight_weight_for_age_18_pct,
  all_w15_49_who_are_anaemic_pct,
  facility_count,        -- FIX-1: live mapped recount (bigint)
  need_score,            -- FIX-4: honest NFHS need percentile (double)
  supply_scarcity,       -- FIX-3: ranked over mapped only; NULL when supply unknown
  desert_score,          -- FIX-3: 0.35*supply+0.65*need (need-led) over mapped only; NULL when unknown
  desert_rank,           -- FIX-3: rank over mapped only; NULL when unknown
  -- ----- new additive flags -----
  has_facilities,        -- FIX-2: boolean, facility_count > 0
  supply_known,          -- FIX-2: boolean, same predicate (named for app readability)
  coverage_flag          -- FIX-2: 'mapped' | 'insufficient_supply_data'
FROM ranked
ORDER BY desert_rank NULLS LAST, state, nfhs_district;

-- =====================================================================================
-- VALIDATION SUMMARY (observed via the SELECT above on live data, 2026-06-16):
--   * 706 districts in, 706 out (grain preserved).
--   * facility_count: SUM = 9,018 (live mapped), vs stale 9,183. 517 mapped districts,
--     189 unknown-supply (coverage_flag='insufficient_supply_data').
--   * Among the 517 mapped: supply_scarcity 0.0..100.0 (no 87.0 phantom),
--     desert_score 8.6..95.1, desert_rank 1..N dense.
--   * Unknown-supply 189: supply_scarcity / desert_score / desert_rank all NULL.
--   * need_score: corr 0.99996 vs legacy gold, mean abs err 0.069 (unchanged signal).
--   * BIAS FIXED (the headline): with the need-led 0.35/0.65 weight,
--     corr(desert,NEED)=0.826 > corr(desert,SUPPLY)=0.797 over the mapped subset —
--     need now leads, reversing the legacy 0.656-need / 0.878-supply supply-domination.
--     (A naive 50/50 would have given 0.687-need / 0.908-supply — still supply-led — because
--     supply_scarcity has ~1.73x the within-subset spread; hence the reweight.)
--   * New worst deserts are genuine: rank 1-10 are Madhepura/Kishanganj/Kaimur/Supaul/Buxar
--     (Bihar, 1 mapped facility, need 84-92), Katihar/Nawada/Saran (Bihar, 2 fac, need
--     88-94), Bahraich (UP), Dumka (Jharkhand) — all real high-need low-supply districts.
--     The old top-10 zero-fac 87.0 pins (Araria/Lakhisarai/Banka Bihar, Pakur Jharkhand,
--     Panna MP) are now correctly flagged insufficient_supply_data (0 mapped facilities)
--     with NULL desert_rank — confirmed they no longer appear in the leaderboard.
--
-- KNOWN LIMITATIONS — FLAGGED FOR PETER (NOT defects this build can fix; see notes .md):
--   1. true-zero vs join-gap is INDISTINGUISHABLE at district grain. The 1,059 unmapped
--      facilities have NULL nfhs_district, so EVERY zero-mapped district is "supply
--      unknown", not provably "true zero". We therefore flag all 189 as
--      insufficient_supply_data rather than claiming to separate the two. Real separation
--      requires fixing the upstream pincode/crosswalk join (recovering the 1,059) or a
--      population/geographic prior — out of scope for this SELECT-only draft.
--   2. NO POPULATION DENOMINATOR. All scores are rank-normalized, never per-capita. The
--      need-led 0.35/0.65 weight here makes desert track need over the mapped subset
--      (corr 0.826 need vs 0.797 supply), but it is a rank-normalised blend, not a
--      per-capita rate. The durable fix is to normalise scarcity by district population
--      once a population denominator is available; until then the 0.35/0.65 weight is the
--      validated way to keep need in the lead. (For reference: z-scoring both terms before
--      a 50/50 blend gives an exact 0.812/0.812 tie — an alternative Peter may prefer if a
--      balanced rather than need-led desert is wanted.)
-- =====================================================================================
