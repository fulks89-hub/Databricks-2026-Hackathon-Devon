-- queryKey: atlas_district_health  (706 districts x 7 health layers; ~706 small rows, under 1MB cap)
SELECT
  nfhs_district,
  state_ut,
  ncd, anaemia, malnutrition, womensnut,
  acutechild, cancerscreen, riskfactors
FROM workspace.app_state.district_health
ORDER BY state_ut ASC, nfhs_district ASC
LIMIT 800;
