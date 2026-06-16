-- app_state.state_coverage  (STATE_STRENGTH replacement)
-- Per state (Title-cased from facilities.state_norm): facility_count and a
-- coverage_index in [0,100].
--
-- STATE NORMALISATION: state = initcap(lower(state_norm)). Rows with NULL/empty
--   state_norm (437 facilities) are EXCLUDED from the per-state aggregation
--   (they have no state to attribute coverage to).
--
-- coverage_index FORMULA (documented):
--   coverage_index = ROUND( percent_rank() OVER (ORDER BY facility_count) * 100 , 1 )
--   i.e. the state's RANK position by facility supply, scaled 0..100.
--   * The least-supplied state -> 0, the most-supplied state -> 100, others
--     spread evenly by rank. percent_rank is used (rather than raw min-max of
--     facility_count) because the count distribution is heavily right-skewed
--     (Maharashtra ~1562 vs long tail of single-digit states); a raw min-max
--     would crush ~90% of states into the bottom decile and lose all
--     discrimination. Rank-scaling yields a usable 0..100 coverage spread for
--     the UI's STATE_STRENGTH choropleth.
--   * Interpretation: HIGH coverage_index = relatively well-supplied state;
--     LOW = supply-scarce state (candidate "desert" at the state level).
CREATE OR REPLACE VIEW workspace.app_state.state_coverage AS
WITH per_state AS (
  SELECT
    initcap(lower(state_norm)) AS state,
    COUNT(*) AS facility_count
  FROM workspace.virtue_foundation_clean_v2.facilities
  WHERE state_norm IS NOT NULL AND state_norm <> ''
  GROUP BY initcap(lower(state_norm))
)
SELECT
  state,
  facility_count,
  ROUND(percent_rank() OVER (ORDER BY facility_count) * 100, 1) AS coverage_index
FROM per_state;
