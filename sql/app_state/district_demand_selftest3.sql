-- Self-test 3: confirm 706 keys = 698 distinct district NAMES because some names repeat
-- across states (legit), and the 706 grain is on (nfhs_district, state).
SELECT nfhs_district, count(DISTINCT state) AS n_states
FROM workspace.app_state.district_demand
GROUP BY nfhs_district
HAVING count(DISTINCT state) > 1
ORDER BY n_states DESC, nfhs_district
