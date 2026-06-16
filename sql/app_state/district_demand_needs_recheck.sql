-- Re-check the LIVE consumer app_state.facilities.needs after the rebuild:
-- what fraction of facilities receive >=1 inferred need, and avg needs size.
SELECT
  count(*)                                                          AS total_facilities,
  sum(CASE WHEN size(needs) > 0 THEN 1 ELSE 0 END)                 AS facilities_with_needs,
  round(100.0 * sum(CASE WHEN size(needs) > 0 THEN 1 ELSE 0 END) / count(*), 1) AS pct_with_needs,
  round(avg(size(needs)), 2)                                       AS avg_needs_size,
  max(size(needs))                                                 AS max_needs_size
FROM workspace.app_state.facilities
