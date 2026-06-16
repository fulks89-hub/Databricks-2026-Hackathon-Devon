-- queryKey: facility_detail  (single facility full row; one-row result, well under 1MB cap)
-- @param facility_id STRING
SELECT
  id, name, type, city, state, lat, lng,
  specialties, specialties_detail, needs,
  trust, conf, beds, year,
  capability, procedure, equipment, description, evidence,
  claims, pincode, district,
  data_quality_flag, possible_entity_dup, id_valid, coord_source
FROM workspace.app_state.facilities
WHERE id = :facility_id
LIMIT 1;
