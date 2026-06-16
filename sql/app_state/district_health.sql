-- app_state.district_health
-- One row per NFHS-5 district (706). REAL NFHS-5 prevalence (NOT modelled).
-- Each of the 7 HEALTH layers = NULL-safe AVG of its available component *_pct cols.
-- NULL-safe average pattern: sum of non-null components / count of non-null components,
--   implemented as a per-row average over a value-array filtered of NULLs (returns NULL
--   only when ALL components are NULL). Values are NFHS-5 percentages already on 0-100.
--
-- SOURCE-COLUMN -> LAYER MAPPING (exact):
--   ncd (Chronic / NCD) = AVG of:
--     w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct
--     m15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct
--     w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct
--     m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct
--   anaemia = AVG of:
--     all_w15_49_who_are_anaemic_pct
--     pregnant_w15_49_who_are_anaemic_lt_11_0_g_dl_22_pct
--     child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct
--     all_w15_19_who_are_anaemic_pct
--   malnutrition (child) = AVG of:
--     child_u5_who_are_stunted_height_for_age_18_pct
--     child_u5_who_are_wasted_weight_for_height_18_pct
--     child_u5_who_are_severe_wasted_weight_for_height_19_pct
--     child_u5_who_are_underweight_weight_for_age_18_pct
--     child_u5_who_are_overweight_weight_for_height_20_pct
--   womensnut (Women's nutrition) = AVG of:
--     women_age_15_49_years_whose_bmi_bmi_is_underweight_bmi_lt_1_pct
--     women_age_15_49_years_who_are_overweight_obese_bmi_gte_25_0_pct
--     women_age_15_49_years_who_have_high_risk_whr_gte_0_85_pct
--   acutechild (Acute child illness) = AVG of:
--     prev_diarrhoea_2wk_child_u5_pct
--     children_prev_symptoms_of_acute_respiratory_infection_ari_2_pct
--   cancerscreen (Cancer screening gaps) = 100 - AVG of screening RATES (so higher = bigger gap):
--     women_age_30_49_years_ever_undergone_a_cervical_screen_pct
--     women_age_30_49_years_ever_undergone_a_breast_exam_pct
--     women_age_30_49_years_ever_undergone_an_oral_cancer_exam_pct
--     (if all 3 rates are NULL -> cancerscreen is NULL, not 100)
--   riskfactors = AVG of:
--     w15_plus_who_use_any_kind_of_tobacco_pct
--     m15_plus_who_use_any_kind_of_tobacco_pct
--     w15_plus_who_consume_alcohol_pct
--     m15_plus_who_consume_alcohol_pct
--
-- Marquee raw indicators kept for citation:
--   all_w15_49_who_are_anaemic_pct, child_u5_who_are_stunted_height_for_age_18_pct
CREATE OR REPLACE VIEW workspace.app_state.district_health AS
WITH base AS (
  SELECT
    district_name AS nfhs_district,
    state_ut,
    -- NCD
    aggregate(filter(array(
        w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct,
        m15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct,
        w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct,
        m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct
      ), x -> x IS NOT NULL), CAST(0 AS DOUBLE), (acc, x) -> acc + x)
      / NULLIF(size(filter(array(
        w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct,
        m15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct,
        w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct,
        m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct
      ), x -> x IS NOT NULL)), 0) AS ncd,
    -- ANAEMIA
    aggregate(filter(array(
        all_w15_49_who_are_anaemic_pct,
        pregnant_w15_49_who_are_anaemic_lt_11_0_g_dl_22_pct,
        child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct,
        all_w15_19_who_are_anaemic_pct
      ), x -> x IS NOT NULL), CAST(0 AS DOUBLE), (acc, x) -> acc + x)
      / NULLIF(size(filter(array(
        all_w15_49_who_are_anaemic_pct,
        pregnant_w15_49_who_are_anaemic_lt_11_0_g_dl_22_pct,
        child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct,
        all_w15_19_who_are_anaemic_pct
      ), x -> x IS NOT NULL)), 0) AS anaemia,
    -- MALNUTRITION (child)
    aggregate(filter(array(
        child_u5_who_are_stunted_height_for_age_18_pct,
        child_u5_who_are_wasted_weight_for_height_18_pct,
        child_u5_who_are_severe_wasted_weight_for_height_19_pct,
        child_u5_who_are_underweight_weight_for_age_18_pct,
        child_u5_who_are_overweight_weight_for_height_20_pct
      ), x -> x IS NOT NULL), CAST(0 AS DOUBLE), (acc, x) -> acc + x)
      / NULLIF(size(filter(array(
        child_u5_who_are_stunted_height_for_age_18_pct,
        child_u5_who_are_wasted_weight_for_height_18_pct,
        child_u5_who_are_severe_wasted_weight_for_height_19_pct,
        child_u5_who_are_underweight_weight_for_age_18_pct,
        child_u5_who_are_overweight_weight_for_height_20_pct
      ), x -> x IS NOT NULL)), 0) AS malnutrition,
    -- WOMENSNUT
    aggregate(filter(array(
        women_age_15_49_years_whose_bmi_bmi_is_underweight_bmi_lt_1_pct,
        women_age_15_49_years_who_are_overweight_obese_bmi_gte_25_0_pct,
        women_age_15_49_years_who_have_high_risk_whr_gte_0_85_pct
      ), x -> x IS NOT NULL), CAST(0 AS DOUBLE), (acc, x) -> acc + x)
      / NULLIF(size(filter(array(
        women_age_15_49_years_whose_bmi_bmi_is_underweight_bmi_lt_1_pct,
        women_age_15_49_years_who_are_overweight_obese_bmi_gte_25_0_pct,
        women_age_15_49_years_who_have_high_risk_whr_gte_0_85_pct
      ), x -> x IS NOT NULL)), 0) AS womensnut,
    -- ACUTECHILD
    aggregate(filter(array(
        prev_diarrhoea_2wk_child_u5_pct,
        children_prev_symptoms_of_acute_respiratory_infection_ari_2_pct
      ), x -> x IS NOT NULL), CAST(0 AS DOUBLE), (acc, x) -> acc + x)
      / NULLIF(size(filter(array(
        prev_diarrhoea_2wk_child_u5_pct,
        children_prev_symptoms_of_acute_respiratory_infection_ari_2_pct
      ), x -> x IS NOT NULL)), 0) AS acutechild,
    -- CANCERSCREEN GAP = 100 - AVG(screening rates)
    CAST(100 AS DOUBLE) -
      aggregate(filter(array(
        women_age_30_49_years_ever_undergone_a_cervical_screen_pct,
        women_age_30_49_years_ever_undergone_a_breast_exam_pct,
        women_age_30_49_years_ever_undergone_an_oral_cancer_exam_pct
      ), x -> x IS NOT NULL), CAST(0 AS DOUBLE), (acc, x) -> acc + x)
      / NULLIF(size(filter(array(
        women_age_30_49_years_ever_undergone_a_cervical_screen_pct,
        women_age_30_49_years_ever_undergone_a_breast_exam_pct,
        women_age_30_49_years_ever_undergone_an_oral_cancer_exam_pct
      ), x -> x IS NOT NULL)), 0) AS cancerscreen,
    -- RISKFACTORS
    aggregate(filter(array(
        w15_plus_who_use_any_kind_of_tobacco_pct,
        m15_plus_who_use_any_kind_of_tobacco_pct,
        w15_plus_who_consume_alcohol_pct,
        m15_plus_who_consume_alcohol_pct
      ), x -> x IS NOT NULL), CAST(0 AS DOUBLE), (acc, x) -> acc + x)
      / NULLIF(size(filter(array(
        w15_plus_who_use_any_kind_of_tobacco_pct,
        m15_plus_who_use_any_kind_of_tobacco_pct,
        w15_plus_who_consume_alcohol_pct,
        m15_plus_who_consume_alcohol_pct
      ), x -> x IS NOT NULL)), 0) AS riskfactors,
    -- marquee raw indicators for citation
    all_w15_49_who_are_anaemic_pct,
    child_u5_who_are_stunted_height_for_age_18_pct
  FROM workspace.virtue_foundation_clean_v2.nfhs5_district_health
)
SELECT
  nfhs_district,
  state_ut,
  round(ncd, 1)          AS ncd,
  round(anaemia, 1)      AS anaemia,
  round(malnutrition, 1) AS malnutrition,
  round(womensnut, 1)    AS womensnut,
  round(acutechild, 1)   AS acutechild,
  round(cancerscreen, 1) AS cancerscreen,
  round(riskfactors, 1)  AS riskfactors,
  all_w15_49_who_are_anaemic_pct,
  child_u5_who_are_stunted_height_for_age_18_pct
FROM base;
