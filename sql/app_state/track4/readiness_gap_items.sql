-- =====================================================================================
-- readiness_gap_items.sql  (Track 4 — THE reviewer work-queue)
-- -------------------------------------------------------------------------------------
-- One row per (facility x gap_type) for every gap that fires => the queue a non-technical
-- Data Quality Reviewer works through. PK gap_id = unique_id || '__' || gap_type.
-- gap_type taxonomy + rule-based suggested_action engine (gap_type x contact_channel),
-- reconciled with Peter's audit: high_leverage is seeded from his unmapped/join-gap set
-- (carried on data_readiness.high_leverage) so his flagged records float to the top.
-- status lifecycle: open | patched | flagged | dismissed.
-- =====================================================================================
CREATE OR REPLACE TABLE workspace.app_state.readiness_gap_items AS
WITH dr AS (SELECT * FROM workspace.app_state.data_readiness)

-- 0) corrupted (id_valid=false: column-shifted / non-UUID id) -------------------------
SELECT
  concat(unique_id, '__corrupted') AS gap_id, unique_id, facility_name, state, district,
  'corrupted' AS gap_type,
  'Corrupted record - column-shifted / invalid (non-UUID) id. Re-extract from source or quarantine.' AS suggested_action,
  contact_channel, contact_value,
  concat_ws(', ', 'invalid_id', CASE WHEN data_quality_flag THEN 'data_quality_flag' END) AS missing_fields,
  high_leverage, 'open' AS status,
  data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 1 AS severity_rank
FROM dr WHERE NOT id_valid

UNION ALL
-- 1) flagged_quality (data_quality_flag, but a valid id — corrupted ones split out above)
SELECT
  concat(unique_id, '__flagged_quality') AS gap_id, unique_id, facility_name, state, district,
  'flagged_quality' AS gap_type,
  'Review flagged field; patch the value or quarantine the record.' AS suggested_action,
  contact_channel, contact_value,
  concat_ws(', ', CASE WHEN data_quality_flag THEN 'data_quality_flag' END) AS missing_fields,
  high_leverage, 'open' AS status,
  data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 1 AS severity_rank
FROM dr WHERE (data_quality_flag AND id_valid)

UNION ALL
-- 2) possible_duplicate ----------------------------------------------------------------
SELECT
  concat(unique_id, '__possible_duplicate'), unique_id, facility_name, state, district,
  'possible_duplicate',
  'Compare with candidate facility; merge or keep distinct, then record the decision in dup_decisions.',
  contact_channel, contact_value,
  'possible_entity_dup',
  high_leverage, 'open',
  data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 2
FROM dr WHERE possible_entity_dup

UNION ALL
-- 3) unverified_claims (Track-1 corroboration='none') ----------------------------------
SELECT
  concat(unique_id, '__unverified_claims'), unique_id, facility_name, state, district,
  'unverified_claims',
  CASE WHEN contact_channel <> 'none'
       THEN concat('Contact via ', contact_channel, ' (', contact_value, ') to confirm claimed ',
                   COALESCE(sample_unverified_specialty, 'specialty'),
                   ' (', CAST(unverified_claims AS STRING), ' unverified claim(s)).')
       ELSE concat('Flag for review - no contact channel to confirm claimed ',
                   COALESCE(sample_unverified_specialty, 'specialty'),
                   ' (', CAST(unverified_claims AS STRING), ' unverified claim(s)).')
  END,
  contact_channel, contact_value,
  concat('corroboration=none x', CAST(unverified_claims AS STRING)),
  high_leverage, 'open',
  data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 3
-- corrupted records (data_quality_flag / id_valid=false) are routed to flagged_quality
-- ONLY, so the clean sections keep real facility names — see scripts/track4_rebuild_gap_items.py
FROM dr WHERE unverified_claims > 0 AND NOT (data_quality_flag OR NOT id_valid)

UNION ALL
-- 4) missing_coords (coord_source='none') ----------------------------------------------
SELECT
  concat(unique_id, '__missing_coords'), unique_id, facility_name, state, district,
  'missing_coords',
  CASE WHEN contact_channel <> 'none'
       THEN concat('Geocode from address (', COALESCE(address_text, 'unknown'), '); confirm via ', contact_channel, '.')
       ELSE concat('Geocode from address (', COALESCE(address_text, 'unknown'), '); verify by field visit.')
  END,
  contact_channel, contact_value,
  'lat/lng (coord_source=none)',
  high_leverage, 'open',
  data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 4
FROM dr WHERE NOT has_coords AND NOT (data_quality_flag OR NOT id_valid)

UNION ALL
-- 5) missing_contact (no email AND no facebook) ----------------------------------------
SELECT
  concat(unique_id, '__missing_contact'), unique_id, facility_name, state, district,
  'missing_contact',
  CASE WHEN has_phone
       THEN concat('Call ', phone_value, ' to collect/confirm email & social contact.')
       ELSE 'Field visit / external lookup to obtain contact details.'
  END,
  contact_channel, contact_value,
  concat_ws(', ', CASE WHEN NOT has_email THEN 'email' END,
                  CASE WHEN NOT has_facebook THEN 'facebook' END,
                  CASE WHEN NOT has_phone THEN 'phone' END),
  high_leverage, 'open',
  data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 5
FROM dr WHERE (NOT has_email AND NOT has_facebook) AND NOT (data_quality_flag OR NOT id_valid)

UNION ALL
-- 6) sparse_fields (capability/procedure/equipment) ------------------------------------
SELECT
  concat(unique_id, '__sparse_fields'), unique_id, facility_name, state, district,
  'sparse_fields',
  CASE WHEN contact_channel <> 'none'
       THEN concat('Enrich ', concat_ws(', ', CASE WHEN sparse_capability THEN 'capability' END,
                                              CASE WHEN sparse_procedure THEN 'procedure' END,
                                              CASE WHEN sparse_equipment THEN 'equipment' END,
                                              CASE WHEN sparse_beds THEN 'beds' END,
                                              CASE WHEN sparse_year THEN 'year' END,
                                              CASE WHEN sparse_specialties THEN 'specialties' END),
                   ' from ', contact_channel, ' / source URL.')
       ELSE concat('Enrich ', concat_ws(', ', CASE WHEN sparse_capability THEN 'capability' END,
                                              CASE WHEN sparse_procedure THEN 'procedure' END,
                                              CASE WHEN sparse_equipment THEN 'equipment' END,
                                              CASE WHEN sparse_beds THEN 'beds' END,
                                              CASE WHEN sparse_year THEN 'year' END,
                                              CASE WHEN sparse_specialties THEN 'specialties' END),
                   ' from source URL / external lookup.')
  END,
  contact_channel, contact_value,
  concat_ws(', ', CASE WHEN sparse_capability THEN 'capability' END,
                  CASE WHEN sparse_procedure THEN 'procedure' END,
                  CASE WHEN sparse_equipment THEN 'equipment' END,
                  CASE WHEN sparse_beds THEN 'beds' END,
                  CASE WHEN sparse_year THEN 'year' END,
                  CASE WHEN sparse_specialties THEN 'specialties' END),
  high_leverage, 'open',
  data_confidence, completeness_score, sample_unverified_specialty, unverified_claims, 6
FROM dr WHERE (sparse_capability OR sparse_procedure OR sparse_equipment
               OR sparse_beds OR sparse_year OR sparse_specialties) AND NOT (data_quality_flag OR NOT id_valid);
