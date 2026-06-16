-- =====================================================================================
-- district_demand_FIX.sql   (NO REBUILD NEEDED — cosmetic is_proxy flag only)
-- -------------------------------------------------------------------------------------
-- DRAFTED FOR PETER TO REVIEW — NOT YET RUN ON LIVE. Validated READ-ONLY 2026-06-16.
--
-- VERDICT: district_demand DOES NOT NEED A FIX. It is already the correct, supply-free,
-- NFHS-need-only build. Do NOT rebuild or recompute it. The ONLY optional change is to
-- expose an explicit is_proxy flag so the app can BADGE the 3 low-confidence proxy
-- disciplines; the '(proxy) ' prefix in top_driver already encodes this, so even this is
-- cosmetic.
--
-- EVIDENCE (why no rebuild):
--   The live Lakebase read replica app_read.district_demand is BYTE-FOR-BYTE IDENTICAL to
--   the repo "RIGOROUS REBUILD" (workspace.app_state.district_demand), i.e. the NFHS-need-
--   only version with NO supply term:
--     * Schema/grain match: columns (nfhs_district, state, discipline, demand_score,
--       top_driver); 6,354 rows = 706 districts x 9 disciplines; NO supply column.
--     * Sample equality (Araria/Bihar): all 9 demand_score values and top_driver strings
--       identical live vs repo view (e.g. General Medicine 99.9 'Children 12-23m
--       rotavirus'; Obstetrics 97.7; the 3 proxy disciplines all 54.8 '(proxy) Tobacco
--       use (men)').
--     * Proxy structure matches the repo path exactly: the 3 proxy disciplines
--       (Orthopedics, Ophthalmology, Trauma) have ALL 706 rows '(proxy)'-prefixed; the 6
--       NFHS-grounded disciplines have ZERO proxy rows; 2,118/6,354 = 33.3% proxy.
--   So the 0.564 demand<->desert correlation Peter measured is NOT a leaked supply term in
--   demand. demand is computed PURELY from NFHS need indicators. That correlation is
--   (a) genuine need/supply co-location (high-need Bihar/Jharkhand districts really are
--   supply-poor) plus (b) inflation from the BROKEN desert_score (the 87.0 zero-fac pin
--   pushed high-need zero-fac districts to the top of desert, and those have high demand
--   because they have high need). Fixing desert_score (gold_district_supply_need_FIX.sql)
--   is what removes the spurious part — demand requires NO decoupling.
--
-- =====================================================================================
-- OPTION 1 (RECOMMENDED, zero behavioural change): DO NOTHING to the data.
-- The '(proxy) ' prefix on top_driver ALREADY marks the 3 proxy disciplines. The app can
-- badge low-confidence rows today with:
--     is_proxy = top_driver LIKE '(proxy)%'
-- No SQL change required. This is the cheapest correct option.
-- =====================================================================================

-- =====================================================================================
-- OPTION 2 (OPTIONAL, additive): add an explicit boolean is_proxy column so the app does
-- not have to string-match the prefix. This is a thin wrapper over the EXISTING view — it
-- does NOT recompute demand_score, does NOT touch the NFHS logic, and preserves every
-- existing column. Adopt ONLY if the app team prefers a typed flag over the prefix.
--
-- COLUMN CONTRACT preserved: nfhs_district, state, discipline, demand_score, top_driver
-- (all unchanged). ADDED: is_proxy (boolean).
--
-- is_proxy is defined two equivalent ways (both true for exactly the 3 proxy disciplines,
-- 2,118 rows); we AND-fold them defensively so the flag is correct even if a future
-- top_driver string drops the prefix:
--   - discipline IN ('Orthopedics','Ophthalmology','Trauma')   (the structural truth), OR
--   - top_driver LIKE '(proxy)%'                                (the label convention)
-- =====================================================================================
-- CREATE OR REPLACE VIEW workspace.app_state.district_demand AS   -- << uncomment to adopt
-- (Peter: leaving this as a SELECT so you can inspect the flag distribution first.)
SELECT
  nfhs_district,
  state,
  discipline,
  demand_score,            -- UNCHANGED: existing NFHS-need percentile per discipline
  top_driver,              -- UNCHANGED: keeps the '(proxy) ' prefix on proxy rows
  ( discipline IN ('Orthopedics','Ophthalmology','Trauma')
    OR top_driver LIKE '(proxy)%' )  AS is_proxy   -- NEW: explicit low-confidence badge
FROM workspace.app_state.district_demand;

-- VALIDATION (run to confirm before adopting Option 2):
--   SELECT is_proxy, COUNT(*) AS rows, COUNT(DISTINCT discipline) AS disciplines
--   FROM ( <SELECT above> )
--   GROUP BY is_proxy;
--   Expect: is_proxy=true -> 2,118 rows / 3 disciplines (Ortho, Ophthal, Trauma)
--           is_proxy=false -> 4,236 rows / 6 disciplines
--
-- NOTE: Option 2 makes district_demand SELECT FROM itself; do NOT run the CREATE OR
-- REPLACE against the SAME view it reads from in one step — it would be self-referential.
-- If adopting, either (a) point this wrapper at the upstream
-- workspace.app_state.district_demand only after renaming the base, or (b) add the
-- is_proxy expression directly into the final SELECT of the existing district_demand.sql
-- build (preferred — one source of truth). The cleanest patch is literally to append
-- the is_proxy expression to the final SELECT in
--   sql/app_state/district_demand.sql  (line ~238-244), e.g.:
--       SELECT nfhs_district, state, discipline,
--              ROUND(percent_rank() OVER (...) * 100, 1) AS demand_score,
--              top_driver,
--              (top_driver LIKE '(proxy)%') AS is_proxy
--       FROM combined;
-- =====================================================================================
