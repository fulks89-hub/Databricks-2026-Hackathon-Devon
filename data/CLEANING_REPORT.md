# Data Cleaning Report

**Scope:** cleaning of the Virtue Foundation India healthcare dataset (3 tables) exported to `data/*.csv.gz`.
**Method:** cleaning SQL authored + adversarially reviewed by an agent fleet (facilities, pincode), NFHS-5 numeric casting generated programmatically; executed on a Databricks SQL warehouse.

## Overall confidence: **90 / 100 (High)**

The large majority of changes are **deterministic and lossless-by-design** (sentinel→NULL, safe `try_cast`, trim, set-dedupe) and carry very high confidence. The score is held below ~95 by two judgment-based steps: **coordinate repair** (approximate for 35 rows) and the **corruption heuristic flag**. **Row counts were fully preserved** — nothing was deleted:

| Table | Rows in | Rows out | Match |
|---|---|---|---|
| facilities | 10,088 | 10,088 | ✅ |
| pincode | 165,627 | 165,627 | ✅ |
| nfhs5_district_health | 706 | 706 | ✅ |

## What was cleaned — by operation

| Operation | Table | Rows affected | Confidence | Why |
|---|---|---|---|---|
| Sentinels (`'' / null / NA / N/A / * / []`) → real NULL | all | pervasive | **99% — Very High** | Deterministic; the literal text `"null"` was the dominant placeholder (e.g. 6,342/10,088 `numberDoctors`) |
| Trim whitespace; collapse internal spaces (district/state) | all | pervasive | **99% — Very High** | Deterministic |
| Numeric casts via `try_cast` (numberDoctors, capacity, NFHS indicators, pincode lat/long, engagement/post metrics) | all | many | **97% — Very High** | Safe cast; non-numeric → NULL, no errors, no imputation |
| `specialties` de-duplicated + re-serialized; `specialties_count` added | facilities | ~all w/ specialties | **95% — High** | `array_distinct` preserves the set; assumes dup entries are extraction noise |
| `farmacy` → `pharmacy` | facilities | 10 | **99% — Very High** | Unambiguous typo |
| Coordinate repair (validate India bbox; backfill from pincode; else NULL) + `coord_source` | facilities | 9,964 kept · **35 backfilled** · 89 nulled | **75% — Medium** | Backfill gives an *approximate* (pincode-area) location; bbox could clip a rare valid edge point |
| `data_quality_flag` for likely column-shift-corrupted rows | facilities | 145 flagged | **70% — Medium** | Heuristic (type/country/typeId checks); flags, never drops — may have false +/− |
| Dropped redundant `coordinates` (GeoJSON) and `countries` (0.3% filled) | facilities | — | **90% — High** | Redundant with lat/long and address_country |

## Assumptions made
1. The sentinel set `'' / null / NA / N/A / * / []` always means *missing/placeholder*, never real data.
2. Fields cast to numbers were intended numeric; non-numeric content was junk → NULL. **No imputation** was performed (sparse fields like `numberDoctors` 36% and `capacity` 25% stay NULL, not guessed).
3. Duplicate entries inside `specialties` are extraction artifacts and order is irrelevant.
4. Valid Indian coordinates fall within **lat 6.0–37.5, lon 68.0–97.5** (covers mainland + Andaman/Nicobar + Lakshadweep); anything outside is erroneous.
5. When a facility's coordinates are invalid/missing, its **postcode's pincode-area average** is an acceptable *approximate* stand-in (35 rows; marked `coord_source='pincode_backfill'`).
6. `'farmacy'` is a misspelling of `'pharmacy'`.
7. Rows failing `organization_type='facility'` / India / known `facilityTypeId` are *likely* column-shift corrupted — **flagged, not dropped** (preserves data for review).
8. `coordinates` and `countries` are redundant and safe to drop.
9. NFHS-5 `'NA'` / `'*'` are standard suppression markers → NULL.

## Out of scope (intentionally NOT changed)
- **District-name normalization to NFHS-5** (alias mapping for the supply↔need join) — a join-time concern, not done here.
- **Corrupted rows were flagged, not repaired** — shifted values can't be reliably reconstructed.
- **`acceptsVolunteers`** left as-is (~99% null + corrupted) — unrecoverable.
- **No row de-duplication** — entity resolution was already done upstream by the FDR pipeline.
- **No imputation** of missing numerics.

## Known limitations
- ✅ **`custom_logo_presence` is retained** (cleaned like other text fields). Only `coordinates` (redundant with lat/long) and `countries` (~0.3% filled) were intentionally dropped — so `facilities_clean` has 52 columns (49 original + specialties_count, coord_source, data_quality_flag).
- Coordinate backfill for the 35 repaired rows is **area-level, not exact** — fine for mapping/aggregation, not for precise routing. Always check `coord_source`.
- The `data_quality_flag` is a **screening signal**, not a verified label.
