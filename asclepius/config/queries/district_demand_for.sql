-- queryKey: district_demand_for  (the 9 discipline demand rows for one district; tiny result)
-- @param nfhs_district STRING
-- @param state STRING
SELECT
  nfhs_district,
  state,
  discipline,
  demand_score,
  top_driver
FROM workspace.app_state.district_demand
WHERE nfhs_district = :nfhs_district
  AND state = :state
ORDER BY demand_score DESC
LIMIT 20;
