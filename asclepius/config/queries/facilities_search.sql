-- queryKey: facilities_search  (filtered registry browse; LIMIT 100 keeps result under 1MB cap)
-- @param state STRING
-- @param type STRING
-- @param trust STRING
-- @param q STRING
-- @param limit INT
WITH ranked AS (
  SELECT
    id, name, type, city, state, lat, lng,
    specialties, needs, trust, conf, beds, year,
    pincode, district, data_quality_flag,
    ROW_NUMBER() OVER (ORDER BY conf DESC, name ASC) AS rn
  FROM workspace.app_state.facilities
  WHERE (:state = '' OR state = :state)
    AND (:type = '' OR type = :type)
    AND (:trust = '' OR trust = :trust)
    AND (
      :q = ''
      OR LOWER(name) LIKE CONCAT('%', LOWER(:q), '%')
      OR LOWER(city) LIKE CONCAT('%', LOWER(:q), '%')
    )
)
SELECT
  id, name, type, city, state, lat, lng,
  specialties, needs, trust, conf, beds, year,
  pincode, district, data_quality_flag
FROM ranked
WHERE rn <= LEAST(:limit, 100)
ORDER BY rn
LIMIT 100;
