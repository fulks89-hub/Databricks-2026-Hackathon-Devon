# Cleaned Data — Virtue Foundation India Healthcare Dataset

Cleaned exports of the hackathon dataset (catalog `databricks_virtue_foundation_dataset_dais_2026`, schema `virtue_foundation_dataset`). Files are **gzipped CSV** to stay git-friendly.

Read in Python: `pandas.read_csv("data/facilities_clean.csv.gz")` (pandas auto-detects gzip). Or in Spark/DuckDB directly. The original raw tables remain in the Databricks catalog.

| File | Rows | Cols | Notes |
|---|---|---|---|
| `facilities_clean.csv.gz` | 10,077 | 53 | The official challenge dataset (healthcare facilities), cleaned — incl. `custom_logo_presence` + `id_valid`; 11 exact duplicate rows removed |
| `pincode_clean.csv.gz` | 165,627 | 11 | India Post PIN-code directory (geo bridge) |
| `nfhs5_district_health_clean.csv.gz` | 706 | 109 | NFHS-5 district health indicators (enrichment) |

> ⚠️ **Treat the free-text "claim" fields (capability, procedure, equipment, description) as claims to verify, not ground truth** — per the hackathon brief.

## Cleaning applied

### facilities_clean
- **Sentinels → NULL:** every string column trimmed; the set `'' / 'null' / 'NA' / 'N/A' / '*' / '[]'` converted to real NULL (the literal text `"null"` was the dominant sentinel — e.g. 6,342/10,088 `numberDoctors` values).
- **Numeric casts (safe `try_cast`):** `numberDoctors`, `capacity`, `yearEstablished`, `post_metrics_post_count`, `distinct_social_media_presence_count`, `number_of_facts_about_the_organization` → INT; `engagement_metrics_n_followers/likes/engagements` → BIGINT. Non-numeric → NULL.
- **specialties:** parsed JSON array, **de-duplicated** (`array_distinct`), re-serialized clean. Added `specialties_count` (NULL when unparseable).
- **Coordinates repaired:** kept original lat/long when within India bounds (lat 6.0–37.5, lon 68.0–97.5); otherwise **backfilled from the pincode directory** via cleaned postcode; else NULL. New `coord_source` column = `original` (9,964) / `pincode_backfill` (35) / `none` (89).
- **`farmacy` → `pharmacy`** in `facilityTypeId` (10 rows).
- **`data_quality_flag`** (BOOLEAN) added — flags the ~145 column-shift-corrupted rows (e.g. JSON/coords landed in the wrong column) instead of dropping them.
- **`unique_id` audit + dedupe:** `unique_id` was not unique — removed **11 byte-identical duplicate rows** (→ 10,077; IDs now distinct) and added **`id_valid`** (false for the 88 corrupted, non-UUID IDs). See `CLEANING_REPORT.md`.
- Dropped redundant `coordinates` (GeoJSON string; lat/long retained) and `countries` (~0.3% populated, duplicates `address_country`). Added: `specialties_count`, `coord_source`, `data_quality_flag`.

### pincode_clean
- Trimmed all string columns; collapsed internal multiple spaces in `district` and `statename`.
- `latitude`/`longitude`: `'NA'`/`''` → NULL, cast STRING → DOUBLE. `pincode` kept as bigint. All 11 columns preserved.

### nfhs5_district_health_clean
- `district_name`, `state_ut`: trimmed + internal spaces collapsed.
- All 107 indicator columns: `try_cast` to DOUBLE with `'NA'`/`'*'`/`''` → NULL (51 were string-typed only due to suppressed values; now numeric).

## Provenance & method
Cleaning SQL was authored and adversarially reviewed by an agent fleet (facilities + pincode), with the NFHS-5 numeric casting generated programmatically for completeness, then executed on a Databricks SQL warehouse and exported via the Statement Execution API.
