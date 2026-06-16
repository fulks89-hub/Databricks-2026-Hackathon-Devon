-- queryKey: registry_field_coverage  (per-field non-null coverage % over facilities; single-row result)
SELECT
  COUNT(*) AS total_facilities,
  ROUND(100.0 * COUNT(CASE WHEN description IS NOT NULL AND TRIM(description) <> '' THEN 1 END) / COUNT(*), 1) AS description_pct,
  ROUND(100.0 * COUNT(CASE WHEN capability  IS NOT NULL AND TRIM(capability)  <> '' THEN 1 END) / COUNT(*), 1) AS capability_pct,
  ROUND(100.0 * COUNT(CASE WHEN procedure   IS NOT NULL AND TRIM(procedure)   <> '' THEN 1 END) / COUNT(*), 1) AS procedure_pct,
  ROUND(100.0 * COUNT(CASE WHEN equipment   IS NOT NULL AND TRIM(equipment)   <> '' THEN 1 END) / COUNT(*), 1) AS equipment_pct,
  ROUND(100.0 * COUNT(CASE WHEN beds IS NOT NULL AND beds > 0 THEN 1 END) / COUNT(*), 1) AS beds_pct,
  ROUND(100.0 * COUNT(CASE WHEN year IS NOT NULL AND year > 0 THEN 1 END) / COUNT(*), 1) AS year_pct
FROM workspace.app_state.facilities;
