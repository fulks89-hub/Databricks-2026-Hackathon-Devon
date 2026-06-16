-- queryKey: facilities_in_radius  (haversine radius search; LIMIT 50 keeps result under 1MB cap)
-- @param lat DOUBLE
-- @param lng DOUBLE
-- @param radius_km DOUBLE
WITH d AS (
  SELECT
    id, name, type, city, state, lat, lng,
    specialties, needs, trust, conf, beds,
    pincode, district,
    2 * 6371 * ASIN(SQRT(
      POWER(SIN(RADIANS(lat - :lat) / 2), 2) +
      COS(RADIANS(:lat)) * COS(RADIANS(lat)) *
      POWER(SIN(RADIANS(lng - :lng) / 2), 2)
    )) AS distance_km
  FROM workspace.app_state.facilities
  WHERE lat IS NOT NULL AND lng IS NOT NULL
)
SELECT
  id, name, type, city, state, lat, lng,
  specialties, needs, trust, conf, beds,
  pincode, district,
  ROUND(distance_km, 2) AS distance_km
FROM d
WHERE distance_km <= :radius_km
ORDER BY distance_km ASC
LIMIT 50;
