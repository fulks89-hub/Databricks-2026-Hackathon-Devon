# India District GeoJSON — Asclepius map layer

District-level polygon layer for the Asclepius hackathon app, plus the crosswalk
that joins each polygon to the NFHS-5 district-health gold table. This is the **drill-down**
layer; the zoomed-out default stays the state-level `design-import/india-geo.js`.

## Files

| File | Size | Purpose |
|------|------|---------|
| `india_districts.geojson` | 0.56 MB | All-India district polygons (RFC7946 FeatureCollection, 736 features) |
| `india-districts-geo.js` | 0.56 MB | Same FeatureCollection wrapped as `window.INDIA_DISTRICTS_GEO = {...};` for direct `<script>` include |
| `geojson_district_crosswalk.csv` | ~0.05 MB | Polygon district/state ↔ NFHS district/state, with match status/confidence/method (747 rows) |

## Source

Merged all 36 per-state district GeoJSON files from
[`udit-001/india-maps-data`](https://github.com/udit-001/india-maps-data)
(`raw.githubusercontent.com/udit-001/india-maps-data/main/geojson/states/*.geojson`),
a well-maintained DataMeet/OSM-derived **2011-census-vintage** collection, into a single
all-India FeatureCollection. Source props were `district + st_nm + dt_code + st_code`
(`year = "2011_c"`); on merge, `st_nm` was mapped to the 37 display spellings used by the
State layer.

### Why this source

Chosen over all known and newly-evaluated candidates (datta07 `INDIA_DISTRICTS`, geoBoundaries
ADM2, GADM L2, etc.) because it **uniquely matches both**:

1. **The app's schema** — district + display state name (`st_nm`) per feature, and
2. **The NFHS administrative partition** — Dadra & Nagar Haveli + Daman & Diu merged into one
   unit, Ladakh separate from Jammu & Kashmir, Telangana separate from Andhra Pradesh, and the
   Andaman & Nicobar / J&K spellings the NFHS keys expect,

…at the correct **2011-census NFHS-5 vintage**, in a compact ~5.7 MB pre-simplification
footprint. Other candidates failed on at least one of: no state field (geoBoundaries),
wrong/newer administrative vintage, or ALLCAPS-only naming requiring lossy re-casing.

## Simplification

Simplified with **mapshaper** (`-simplify dp 3% keep-shapes`, Douglas–Peucker). `keep-shapes`
prevents small districts/islands (e.g. Lakshadweep) from collapsing — all **736** features are
preserved. The `-clean` sliver pass was deliberately **skipped** because it dropped one district.
Coordinates are rounded to **4 decimal places** (WGS84 `[lng, lat]`). Final size **0.56 MB**
(587,255 bytes), down from ~5.7 MB raw — comfortably under the Free-Edition 10 MB cap and good for
web performance.

- Geometry: `Polygon`/`MultiPolygon`, 736 features, 36 states/UTs.
- bbox: lng `[68.10, 97.40]`, lat `[6.75, 37.08]` (within the India envelope).
- ~5,279 minor **self-intersections** are inherited from the pre-simplified upstream source. They
  are cosmetically irrelevant for choropleth **fills** (the use case here). A lighter
  0.70 MB / 8 %-simplified variant with crisper borders was also produced if ever needed.

## Properties (4 per feature)

| Property | Meaning |
|----------|---------|
| `dt_name` | District display name, Title-Cased (acronyms like `YSR`, `NTR` preserved; connector words lowercased) |
| `st_nm` | State/UT display name — one of the 37 companion-file spellings, matching the State layer's `st_nm` |
| `nfhs_district` | NFHS-5 district join key (NFHS naming), or `null` if the polygon has no NFHS counterpart |
| `nfhs_state` | NFHS-5 state join key (NFHS naming), or `null` |

> Raw source codes (`dt_code`, `st_code`, `st_nm_raw`, `year`) are dropped from the final layer to
> keep it small; they remain in the intermediate build artifacts if needed.

## Join key

To enrich a polygon with health metrics, join `(nfhs_district, nfhs_state)` →
`gold_district_supply_need`.

**Use `geojson_district_crosswalk.csv` as the authoritative mapping**, not the baked-in feature
keys — it carries the full many-to-one relationships (see the metro rule below). Columns:
`geojson_district, geojson_state, nfhs_district, nfhs_state, match_status, confidence, method`.
Join the gold table on `(nfhs_district, nfhs_state)` and the geometry on
`(geojson_district / dt_name, geojson_state / st_nm)`.

## NFHS join coverage

**99.86 % — 705 / 706** NFHS-5 district keys resolve to a polygon via the crosswalk.

Only **1** NFHS key is uncovered, and it is a pre-existing data-quality issue, not a geometry gap:

- `Chandel / Mizoram` — a **known bad row** in the NFHS key file (Chandel district is in Manipur,
  not Mizoram; no Mizoram polygon can or should match it). Leave it unshaded.

## Honest caveats

- **Metro one-to-many (the key render rule).** A few 2011-vintage metro polygons are *one shape
  for many NFHS-5 districts*: **Delhi** = 1 polygon ↔ **11** NFHS districts; **Mumbai** = 1
  polygon ↔ **2** NFHS districts (Mumbai + Mumbai Suburban). The crosswalk maps every constituent
  NFHS key to the shared polygon, but a feature's baked `nfhs_*` props can only carry **one** pair
  (a representative key). **Render rule:** to shade these polygons correctly, **aggregate** the
  constituent NFHS districts' values (e.g. mean or population-weighted `desert_score`) via
  `geojson_district_crosswalk.csv` — do **not** rely on the single baked key. This is why crosswalk
  coverage (99.86 %, 705/706) is the authoritative figure while the baked-in-feature keys cover
  fewer rows (694/736 features carry a key ≈ 98.3 % of NFHS districts).
- **Post-vintage splits render uncolored.** 42 polygons are post-2011 new districts (e.g. AP's
  Tirupati, Annamayya, NTR, Bapatla; Arunachal's Kamle, Shi Yomi) or PoK areas (Muzaffarabad,
  Mirpur) with no NFHS-5 record. They draw on the map but have no data to shade — correct and
  honest, not a bug.
- **Display `st_nm` vs. join `nfhs_state` differ by spelling convention.** `st_nm` uses the app's
  37 display spellings (`Jammu and Kashmir`, `Andaman and Nicobar Islands`, `Delhi`); `nfhs_state`
  uses the NFHS convention (`Jammu & Kashmir`, `Andaman & Nicobar Islands`, `NCT of Delhi`). They
  are intentionally different fields — do not assume equality.
- **`Maharastra` (sic).** The NFHS key file misspells Maharashtra as `Maharastra`. The crosswalk and
  `nfhs_state` preserve that exact (mis)spelling so the join to the gold table works; `st_nm` shows
  the correct `Maharashtra`.
- **Daman & Diu** has no separate polygon (Dadra & Nagar Haveli does); since NFHS merges DNH&DD, the
  merged key joins to the DNH polygon. 36 of 37 display states are present.

## Provenance

- Upstream: `udit-001/india-maps-data` (DataMeet/OSM-derived, 2011 census vintage).
- Build: 36 state files merged → state names mapped to display spellings → simplified with mapshaper
  (`dp 3% keep-shapes`) → coords rounded to 4 dp → NFHS join keys injected per feature from the
  crosswalk → `Mumbai Suburban` added as a metro one-to-many row (crosswalk 99.86 %).
- Produced by an automated multi-agent workflow (source → simplify → reconcile → assemble →
  adversarial verify → persist), all 3 verify lenses passed.
