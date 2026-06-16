-- Self-test ref_specialty_bridge aggregate: total rows, count NULL vs mapped,
-- count of any row whose discipline is outside the 9 (must be 0).
SELECT
  COUNT(*)                                                          AS total_rows,
  COUNT(ui_discipline)                                             AS mapped_rows,
  COUNT(*) - COUNT(ui_discipline)                                  AS null_rows,
  COUNT(DISTINCT ui_discipline)                                    AS distinct_disciplines,
  SUM(CASE WHEN ui_discipline IS NOT NULL AND ui_discipline NOT IN (
        'Cardiology','Nephrology','Oncology','Obstetrics','Pediatrics',
        'Orthopedics','Trauma','Ophthalmology','General Medicine')
      THEN 1 ELSE 0 END)                                           AS bad_discipline_rows
FROM workspace.app_state.ref_specialty_bridge
