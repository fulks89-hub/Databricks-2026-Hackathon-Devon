-- app_state.district_crosswalk
-- Passthrough of workspace.virtue_foundation_clean_v3.district_crosswalk.
-- Maps NFHS district names <-> pincode district names.
-- EXCLUDES _rescued_data.
CREATE OR REPLACE VIEW workspace.app_state.district_crosswalk AS
SELECT
  nfhs_district,      -- string
  nfhs_state,         -- string
  pincode_state,      -- string (UPPERCASE)
  pincode_district,   -- string (UPPERCASE)
  score,              -- bigint
  status              -- string: auto | resolved_agent | resolved_manual
FROM workspace.virtue_foundation_clean_v3.district_crosswalk;
