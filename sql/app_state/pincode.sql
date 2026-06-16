-- app_state.pincode
-- Typed passthrough of workspace.virtue_foundation_clean_v2.pincode.
-- Keeps the 7 contract columns; EXCLUDES _rescued_data (and the unused
-- circlename/regionname/divisionname/delivery cols not in the contract).
-- latitude/longitude are already double in source; passed through as-is.
CREATE OR REPLACE VIEW workspace.app_state.pincode AS
SELECT
  pincode,        -- bigint
  district,       -- string (UPPERCASE in source)
  statename,      -- string (UPPERCASE in source)
  latitude,       -- double
  longitude,      -- double
  officename,     -- string
  officetype      -- string
FROM workspace.virtue_foundation_clean_v2.pincode;
