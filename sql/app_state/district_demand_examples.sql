-- 5 concrete high-demand district examples (grounded disciplines) with top_driver,
-- UNION a sample of the 3 proxy disciplines to confirm '(proxy)' tagging.
SELECT * FROM (
  SELECT nfhs_district, state, discipline, demand_score, top_driver
  FROM workspace.app_state.district_demand
  WHERE (discipline='Pediatrics' AND state='Bihar')
     OR (discipline='Cardiology' AND state='Kerala')
     OR (discipline='Obstetrics' AND state='Bihar')
  ORDER BY demand_score DESC
  LIMIT 5
)
UNION ALL
SELECT * FROM (
  SELECT nfhs_district, state, discipline, demand_score, top_driver
  FROM workspace.app_state.district_demand
  WHERE discipline IN ('Orthopedics','Ophthalmology','Trauma')
  ORDER BY demand_score DESC
  LIMIT 3
)
