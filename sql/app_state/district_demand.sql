-- =====================================================================================
-- app_state.district_demand  (RIGOROUS REBUILD, driven by nfhs_indicator_specialty)
-- -------------------------------------------------------------------------------------
-- LONG format: one row per (nfhs_district, state, discipline). Grain is EXACTLY
-- 706 districts x 9 disciplines = 6,354 rows. demand_score is a per-discipline
-- rank-scaled burden in [0,100]; top_driver names the dominant indicator.
--
-- CONTRACT (must not change - app_state.facilities.needs joins this LIVE):
--   nfhs_district STRING  -- canonical, spelled exactly as gold_district_supply_need
--   state         STRING  -- Title Case, spelled exactly as gold_district_supply_need
--   discipline    STRING  -- one of the 9 UI disciplines (ref_disciplines)
--   demand_score  DOUBLE  -- [0,100], no nulls
--   top_driver    STRING  -- human-readable; '(proxy) ...' for the 3 proxy disciplines
-- Canonical (nfhs_district, state) keys come from gold_district_supply_need so the
-- facilities.needs join (facility_district.nfhs_district = district_demand.nfhs_district
-- AND facility_district.nfhs_state = district_demand.state) stays an EXACT match.
--
-- METHOD
-- (a) 6 NFHS-GROUNDED disciplines: General Medicine, Cardiology, Nephrology,
--     Obstetrics, Pediatrics, Oncology. For each district, gather every
--     nfhs_indicator_specialty row whose ui_disciplines contains the discipline AND
--     category IN ('condition','risk_factor','care_gap') (context_only EXCLUDED; the
--     single 'context' direction C-section row is also excluded). Pull each
--     indicator's value from nfhs5_district_health by indicator_col. Apply DIRECTION:
--       direction starts 'high_pct_bad' -> adjusted = value (higher % = worse)
--       direction starts 'low_pct_bad'  -> adjusted = 100 - value (coverage gap)
--     raw_burden = district-discipline MEAN of adjusted values (NULL indicator values
--     ignored). top_driver = nfhs_plain_label of the indicator with the single highest
--     adjusted value for that district+discipline.
-- (b) 3 PROXY disciplines with NO NFHS basis: Orthopedics, Ophthalmology, Trauma.
--     NFHS-5 has no MSK / injury / eye measures. We carry a behavioural RISK-FACTOR
--     proxy = mean(tobacco_w, tobacco_m, alcohol_w, alcohol_m) so all 9 disciplines
--     stay present (contract = 706x9). top_driver is prefixed '(proxy) ' and these
--     three rows are documented LOW-CONFIDENCE proxies.
--     (NB: 3 NFHS care-seeking care-gaps bridge emergencymedicine->Trauma, but those
--      are paediatric care-seeking, not injury load, so per spec Trauma is kept as the
--      tobacco/alcohol proxy for a clean, documented basis.)
--
-- demand_score = ROUND(percent_rank() OVER (PARTITION BY discipline ORDER BY raw_burden)
--                * 100, 1) for ALL 9 disciplines, giving each a full 0..100 spread.
-- Every district matches NFHS (706/706), so every district-discipline has a non-null
-- raw_burden; COALESCE(...,0) guards the theoretical all-null case so no row is dropped.
--
-- Idempotent: CREATE OR REPLACE VIEW. EXCLUDES _rescued_data (source table has none in
-- the referenced columns). Self-tests live in district_demand_selftest*.sql.
-- =====================================================================================
CREATE OR REPLACE VIEW workspace.app_state.district_demand AS
WITH
-- 1) canonical 706 district keys (gold spelling) x 9 disciplines = 6,354 skeleton rows
disciplines AS (
  SELECT discipline FROM workspace.app_state.ref_disciplines
),
keys AS (
  SELECT g.nfhs_district, g.state
  FROM workspace.app_state.gold_district_supply_need g
),
skeleton AS (
  SELECT k.nfhs_district, k.state, d.discipline
  FROM keys k CROSS JOIN disciplines d
),
-- 2) attach each canonical district to its NFHS row (case-insensitive; 706/706 match)
key_to_nfhs AS (
  SELECT
    k.nfhs_district,
    k.state,
    n.*
  FROM keys k
  JOIN workspace.virtue_foundation_clean_v2.nfhs5_district_health n
    ON lower(trim(k.nfhs_district)) = lower(trim(n.district_name))
   AND lower(trim(k.state))         = lower(trim(n.state_ut))
),
-- 3) unpivot the 55 NFHS-grounded indicator columns to long form (district, indicator, value)
nfhs_long AS (
  SELECT nfhs_district, state, indicator_col, CAST(value AS DOUBLE) AS value
  FROM key_to_nfhs
  LATERAL VIEW STACK(55,
      'all_w15_19_who_are_anaemic_pct', `all_w15_19_who_are_anaemic_pct`,
      'all_w15_49_who_are_anaemic_pct', `all_w15_49_who_are_anaemic_pct`,
      'births_attended_by_skilled_hp_5y_10_pct', `births_attended_by_skilled_hp_5y_10_pct`,
      'child_12_23m_fully_vaccinated_based_on_information_from_vax_pct', `child_12_23m_fully_vaccinated_based_on_information_from_vax_pct`,
      'child_12_23m_who_have_received_3_doses_of_penta_or_dpt_vacc_pct', `child_12_23m_who_have_received_3_doses_of_penta_or_dpt_vacc_pct`,
      'child_12_23m_who_have_received_3_doses_of_polio_vaccine_pct', `child_12_23m_who_have_received_3_doses_of_polio_vaccine_pct`,
      'child_12_23m_who_have_received_3_doses_of_rotavirus_vaccine_pct', `child_12_23m_who_have_received_3_doses_of_rotavirus_vaccine_pct`,
      'child_12_23m_who_have_received_bcg_pct', `child_12_23m_who_have_received_bcg_pct`,
      'child_12_23m_who_have_received_the_first_dose_of_mcv_mcv_pct', `child_12_23m_who_have_received_the_first_dose_of_mcv_mcv_pct`,
      'child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct', `child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct`,
      'child_9_35m_who_received_a_vit_a_in_the_last_6_months_pct', `child_9_35m_who_received_a_vit_a_in_the_last_6_months_pct`,
      'child_u5_who_are_overweight_weight_for_height_20_pct', `child_u5_who_are_overweight_weight_for_height_20_pct`,
      'child_u5_who_are_severe_wasted_weight_for_height_19_pct', `child_u5_who_are_severe_wasted_weight_for_height_19_pct`,
      'child_u5_who_are_stunted_height_for_age_18_pct', `child_u5_who_are_stunted_height_for_age_18_pct`,
      'child_u5_who_are_underweight_weight_for_age_18_pct', `child_u5_who_are_underweight_weight_for_age_18_pct`,
      'child_u5_who_are_wasted_weight_for_height_18_pct', `child_u5_who_are_wasted_weight_for_height_18_pct`,
      'child_u6m_exclusively_breastfed_pct', `child_u6m_exclusively_breastfed_pct`,
      'children_prev_symptoms_of_acute_respiratory_infection_ari_2_pct', `children_prev_symptoms_of_acute_respiratory_infection_ari_2_pct`,
      'children_with_diarrhoea_2wk_taken_to_a_health_facility_or_h_pct', `children_with_diarrhoea_2wk_taken_to_a_health_facility_or_h_pct`,
      'children_with_diarrhoea_2wk_who_received_oral_rehydration_s_pct', `children_with_diarrhoea_2wk_who_received_oral_rehydration_s_pct`,
      'children_with_diarrhoea_2wk_who_received_zinc_child_u5_pct', `children_with_diarrhoea_2wk_who_received_zinc_child_u5_pct`,
      'children_with_fever_or_symptoms_of_ari_2wk_taken_to_a_healt_pct', `children_with_fever_or_symptoms_of_ari_2wk_taken_to_a_healt_pct`,
      'fp_cm_w15_49_modern_method_pct', `fp_cm_w15_49_modern_method_pct`,
      'fp_unmet_total_cm_w15_49_7_pct', `fp_unmet_total_cm_w15_49_7_pct`,
      'households_using_iodized_salt_pct', `households_using_iodized_salt_pct`,
      'institutional_birth_5y_pct', `institutional_birth_5y_pct`,
      'm15_plus_who_consume_alcohol_pct', `m15_plus_who_consume_alcohol_pct`,
      'm15_plus_who_use_any_kind_of_tobacco_pct', `m15_plus_who_use_any_kind_of_tobacco_pct`,
      'm15_plus_with_high_141_160_mg_dl_blood_sugar_pct', `m15_plus_with_high_141_160_mg_dl_blood_sugar_pct`,
      'm15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct', `m15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct`,
      'm15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct', `m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct`,
      'm15_plus_with_mildly_high_bp_sys_140_159_mmhg_and_or_dia_90_pct', `m15_plus_with_mildly_high_bp_sys_140_159_mmhg_and_or_dia_90_pct`,
      'm15_plus_with_moderately_or_severely_high_bp_sys_gte_160_mm_pct', `m15_plus_with_moderately_or_severely_high_bp_sys_gte_160_mm_pct`,
      'men_age_15_years_and_above_with_very_high_gt_160_mg_dl_bloo_pct', `men_age_15_years_and_above_with_very_high_gt_160_mg_dl_bloo_pct`,
      'mothers_who_consumed_ifa_for_180_days_or_more_when_they_wer_pct', `mothers_who_consumed_ifa_for_180_days_or_more_when_they_wer_pct`,
      'mothers_who_had_an_anc_visit_in_the_first_trimester_lb5y_pct', `mothers_who_had_an_anc_visit_in_the_first_trimester_lb5y_pct`,
      'mothers_who_had_at_least_4_anc_visits_lb5y_pct', `mothers_who_had_at_least_4_anc_visits_lb5y_pct`,
      'mothers_who_received_pnc_from_a_doctor_nurse_lhv_anm_midwif_pct', `mothers_who_received_pnc_from_a_doctor_nurse_lhv_anm_midwif_pct`,
      'non_pregnant_w15_49_who_are_anaemic_lt_12_0_g_dl_22_pct', `non_pregnant_w15_49_who_are_anaemic_lt_12_0_g_dl_22_pct`,
      'pregnant_w15_49_who_are_anaemic_lt_11_0_g_dl_22_pct', `pregnant_w15_49_who_are_anaemic_lt_11_0_g_dl_22_pct`,
      'prev_diarrhoea_2wk_child_u5_pct', `prev_diarrhoea_2wk_child_u5_pct`,
      'total_child_6_23m_receiving_an_adequate_diet16_17_pct', `total_child_6_23m_receiving_an_adequate_diet16_17_pct`,
      'w15_plus_who_consume_alcohol_pct', `w15_plus_who_consume_alcohol_pct`,
      'w15_plus_who_use_any_kind_of_tobacco_pct', `w15_plus_who_use_any_kind_of_tobacco_pct`,
      'w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct', `w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct`,
      'w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct', `w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct`,
      'w15_plus_with_mildly_high_bp_sys_140_159_mmhg_and_or_dia_90_pct', `w15_plus_with_mildly_high_bp_sys_140_159_mmhg_and_or_dia_90_pct`,
      'w15_plus_with_moderately_or_severely_high_bp_sys_gte_160_mm_pct', `w15_plus_with_moderately_or_severely_high_bp_sys_gte_160_mm_pct`,
      'w15_plus_with_very_high_gt_160_mg_dl_blood_sugar_pct', `w15_plus_with_very_high_gt_160_mg_dl_blood_sugar_pct`,
      'women_age_15_49_years_who_are_overweight_obese_bmi_gte_25_0_pct', `women_age_15_49_years_who_are_overweight_obese_bmi_gte_25_0_pct`,
      'women_age_15_49_years_who_have_high_risk_whr_gte_0_85_pct', `women_age_15_49_years_who_have_high_risk_whr_gte_0_85_pct`,
      'women_age_15_49_years_whose_bmi_bmi_is_underweight_bmi_lt_1_pct', `women_age_15_49_years_whose_bmi_bmi_is_underweight_bmi_lt_1_pct`,
      'women_age_15_years_and_above_with_high_141_160_mg_dl_blood_pct', `women_age_15_years_and_above_with_high_141_160_mg_dl_blood_pct`,
      'women_age_30_49_years_ever_undergone_a_breast_exam_pct', `women_age_30_49_years_ever_undergone_a_breast_exam_pct`,
      'women_age_30_49_years_ever_undergone_a_cervical_screen_pct', `women_age_30_49_years_ever_undergone_a_cervical_screen_pct`
    ) stk AS indicator_col, value
),
-- 4) catalog of NFHS-grounded indicator->discipline rules (exclude context_only & 'context')
rules AS (
  SELECT
    n.indicator_col,
    n.nfhs_plain_label,
    d.disc AS discipline,
    lower(trim(n.direction)) AS direction
  FROM workspace.app_state.nfhs_indicator_specialty n
  LATERAL VIEW explode(n.ui_disciplines) d AS disc
  WHERE n.category IN ('condition','risk_factor','care_gap')
    AND lower(trim(n.direction)) NOT LIKE 'context%'
    -- the 6 NFHS-grounded disciplines ONLY. Trauma is intentionally EXCLUDED here even
    -- though 3 paediatric care-seeking care-gaps bridge emergencymedicine->Trauma: per
    -- spec Trauma (with Orthopedics & Ophthalmology) is a documented tobacco/alcohol
    -- PROXY discipline, so it must come solely from the proxy path (no double-count).
    AND d.disc IN ('General Medicine','Cardiology','Nephrology','Obstetrics','Pediatrics','Oncology')
),
-- 5) adjusted value per (district, discipline, indicator) applying DIRECTION
adj AS (
  SELECT
    l.nfhs_district,
    l.state,
    r.discipline,
    r.indicator_col,
    r.nfhs_plain_label,
    CASE
      WHEN r.direction LIKE 'high_pct_bad%' THEN l.value
      WHEN r.direction LIKE 'low_pct_bad%'  THEN 100.0 - l.value
      ELSE l.value
    END AS adj_value
  FROM nfhs_long l
  JOIN rules r ON l.indicator_col = r.indicator_col
  WHERE l.value IS NOT NULL
),
-- 6a) NFHS-grounded raw burden = mean adjusted value per district-discipline
grounded_burden AS (
  SELECT nfhs_district, state, discipline, avg(adj_value) AS raw_burden
  FROM adj
  GROUP BY nfhs_district, state, discipline
),
-- 6b) NFHS-grounded top_driver = label of single highest adjusted value
grounded_top AS (
  SELECT nfhs_district, state, discipline, nfhs_plain_label AS top_driver
  FROM (
    SELECT a.*,
      row_number() OVER (
        PARTITION BY a.nfhs_district, a.state, a.discipline
        ORDER BY a.adj_value DESC, a.indicator_col
      ) AS rn
    FROM adj a
  ) WHERE rn = 1
),
grounded AS (
  SELECT b.nfhs_district, b.state, b.discipline, b.raw_burden, t.top_driver
  FROM grounded_burden b
  JOIN grounded_top t
    ON b.nfhs_district = t.nfhs_district AND b.state = t.state AND b.discipline = t.discipline
),
-- 7) PROXY disciplines (Orthopedics, Ophthalmology, Trauma): tobacco+alcohol risk proxy
proxy_src AS (
  SELECT
    nfhs_district, state,
    w15_plus_who_use_any_kind_of_tobacco_pct AS w_tob,
    m15_plus_who_use_any_kind_of_tobacco_pct AS m_tob,
    w15_plus_who_consume_alcohol_pct         AS w_alc,
    m15_plus_who_consume_alcohol_pct         AS m_alc
  FROM key_to_nfhs
),
proxy_burden AS (
  SELECT
    nfhs_district, state, p.discipline,
    (coalesce(w_tob,0) + coalesce(m_tob,0) + coalesce(w_alc,0) + coalesce(m_alc,0))
      / nullif(
          (CASE WHEN w_tob IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN m_tob IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN w_alc IS NULL THEN 0 ELSE 1 END)
        + (CASE WHEN m_alc IS NULL THEN 0 ELSE 1 END), 0)            AS raw_burden,
    -- top_driver = the larger-of the proxy risk factors, prefixed (proxy)
    CASE greatest(coalesce(m_tob,-1), coalesce(w_tob,-1), coalesce(m_alc,-1), coalesce(w_alc,-1))
      WHEN coalesce(m_tob,-1) THEN '(proxy) Tobacco use (men)'
      WHEN coalesce(w_tob,-1) THEN '(proxy) Tobacco use (women)'
      WHEN coalesce(m_alc,-1) THEN '(proxy) Alcohol use (men)'
      ELSE '(proxy) Alcohol use (women)'
    END AS top_driver
  FROM proxy_src
  CROSS JOIN (SELECT explode(array('Orthopedics','Ophthalmology','Trauma')) AS discipline) p
),
-- 8) union grounded + proxy, then attach to the full 706x9 skeleton so the grain is exact
burdens AS (
  SELECT nfhs_district, state, discipline, raw_burden, top_driver FROM grounded
  UNION ALL
  SELECT nfhs_district, state, discipline, raw_burden, top_driver FROM proxy_burden
),
combined AS (
  SELECT
    s.nfhs_district,
    s.state,
    s.discipline,
    coalesce(b.raw_burden, 0.0)                       AS raw_burden,
    coalesce(b.top_driver, '(no NFHS basis)')         AS top_driver
  FROM skeleton s
  LEFT JOIN burdens b
    ON s.nfhs_district = b.nfhs_district AND s.state = b.state AND s.discipline = b.discipline
)
SELECT
  nfhs_district,
  state,
  discipline,
  ROUND(percent_rank() OVER (PARTITION BY discipline ORDER BY raw_burden) * 100, 1) AS demand_score,
  top_driver
FROM combined;
