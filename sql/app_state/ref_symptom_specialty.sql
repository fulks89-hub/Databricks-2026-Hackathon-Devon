-- ref_symptom_specialty: RICHER lay-symptom -> UI-discipline routing index.
-- Replaces the old 26-row seed table. Built from app_state.nfhs_indicator_specialty
-- by exploding symptoms x ui_disciplines (one row per symptom-discipline pair),
-- carrying source_condition (condition_or_topic), source_indicator (indicator_col)
-- and confidence. Symptoms lowercased/trimmed; blank symptoms dropped (care_gap
-- rows often have none). UNION-ADD retained base seeds so ALL 9 UI disciplines are
-- reachable by lay symptoms -- critically Orthopedics & Ophthalmology, for which
-- NFHS-5 (the TSV source) yields nothing, plus reinforcing weak Trauma/Oncology/
-- Nephrology. Seed rows tagged source_condition='base_seed', confidence='med'.
-- Final DEDUPE on (symptom, discipline). Idempotent via CREATE OR REPLACE TABLE.
CREATE OR REPLACE TABLE workspace.app_state.ref_symptom_specialty AS
WITH from_nfhs AS (
  -- explode symptoms x ui_disciplines from the foundation catalog
  SELECT
    lower(trim(sym))            AS symptom,
    disc                        AS discipline,
    n.condition_or_topic        AS source_condition,
    n.indicator_col             AS source_indicator,
    n.confidence                AS confidence
  FROM workspace.app_state.nfhs_indicator_specialty n
  LATERAL VIEW explode(n.symptoms)       s AS sym
  LATERAL VIEW explode(n.ui_disciplines) d AS disc
  WHERE sym IS NOT NULL AND trim(sym) <> ''
    AND disc IS NOT NULL AND trim(disc) <> ''
),
base_seed AS (
  -- retained lay-symptom seeds guaranteeing all-9 coverage
  SELECT explode(map(
    'injury',                'Orthopedics',
    'broken bone',           'Orthopedics',
    'fracture',              'Orthopedics',
    'joint pain',            'Orthopedics',
    'back pain',             'Orthopedics',
    'accident',              'Orthopedics',
    'sprain',                'Orthopedics',
    'swollen joint',         'Orthopedics',
    'blurred vision',        'Ophthalmology',
    'eye pain',              'Ophthalmology',
    'red eye',               'Ophthalmology',
    'vision loss',           'Ophthalmology',
    'cataract',              'Ophthalmology',
    'watery eyes',           'Ophthalmology',
    "can't see clearly",     'Ophthalmology',
    'severe injury',         'Trauma',
    'major bleeding',        'Trauma',
    'head injury',           'Trauma',
    'road accident',         'Trauma',
    'trauma',                'Trauma',
    'lump',                  'Oncology',
    'abnormal bleeding',     'Oncology',
    'swelling',              'Nephrology',
    'reduced urine',         'Nephrology'
  )) AS (symptom, discipline)
),
seed_rows AS (
  -- 'accident' appears in both Orthopedics & Trauma seed sets; explode the
  -- discipline list per seed symptom so both routes survive. Tag as base_seed/med.
  SELECT
    lower(trim(symptom))   AS symptom,
    discipline             AS discipline,
    'base_seed'            AS source_condition,
    CAST(NULL AS STRING)   AS source_indicator,
    'med'                  AS confidence
  FROM base_seed
),
unioned AS (
  SELECT symptom, discipline, source_condition, source_indicator, confidence FROM from_nfhs
  UNION ALL
  SELECT symptom, discipline, source_condition, source_indicator, confidence FROM seed_rows
),
deduped AS (
  -- DEDUPE on (symptom, discipline). Prefer a real NFHS source over base_seed,
  -- and within those prefer high>med>low confidence, for a deterministic winner.
  SELECT symptom, discipline, source_condition, source_indicator, confidence
  FROM (
    SELECT
      symptom, discipline, source_condition, source_indicator, confidence,
      ROW_NUMBER() OVER (
        PARTITION BY symptom, discipline
        ORDER BY
          CASE WHEN source_condition = 'base_seed' THEN 1 ELSE 0 END,
          CASE confidence WHEN 'high' THEN 0 WHEN 'med' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
          source_indicator
      ) AS rn
    FROM unioned
  )
  WHERE rn = 1
)
SELECT symptom, discipline, source_condition, source_indicator, confidence
FROM deduped
