-- nfhs_indicator_specialty: 69-row catalog of NFHS-5 indicators with their
-- plain label, category, condition/topic, symptom array, granular specialty
-- array, bridged UI-discipline array, direction, confidence, and edge_basis.
-- Source: staged TSV in the UC Volume. ui_disciplines is the DISTINCT set of
-- non-null UI disciplines obtained by exploding specialties_granular and joining
-- ref_specialty_bridge. EXCLUDE _rescued_data. Idempotent via CREATE OR REPLACE.
CREATE OR REPLACE TABLE workspace.app_state.nfhs_indicator_specialty AS
WITH raw AS (
  SELECT
    indicator_col,
    nfhs_plain_label,
    category,
    condition_or_topic,
    -- symptoms: pipe-split, trimmed; empty/null -> empty array
    CASE
      WHEN symptoms IS NULL OR trim(symptoms) = '' THEN array()
      ELSE transform(split(symptoms, '\\|'), x -> trim(x))
    END AS symptoms,
    -- specialties_granular: pipe-split, trimmed; NO_SPECIALTY_MATCH/empty -> empty array
    CASE
      WHEN specialties IS NULL OR trim(specialties) = ''
        OR trim(specialties) = 'NO_SPECIALTY_MATCH' THEN array()
      ELSE transform(split(specialties, '\\|'), x -> trim(x))
    END AS specialties_granular,
    direction,
    confidence,
    edge_basis
  FROM read_files(
    '/Volumes/workspace/app_state/files/nfhs_map.tsv',
    format => 'csv', sep => '\t', header => true,
    multiLine => true, escape => '"'
  )
),
-- explode granular tokens to one row per (indicator, token)
exploded AS (
  SELECT r.indicator_col, e.tok
  FROM raw r
  LATERAL VIEW OUTER explode(r.specialties_granular) e AS tok
),
-- bridge each token to its UI discipline, collect distinct non-null per indicator
bridged AS (
  SELECT
    x.indicator_col,
    collect_set(b.ui_discipline) AS ui_disciplines
  FROM exploded x
  LEFT JOIN workspace.app_state.ref_specialty_bridge b
    ON x.tok = b.granular_specialty
  GROUP BY x.indicator_col
)
SELECT
  r.indicator_col,
  r.nfhs_plain_label,
  r.category,
  r.condition_or_topic,
  r.symptoms,
  r.specialties_granular,
  -- collect_set drops NULLs already; coalesce guards the no-token case -> empty array
  coalesce(b.ui_disciplines, array()) AS ui_disciplines,
  r.direction,
  r.confidence,
  r.edge_basis
FROM raw r
LEFT JOIN bridged b ON r.indicator_col = b.indicator_col
