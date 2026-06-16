-- queryKey: symptom_specialties  (patient-routing disciplines for a symptom; small filtered result)
-- @param symptom STRING
SELECT
  symptom,
  discipline,
  source_condition,
  source_indicator,
  confidence
FROM workspace.app_state.ref_symptom_specialty
WHERE LOWER(symptom) = LOWER(:symptom)
ORDER BY
  CASE LOWER(confidence)
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    WHEN 'low' THEN 3
    ELSE 4
  END,
  discipline ASC
LIMIT 50;
