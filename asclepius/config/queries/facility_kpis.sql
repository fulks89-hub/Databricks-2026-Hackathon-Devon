-- queryKey: facility_kpis  (single aggregated row; well under the 1MB analytics-event cap)
SELECT
  COUNT(*)                                   AS total_facilities,
  COUNT(DISTINCT state)                      AS states,
  COUNT(DISTINCT district)                   AS districts,
  SUM(CASE WHEN trust = 'review' THEN 1 ELSE 0 END)      AS claimed_facilities,
  SUM(CASE WHEN trust = 'unverified' THEN 1 ELSE 0 END)  AS unverified_facilities
FROM workspace.app_state.facilities;
