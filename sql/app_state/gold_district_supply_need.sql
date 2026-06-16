-- app_state.gold_district_supply_need
-- Passthrough of workspace.virtue_foundation_clean_v3.gold_district_supply_need.
-- All columns except _rescued_data.
CREATE OR REPLACE VIEW workspace.app_state.gold_district_supply_need AS
SELECT
  nfhs_district,
  state,
  institutional_birth_5y_pct,
  mothers_who_had_at_least_4_anc_visits_lb5y_pct,
  hh_use_improved_sanitation_pct,
  hh_member_covered_health_insurance_pct,
  child_u5_who_are_stunted_height_for_age_18_pct,
  child_u5_who_are_underweight_weight_for_age_18_pct,
  all_w15_49_who_are_anaemic_pct,
  facility_count,     -- bigint
  need_score,         -- double
  supply_scarcity,    -- double
  desert_score,       -- double
  desert_rank         -- bigint
FROM workspace.virtue_foundation_clean_v3.gold_district_supply_need;
