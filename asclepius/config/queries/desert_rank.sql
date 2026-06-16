-- queryKey: desert_rank  (top health-desert districts; parametrized LIMIT keeps result under 1MB cap)
-- @param limit INT
SELECT
  nfhs_district,
  state,
  facility_count,
  need_score,
  supply_scarcity,
  desert_score,
  desert_rank
FROM workspace.app_state.gold_district_supply_need
WHERE desert_rank IS NOT NULL
  AND desert_rank <= LEAST(:limit, 200)
ORDER BY desert_rank ASC
LIMIT 200;
