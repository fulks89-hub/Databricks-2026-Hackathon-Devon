-- app_state.state_health
-- State-level rollup (AVG of district values per state_ut) of the same 7 REAL NFHS-5 layers.
-- Powers the atlas STATE choropleth default. Each layer is the simple mean of the
-- per-district layer values (from app_state.district_health), ignoring NULL districts.
CREATE OR REPLACE VIEW workspace.app_state.state_health AS
SELECT
  state_ut AS state,
  round(avg(ncd), 1)          AS ncd,
  round(avg(anaemia), 1)      AS anaemia,
  round(avg(malnutrition), 1) AS malnutrition,
  round(avg(womensnut), 1)    AS womensnut,
  round(avg(acutechild), 1)   AS acutechild,
  round(avg(cancerscreen), 1) AS cancerscreen,
  round(avg(riskfactors), 1)  AS riskfactors,
  count(*) AS district_count
FROM workspace.app_state.district_health
GROUP BY state_ut;
