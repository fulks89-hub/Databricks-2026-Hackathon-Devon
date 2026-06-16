-- =====================================================================================
-- data_readiness.sql  (Track 4 — Data Readiness Desk, per-facility readiness)
-- -------------------------------------------------------------------------------------
-- One row per facility (PK unique_id). Computed from the EXISTING app working data —
-- no silver re-clean required:
--   workspace.app_state.facilities_clean        -- quality flags + working fields the app reads
--   workspace.virtue_foundation_clean_v2.facilities  -- contact + address fields (join id = unique_id)
--   workspace.app_state.facility_district        -- Peter's join-gap (1,059 unmapped = high_leverage seed)
--   workspace.virtue_foundation_trust.facility_trust_card  -- Track-1 corroboration='none' = unverified claims
--
-- Presence convention for string contact fields: non-null, non-blank, and not a literal
-- 'null'/'[]'/'none'/'na'. has_coords = coord_source <> 'none' AND lat/lng present.
-- data_confidence (0..1) = inverse of flag density. completeness_score (0..100) over 8 fields.
-- high_leverage is SEEDED from Peter's unmapped/join-gap records (is_unmapped) plus any
-- flagged_quality record we can actually reach (has a contact channel).
-- =====================================================================================
CREATE OR REPLACE TABLE workspace.app_state.data_readiness AS
WITH tc AS (
  SELECT unique_id,
         COUNT(CASE WHEN corroboration = 'none' THEN 1 END) AS n_unverified,
         MAX(CASE WHEN corroboration = 'none' THEN claimed_specialty END) AS sample_unverified_specialty
  FROM workspace.virtue_foundation_trust.facility_trust_card
  GROUP BY unique_id
),
j AS (
  SELECT
    fc.id   AS unique_id,
    fc.name AS facility_name,
    fc.state AS state,
    fc.district AS district,
    fc.lat, fc.lng, fc.coord_source,
    fc.data_quality_flag, fc.possible_entity_dup, fc.id_valid,
    fc.capability, fc.procedure, fc.equipment, fc.beds, fc.year,
    size(fc.specialties) AS n_specialties,
    v.officialPhone, v.phone_numbers, v.email, v.officialWebsite, v.websites, v.facebookLink, v.source_urls,
    concat_ws(', ', v.address_line1, v.address_city, v.address_stateOrRegion, CAST(v.address_zipOrPostcode AS STRING)) AS address_text,
    v.address_zipOrPostcode,
    COALESCE(tc.n_unverified, 0) AS n_unverified,
    tc.sample_unverified_specialty,
    (fd.match_status = 'unmapped' OR fd.nfhs_district IS NULL) AS is_unmapped
  FROM workspace.app_state.facilities_clean fc
  LEFT JOIN workspace.virtue_foundation_clean_v2.facilities v ON v.unique_id = fc.id
  LEFT JOIN workspace.app_state.facility_district fd            ON fd.unique_id = fc.id
  LEFT JOIN tc                                                  ON tc.unique_id = fc.id
),
p AS (
  SELECT *,
    (officialPhone   IS NOT NULL AND trim(officialPhone)   <> '' AND lower(trim(officialPhone))   NOT IN ('null','[]','none','na','n/a')) AS has_ophone,
    (phone_numbers   IS NOT NULL AND trim(phone_numbers)   <> '' AND lower(trim(phone_numbers))   NOT IN ('null','[]','none','na','n/a')) AS has_phones,
    (email           IS NOT NULL AND trim(email)           <> '' AND lower(trim(email))           NOT IN ('null','[]','none','na','n/a')) AS has_email,
    (officialWebsite IS NOT NULL AND trim(officialWebsite) <> '' AND lower(trim(officialWebsite)) NOT IN ('null','[]','none','na','n/a')) AS has_oweb,
    (websites        IS NOT NULL AND trim(websites)        <> '' AND lower(trim(websites))        NOT IN ('null','[]','none','na','n/a')) AS has_websites,
    (facebookLink    IS NOT NULL AND trim(facebookLink)    <> '' AND lower(trim(facebookLink))    NOT IN ('null','[]','none','na','n/a')) AS has_facebook,
    (coord_source IS NOT NULL AND coord_source <> 'none' AND lat IS NOT NULL AND lng IS NOT NULL) AS has_coords,
    (capability IS NULL OR trim(capability) = '') AS sparse_capability,
    (procedure  IS NULL OR trim(procedure)  = '') AS sparse_procedure,
    (equipment  IS NULL OR trim(equipment)  = '') AS sparse_equipment,
    (beds IS NULL OR beds <= 0) AS sparse_beds,
    (year IS NULL OR year <= 0) AS sparse_year,
    (n_specialties = 0) AS sparse_specialties
  FROM j
),
d AS (
  SELECT *,
    (has_ophone OR has_phones) AS has_phone,
    (has_oweb OR has_websites) AS has_website,
    CASE WHEN has_ophone THEN officialPhone   WHEN has_phones   THEN phone_numbers END AS phone_value,
    CASE WHEN has_oweb   THEN officialWebsite WHEN has_websites THEN websites      END AS website_value
  FROM p
),
e AS (
  SELECT *,
    CASE WHEN has_phone THEN 'phone' WHEN has_email THEN 'email' WHEN has_website THEN 'website'
         WHEN has_facebook THEN 'facebook' ELSE 'none' END AS contact_channel,
    CASE WHEN has_phone THEN phone_value WHEN has_email THEN email WHEN has_website THEN website_value
         WHEN has_facebook THEN facebookLink ELSE NULL END AS contact_value
  FROM d
),
scored AS (
  SELECT *,
    CAST(ROUND(100.0 * (
        CAST(has_coords AS INT)
      + CAST((contact_channel <> 'none') AS INT)
      + CAST((NOT sparse_capability) AS INT)
      + CAST((NOT sparse_procedure) AS INT)
      + CAST((NOT sparse_equipment) AS INT)
      + CAST((beds IS NOT NULL AND beds > 0) AS INT)
      + CAST((year IS NOT NULL AND year > 0) AS INT)
      + CAST((n_specialties > 0) AS INT)
    ) / 8.0) AS INT) AS completeness_score,
    GREATEST(0.0, LEAST(1.0, ROUND(1.0
      - (CASE WHEN data_quality_flag      THEN 0.30 ELSE 0 END)
      - (CASE WHEN NOT id_valid           THEN 0.20 ELSE 0 END)
      - (CASE WHEN possible_entity_dup    THEN 0.25 ELSE 0 END)
      - (CASE WHEN n_unverified > 0       THEN 0.15 ELSE 0 END)
      - (CASE WHEN NOT has_coords         THEN 0.10 ELSE 0 END)
      - (CASE WHEN sparse_capability      THEN 0.10 ELSE 0 END)
    , 2))) AS data_confidence
  FROM e
),
final AS (
  SELECT *,
    CASE
      WHEN (data_quality_flag OR NOT id_valid)                 THEN 'flagged_quality'
      WHEN possible_entity_dup                                 THEN 'possible_duplicate'
      WHEN n_unverified > 0                                    THEN 'unverified_claims'
      WHEN NOT has_coords                                      THEN 'missing_coords'
      WHEN (NOT has_email AND NOT has_facebook)                THEN 'missing_contact'
      WHEN (sparse_capability OR sparse_procedure OR sparse_equipment
            OR sparse_beds OR sparse_year OR sparse_specialties) THEN 'sparse_fields'
      ELSE 'none'
    END AS primary_gap_type
  FROM scored
)
SELECT
  unique_id, facility_name, state, district, lat, lng,
  has_phone, has_email, has_website, has_facebook, has_coords,
  data_quality_flag, possible_entity_dup, id_valid,
  sparse_capability, sparse_procedure, sparse_equipment,
  sparse_beds, sparse_year, sparse_specialties,
  n_unverified AS unverified_claims, sample_unverified_specialty,
  is_unmapped,
  phone_value, email AS email_value, website_value, facebookLink AS facebook_value, source_urls,
  contact_channel, contact_value,
  completeness_score, data_confidence,
  primary_gap_type,
  (is_unmapped OR ((data_quality_flag OR NOT id_valid) AND contact_channel <> 'none')) AS high_leverage,
  address_text, address_zipOrPostcode
FROM final;
