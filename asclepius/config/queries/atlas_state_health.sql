-- queryKey: atlas_state_health  (36 rows x 7 health layers; tiny result, well under 1MB cap)
SELECT
  state,
  ncd, anaemia, malnutrition, womensnut,
  acutechild, cancerscreen, riskfactors,
  district_count
FROM workspace.app_state.state_health
ORDER BY state ASC
LIMIT 50;
