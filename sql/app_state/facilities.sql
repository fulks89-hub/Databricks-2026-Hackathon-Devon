-- =====================================================================
-- app_state.facilities  — central UI-contract view over the real source
--   workspace.virtue_foundation_clean_v2.facilities (10,077 rows)
-- One row per facility, mapped to the Asclepius React data contract.
-- Idempotent: CREATE OR REPLACE VIEW. Excludes _rescued_data.
--
-- DERIVATION RULES (documented inline; see also the return report):
--  type    : Title-case facilityTypeId IF it is in the known set
--            {hospital,clinic,dentist,doctor,pharmacy,nursing_home};
--            otherwise (empty / corrupt column-shifted numeric|JSON) -> 'Facility'.
--            For hospitals, prefix operatorTypeId display (Public/Private) when
--            operatorTypeId is in {private,public,government}.
--  specialties        : explode from_json(specialties,'array<string>'),
--                        LEFT JOIN ref_specialty_discipline on trim(tok)=raw_specialty,
--                        collect_set(discipline) dropping NULLs -> ARRAY<STRING> of the 9 UI disciplines.
--  specialties_detail : collect_list of the raw exploded camelCase tokens (deduped) -> ARRAY<STRING>.
--  conf (0-100): transparent coverage score.
--            55 base; +12 officialWebsite present; +8 coord_source='original';
--            +8 capability present; +7 procedure present; +5 equipment present;
--            +5 yearEstablished not null; -25 if data_quality_flag; -10 if not id_valid;
--            clamp to [20,95].
--  trust   : claims are UNVERIFIED by premise (Trust Desk's job).
--            'unverified' if data_quality_flag OR conf<40; else 'review' (=claimed).
--            'verified' is NEVER emitted here (user verification promotes it later).
--  claims  : from from_json(capability,'array<string>'), first <=6 elements ->
--            ARRAY<STRUCT<text:string,status:string>> with status='review'.
--            Falls back to procedure array when capability is empty.
--  needs   : INFERRED AREA-NEED GAPS (real NFHS-5 grounded). ARRAY<STRING> of the
--            UI disciplines that are HIGH-DEMAND in the facility's NFHS district
--            (app_state.district_demand.demand_score >= 70, where demand_score is the
--            per-discipline rank-scaled burden from NFHS-5 indicators) but that are
--            NOT already in this facility's mapped `specialties`. Ordered by
--            demand_score DESC (tie-break discipline name) and capped at the top 3.
--            Semantics: "disciplines this district most needs that this facility does
--            not advertise" -> powers the clinician 'Inferred gaps' feature and the
--            facility-detail 'Gaps' chips. Join path: app_state.facility_district
--            (post state-case fix) gives (nfhs_district, nfhs_state); we join
--            district_demand ON (nfhs_district = nfhs_district, nfhs_state = state)
--            -- both are now the SAME Title-Case convention as gold, so the join is
--            an EXACT match. Facilities with no resolved district, or with no
--            high-demand UNMET discipline, keep needs = [] (valid empty array).
--            Every emitted element is one of the 9 UI disciplines and is guaranteed
--            absent from that facility's `specialties`.
--  beds    : try_cast(capacity AS int)  (nullable).
--  year    : try_cast(yearEstablished AS int)  (nullable).
--  city    : address_city.
--  state   : initcap(lower(state_norm)) fallback initcap(address_stateOrRegion).
--  pincode : try_cast(address_zipOrPostcode AS bigint).
--  district: via join path zip->pincode.pincode->pincode.district (may be NULL).
--  capability/procedure/equipment : array_join(parsed array, '; ') -> natural free text STRING.
--  description : as-is.  evidence : = description (UI quotes evidence as source).
-- =====================================================================
CREATE OR REPLACE VIEW workspace.app_state.facilities AS
WITH
-- pincode -> single district (pincode is NOT unique in source: up to 153 rows/pincode,
-- and some pincodes span >1 district). Pick the most frequent district per pincode so the
-- join is 1:1 and the facilities row count stays exactly 10,077.
pin_district AS (
  SELECT pincode, district FROM (
    SELECT
      pincode,
      district,
      row_number() OVER (
        PARTITION BY pincode
        ORDER BY count(*) DESC, district
      ) AS rn
    FROM workspace.virtue_foundation_clean_v2.pincode
    WHERE district IS NOT NULL AND district <> ''
    GROUP BY pincode, district
  ) WHERE rn = 1
),
src AS (
  SELECT
    unique_id,
    name,
    facilityTypeId,
    operatorTypeId,
    address_city,
    state_norm,
    address_stateOrRegion,
    address_zipOrPostcode,
    latitude,
    longitude,
    coord_source,
    description,
    capability,
    procedure,
    equipment,
    yearEstablished,
    capacity,
    officialWebsite,
    data_quality_flag,
    possible_entity_dup,
    id_valid,
    from_json(specialties, 'array<string>') AS spec_arr,
    from_json(capability,  'array<string>') AS capab_arr,
    from_json(procedure,   'array<string>') AS proc_arr,
    from_json(equipment,   'array<string>') AS equip_arr
  FROM workspace.virtue_foundation_clean_v2.facilities
),
-- explode raw specialty tokens and map each to a UI discipline (NULL if unmapped)
exploded AS (
  SELECT
    s.unique_id,
    trim(e.tok) AS raw_tok,
    rsd.discipline
  FROM src s
  LEFT JOIN LATERAL explode_outer(s.spec_arr) AS e(tok)
  LEFT JOIN workspace.app_state.ref_specialty_discipline rsd
    ON trim(e.tok) = rsd.raw_specialty
),
spec_agg AS (
  SELECT
    unique_id,
    -- mapped 9 UI disciplines (drop NULLs), distinct
    array_sort(collect_set(discipline))                                   AS specialties,
    -- raw real tokens for the detail view (drop empty/NULL), distinct
    array_sort(collect_set(CASE WHEN raw_tok IS NOT NULL AND raw_tok <> '' THEN raw_tok END)) AS specialties_detail
  FROM exploded
  GROUP BY unique_id
),
derived AS (
  SELECT
    s.*,
    coalesce(sa.specialties, array())          AS specialties_mapped,
    coalesce(sa.specialties_detail, array())   AS specialties_detail,
    -- conf score
    least(95, greatest(20,
        55
      + CASE WHEN s.officialWebsite IS NOT NULL AND s.officialWebsite <> '' THEN 12 ELSE 0 END
      + CASE WHEN s.coord_source = 'original' THEN 8 ELSE 0 END
      + CASE WHEN s.capability IS NOT NULL AND s.capability <> '' THEN 8 ELSE 0 END
      + CASE WHEN s.procedure  IS NOT NULL AND s.procedure  <> '' THEN 7 ELSE 0 END
      + CASE WHEN s.equipment  IS NOT NULL AND s.equipment  <> '' THEN 5 ELSE 0 END
      + CASE WHEN s.yearEstablished IS NOT NULL THEN 5 ELSE 0 END
      + CASE WHEN s.data_quality_flag THEN -25 ELSE 0 END
      + CASE WHEN NOT coalesce(s.id_valid, false) THEN -10 ELSE 0 END
    )) AS conf
  FROM src s
  LEFT JOIN spec_agg sa ON s.unique_id = sa.unique_id
),
-- needs (INFERRED AREA-NEED GAPS): high-demand district disciplines (district_demand
-- demand_score >= 70) NOT already in the facility's mapped specialties, top 3 by
-- demand_score DESC. facility_district is post state-case fix so (nfhs_district,
-- nfhs_state) join district_demand (nfhs_district, state) is an EXACT match.
needs_ranked AS (
  SELECT
    fd.unique_id,
    dd.discipline,
    row_number() OVER (
      PARTITION BY fd.unique_id
      ORDER BY dd.demand_score DESC, dd.discipline ASC
    ) AS rn
  FROM workspace.app_state.facility_district fd
  JOIN workspace.app_state.district_demand dd
    ON fd.nfhs_district = dd.nfhs_district
   AND fd.nfhs_state    = dd.state
  LEFT JOIN spec_agg sa ON sa.unique_id = fd.unique_id
  WHERE dd.demand_score >= 70
    AND NOT array_contains(coalesce(sa.specialties, array()), dd.discipline)
),
needs_agg AS (
  -- preserve demand-rank order: sort structs by rn, then strip to the discipline name
  SELECT
    unique_id,
    transform(
      array_sort(collect_list(named_struct('rn', rn, 'd', discipline))),
      x -> x.d
    ) AS needs
  FROM needs_ranked
  WHERE rn <= 3
  GROUP BY unique_id
)
SELECT
  d.unique_id                                                              AS id,
  d.name                                                                   AS name,
  -- type: known-set Title-case label else 'Facility'; Public/Private prefix on hospitals
  CASE
    WHEN d.facilityTypeId = 'hospital' AND d.operatorTypeId IN ('public','government') THEN 'Public Hospital'
    WHEN d.facilityTypeId = 'hospital' AND d.operatorTypeId = 'private' THEN 'Private Hospital'
    WHEN d.facilityTypeId = 'hospital'      THEN 'Hospital'
    WHEN d.facilityTypeId = 'clinic'        THEN 'Clinic'
    WHEN d.facilityTypeId = 'dentist'       THEN 'Dentist'
    WHEN d.facilityTypeId = 'doctor'        THEN 'Doctor'
    WHEN d.facilityTypeId = 'pharmacy'      THEN 'Pharmacy'
    WHEN d.facilityTypeId = 'nursing_home'  THEN 'Nursing home'
    ELSE 'Facility'
  END                                                                      AS type,
  d.address_city                                                           AS city,
  coalesce(
    nullif(initcap(lower(d.state_norm)), ''),
    initcap(d.address_stateOrRegion)
  )                                                                        AS state,
  d.latitude                                                               AS lat,
  d.longitude                                                              AS lng,
  d.specialties_mapped                                                     AS specialties,
  d.specialties_detail                                                     AS specialties_detail,
  cast(coalesce(n.needs, array()) AS array<string>)                        AS needs,
  -- trust tier (never 'verified' here)
  CASE
    WHEN d.data_quality_flag OR d.conf < 40 THEN 'unverified'
    ELSE 'review'
  END                                                                      AS trust,
  CAST(d.conf AS INT)                                                      AS conf,
  try_cast(d.capacity        AS INT)                                       AS beds,
  try_cast(d.yearEstablished AS INT)                                       AS year,
  array_join(coalesce(d.capab_arr, array()), '; ')                        AS capability,
  array_join(coalesce(d.proc_arr,  array()), '; ')                        AS procedure,
  array_join(coalesce(d.equip_arr, array()), '; ')                        AS equipment,
  d.description                                                            AS description,
  d.description                                                            AS evidence,
  -- claims: up to 6 capability items (fallback procedure) -> struct(text,status='review')
  transform(
    slice(
      coalesce(
        CASE WHEN size(coalesce(d.capab_arr, array())) > 0 THEN d.capab_arr ELSE d.proc_arr END,
        array()
      ),
      1, 6
    ),
    x -> named_struct('text', x, 'status', 'review')
  )                                                                        AS claims,
  try_cast(d.address_zipOrPostcode AS BIGINT)                              AS pincode,
  p.district                                                               AS district,
  d.data_quality_flag                                                      AS data_quality_flag,
  d.possible_entity_dup                                                    AS possible_entity_dup,
  d.id_valid                                                               AS id_valid,
  d.coord_source                                                           AS coord_source
FROM derived d
LEFT JOIN pin_district p
  ON try_cast(d.address_zipOrPostcode AS BIGINT) = p.pincode
LEFT JOIN needs_agg n
  ON n.unique_id = d.unique_id;
