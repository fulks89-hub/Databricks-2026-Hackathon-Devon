-- Self-test: confirm column types are real ARRAY<STRING>, and show a few
-- representative rows (a condition, a care_gap, a context_only) for eyeballing.
SELECT
  indicator_col,
  category,
  typeof(symptoms)            AS symptoms_type,
  typeof(specialties_granular) AS spec_type,
  typeof(ui_disciplines)      AS ui_type,
  symptoms,
  specialties_granular,
  ui_disciplines
FROM workspace.app_state.nfhs_indicator_specialty
WHERE indicator_col IN (
  'w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct',  -- condition
  'women_age_30_49_years_ever_undergone_an_oral_cancer_exam_pct',     -- care_gap, all-NULL specialties
  'hh_use_improved_sanitation_pct',                                   -- context_only
  'child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct'                   -- condition w/ multi-discipline
)
ORDER BY indicator_col
