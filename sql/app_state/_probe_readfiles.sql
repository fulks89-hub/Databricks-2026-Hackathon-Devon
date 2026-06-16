-- Probe read_files on the staged TSV: confirm 69 data rows, exact columns,
-- and that pipe-splitting + bridge join will work. EXCLUDE _rescued_data.
SELECT
  COUNT(*)                                              AS n_rows,
  COUNT(DISTINCT indicator_col)                         AS n_distinct_indicators,
  SUM(CASE WHEN specialties = 'NO_SPECIALTY_MATCH'
        OR specialties IS NULL OR specialties = '' THEN 1 ELSE 0 END) AS n_no_specialty
FROM read_files(
  '/Volumes/workspace/app_state/files/nfhs_map.tsv',
  format => 'csv', sep => '\t', header => true,
  multiLine => true, escape => '"'
)
