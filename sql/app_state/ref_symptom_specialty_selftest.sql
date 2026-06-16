-- Self-test 1: overall shape + all-9 coverage check.
-- distinct_symptoms (expect ~90-110); distinct_disciplines; total_rows;
-- discipline_violations (values not in the 9 -> must be 0);
-- all_nine_present (1 if every one of the 9 disciplines appears).
SELECT
  COUNT(*)                                  AS total_rows,
  COUNT(DISTINCT symptom)                   AS distinct_symptoms,
  COUNT(DISTINCT discipline)                AS distinct_disciplines,
  SUM(CASE WHEN discipline NOT IN (
        'Cardiology','Nephrology','Oncology','Obstetrics','Pediatrics',
        'Orthopedics','Trauma','Ophthalmology','General Medicine'
      ) THEN 1 ELSE 0 END)                  AS discipline_violations,
  CASE WHEN COUNT(DISTINCT CASE WHEN discipline IN (
        'Cardiology','Nephrology','Oncology','Obstetrics','Pediatrics',
        'Orthopedics','Trauma','Ophthalmology','General Medicine'
      ) THEN discipline END) = 9 THEN 1 ELSE 0 END AS all_nine_present
FROM workspace.app_state.ref_symptom_specialty
