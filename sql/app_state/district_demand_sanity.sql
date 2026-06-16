-- SANITY: are the high-demand signals clinically credible?
--  (1) Pediatrics high in Bihar/Jharkhand (childhood undernutrition/stunting)
--  (2) Cardiology high in Kerala (hypertension/diabetes burden)
--  (3) Obstetrics high where ANC / institutional-birth gaps are large
-- We report each discipline's mean demand_score per state for the relevant states,
-- plus the all-India state ranking position, to show direction is sensible.
WITH s AS (
  SELECT discipline, state, round(avg(demand_score),1) AS avg_score, count(*) AS n_dist
  FROM workspace.app_state.district_demand
  GROUP BY discipline, state
),
ranked AS (
  SELECT discipline, state, avg_score, n_dist,
         rank() OVER (PARTITION BY discipline ORDER BY avg_score DESC) AS state_rank,
         count(*) OVER (PARTITION BY discipline) AS n_states
  FROM s
)
SELECT discipline, state, avg_score, n_dist, state_rank, n_states
FROM ranked
WHERE (discipline='Pediatrics'  AND state IN ('Bihar','Jharkhand','Kerala'))
   OR (discipline='Cardiology'  AND state IN ('Kerala','Bihar'))
   OR (discipline='Obstetrics'  AND state IN ('Bihar','Uttar Pradesh','Nagaland','Kerala'))
ORDER BY discipline, avg_score DESC
