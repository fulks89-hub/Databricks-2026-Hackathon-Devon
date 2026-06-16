-- Self-test ref_specialty_bridge: full contents ordered, plus a flag for any
-- ui_discipline that is not NULL and not one of the 9 canonical disciplines.
SELECT
  granular_specialty,
  ui_discipline,
  CASE
    WHEN ui_discipline IS NULL THEN 'NULL_ok'
    WHEN ui_discipline IN ('Cardiology','Nephrology','Oncology','Obstetrics',
      'Pediatrics','Orthopedics','Trauma','Ophthalmology','General Medicine')
      THEN 'in_9'
    ELSE 'BAD_NOT_IN_9'
  END AS check_flag
FROM workspace.app_state.ref_specialty_bridge
ORDER BY (ui_discipline IS NULL), ui_discipline, granular_specialty
