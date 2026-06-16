-- queryKey: state_coverage_all  (per-state facility coverage; ~36 rows, well under 1MB cap)
SELECT
  state,
  facility_count,
  coverage_index
FROM workspace.app_state.state_coverage
ORDER BY coverage_index DESC, facility_count DESC
LIMIT 50;
