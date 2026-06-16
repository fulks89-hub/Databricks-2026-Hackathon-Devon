-- Self-test 2: per-discipline row count must be exactly 706 for all 9.
SELECT discipline, count(*) AS n_rows,
       round(min(demand_score),1) AS mn, round(max(demand_score),1) AS mx
FROM workspace.app_state.district_demand
GROUP BY discipline
ORDER BY discipline
