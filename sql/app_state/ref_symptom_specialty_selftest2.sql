-- Self-test 2: per-discipline row + distinct-symptom counts (all 9 must appear,
-- Orthopedics & Ophthalmology now present via base seeds).
SELECT
  discipline,
  COUNT(*)                AS rows,
  COUNT(DISTINCT symptom) AS distinct_symptoms
FROM workspace.app_state.ref_symptom_specialty
GROUP BY discipline
ORDER BY discipline
