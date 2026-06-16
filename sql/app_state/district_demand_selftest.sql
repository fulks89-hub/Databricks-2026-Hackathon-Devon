-- Self-test 1: grain, coverage, score-domain, and proxy tagging for district_demand.
SELECT
  count(*)                                                            AS total_rows,           -- expect 6354
  count(DISTINCT discipline)                                         AS n_disciplines,        -- expect 9
  count(DISTINCT nfhs_district)                                      AS n_districts,          -- expect 706
  count(DISTINCT concat(nfhs_district,'||',state))                   AS n_district_state,     -- expect 706
  min(demand_score)                                                  AS min_score,            -- expect 0
  max(demand_score)                                                  AS max_score,            -- expect 100
  sum(CASE WHEN demand_score IS NULL THEN 1 ELSE 0 END)              AS null_scores,          -- expect 0
  sum(CASE WHEN demand_score < 0 OR demand_score > 100 THEN 1 ELSE 0 END) AS out_of_range,    -- expect 0
  sum(CASE WHEN top_driver IS NULL THEN 1 ELSE 0 END)               AS null_top_driver,      -- expect 0
  -- proxy disciplines must ALWAYS carry a (proxy) top_driver
  sum(CASE WHEN discipline IN ('Orthopedics','Ophthalmology','Trauma')
             AND top_driver NOT LIKE '(proxy)%' THEN 1 ELSE 0 END)  AS proxy_untagged,       -- expect 0
  -- grounded disciplines must NEVER carry a (proxy) top_driver
  sum(CASE WHEN discipline NOT IN ('Orthopedics','Ophthalmology','Trauma')
             AND top_driver LIKE '(proxy)%' THEN 1 ELSE 0 END)      AS grounded_mis_tagged   -- expect 0
FROM workspace.app_state.district_demand
