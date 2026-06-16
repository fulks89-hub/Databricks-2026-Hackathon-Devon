-- queryKey: facilities_by_state  (aggregated, LIMITed — safe for the 1MB analytics-event cap)
SELECT state, COUNT(*) AS facility_count
FROM workspace.app_state.facilities
WHERE state IS NOT NULL
GROUP BY state
ORDER BY facility_count DESC
LIMIT 15;
