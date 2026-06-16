-- Self-test nfhs_indicator_specialty:
--  - total rows (expect 69)
--  - rows yielding >=1 ui_discipline
--  - context_only rows must have empty specialties_granular AND empty ui_disciplines
--  - condition/risk_factor rows with a mappable specialty must have >=1 ui_discipline
SELECT
  COUNT(*)                                                                  AS total_rows,
  SUM(CASE WHEN size(ui_disciplines) >= 1 THEN 1 ELSE 0 END)               AS rows_with_ui_discipline,
  SUM(CASE WHEN category = 'context_only'
            AND (size(specialties_granular) > 0 OR size(ui_disciplines) > 0)
           THEN 1 ELSE 0 END)                                              AS bad_context_only_rows,
  SUM(CASE WHEN category IN ('condition','risk_factor')
            AND size(specialties_granular) > 0
            AND size(ui_disciplines) = 0
           THEN 1 ELSE 0 END)                                              AS cond_risk_with_spec_but_no_ui
FROM workspace.app_state.nfhs_indicator_specialty
