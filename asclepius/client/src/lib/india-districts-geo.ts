// India district-level GeoJSON + an SVG projection helper for the Atlas
// drill-down choropleth.
//
// The raw FeatureCollection (736 district polygons, RFC7946, 2011-census
// vintage; props `dt_name`, `st_nm`, `nfhs_district`, `nfhs_state`) is brought
// into the client as a typed JSON module so the Atlas screen can render a
// per-state district choropleth with no network fetch (0.56 MB, under the cap).
//
// The state layer (./india-geo.ts) keys its projected paths by `st_nm`; here we
// want the NFHS join keys, so this module reuses the SAME web-Mercator math as
// `projectGeo()` but returns district paths carrying `nfhs_district`,
// `nfhs_state`, `dt_name`, `st_nm`, plus the FULL list of constituent NFHS
// district keys to aggregate (the metro one-to-many rule — see DISTRICT_MULTI).

import rawDistrictGeo from './india-districts-geo.json';

// ---- GeoJSON shapes (only the bits we consume) ---------------------------

export interface DistrictProps {
  /** District display name, Title-Cased. */
  dt_name: string;
  /** State/UT display spelling (matches the State layer's st_nm). */
  st_nm: string;
  /** NFHS-5 district join key (NFHS naming), or null if no NFHS counterpart. */
  nfhs_district: string | null;
  /** NFHS-5 state join key (NFHS naming), or null. */
  nfhs_state: string | null;
}

export interface DistrictFeature {
  type: 'Feature';
  properties: DistrictProps;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    // Polygon: number[][][]; MultiPolygon: number[][][][]. Walked generically.
    coordinates: unknown;
  } | null;
}

export interface IndiaDistrictsGeo {
  type: 'FeatureCollection';
  features: DistrictFeature[];
}

// The JSON module's inferred type (literal `type: string`, concrete nested
// coordinate arrays) is structurally incompatible with the hand-written
// interface, so we widen through a typed `unknown` intermediate (a single
// assertion via the variable below) rather than a forbidden double assertion.
const rawDistrictsUnknown: unknown = rawDistrictGeo;
export const INDIA_DISTRICTS_GEO = rawDistrictsUnknown as IndiaDistrictsGeo;

// ---- Metro one-to-many crosswalk (derived from geojson_district_crosswalk.csv)
//
// A few 2011-vintage metro polygons are ONE shape for MANY NFHS-5 districts, so
// a feature's single baked `nfhs_district` prop cannot carry them all. These are
// the only two such polygons in the layer (every other polygon's baked prop is
// the correct, sole join key). The Atlas AGGREGATES (mean) the constituent
// districts' values when shading these. Keyed by `${st_nm}||${dt_name}`.
//   Delhi  = 1 polygon ↔ 11 NFHS districts
//   Mumbai = 1 polygon ↔ 2  NFHS districts (Mumbai + Mumbai Suburban)
export const DISTRICT_MULTI: Record<string, string[]> = {
  'Maharashtra||Mumbai': ['Mumbai', 'Mumbai Suburban'],
  'Delhi||Delhi': [
    'Central',
    'East',
    'New Delhi',
    'North',
    'North East',
    'North West',
    'Shahdara',
    'South',
    'South East',
    'South West',
    'West',
  ],
};

/** Stable polygon key for the multi-district lookup. */
function polyKey(st_nm: string, dt_name: string): string {
  return `${st_nm}||${dt_name}`;
}

/**
 * The list of NFHS-5 `nfhs_district` keys whose health/desert values should be
 * aggregated to shade this polygon. For the two metro polygons that returns the
 * full constituent set (DISTRICT_MULTI); for every other polygon it is the lone
 * baked `nfhs_district` (or `[]` when the polygon has no NFHS-5 record — a
 * post-2011 split or PoK area → render neutral).
 */
export function nfhsKeysForFeature(props: DistrictProps): string[] {
  const multi = DISTRICT_MULTI[polyKey(props.st_nm, props.dt_name)];
  if (multi) return multi;
  return props.nfhs_district ? [props.nfhs_district] : [];
}

// ---- Projection ----------------------------------------------------------

/** One district polygon, ready to drop into <path d=…/>, plus join keys. */
export interface ProjectedDistrict {
  /** District display name. */
  name: string;
  /** State/UT display spelling. */
  state: string;
  /** Representative NFHS district join key (null when no NFHS record). */
  nfhsDistrict: string | null;
  /** NFHS state join key (NFHS naming; null when no NFHS record). */
  nfhsState: string | null;
  /** All constituent NFHS district keys to aggregate (metro one-to-many). */
  nfhsKeys: string[];
  /** SVG path `d` string. */
  d: string;
}

export interface ProjectedDistrictGeo {
  paths: ProjectedDistrict[];
  /** lng/lat → [x, y] in the same viewBox (for facility markers). */
  project: (lng: number, lat: number) => [number, number];
  W: number;
  H: number;
}

// Web-Mercator (radians on x, log-tangent on y) — identical to india-geo.ts.
function merc(lng: number, lat: number): [number, number] {
  return [
    (lng * Math.PI) / 180,
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2)),
  ];
}

// Walk an arbitrarily-nested GeoJSON coordinate array down to [lng,lat] pairs.
function eachCoord(c: unknown, fn: (pt: [number, number]) => void): void {
  if (Array.isArray(c)) {
    if (typeof c[0] === 'number') {
      fn([c[0], c[1] as number]);
    } else {
      for (const x of c) eachCoord(x, fn);
    }
  }
}

/**
 * Project a set of district features into a fixed `W×H` viewBox, fitting the
 * given features' own bounds (so a single state's districts fill the frame on
 * drill-down). Same Mercator math as the State layer's `projectGeo()`.
 *
 * Pass `features` already filtered to one state to zoom into that state; pass
 * the whole `INDIA_DISTRICTS_GEO.features` for an all-India district view.
 */
export function projectDistricts(
  features: DistrictFeature[],
  opts?: { W?: number; H?: number; pad?: number },
): ProjectedDistrictGeo {
  const W = opts?.W ?? 600;
  const H = opts?.H ?? 660;
  const pad = opts?.pad ?? 16;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const f of features) {
    if (!f.geometry) continue;
    eachCoord(f.geometry.coordinates, ([lng, lat]) => {
      const p = merc(lng, lat);
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    });
  }

  // Degenerate bounds (no/one feature) — avoid divide-by-zero.
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const s = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
  const offX = pad + (W - 2 * pad - s * spanX) / 2;
  const offY = pad + (H - 2 * pad - s * spanY) / 2;

  const project = (lng: number, lat: number): [number, number] => {
    const p = merc(lng, lat);
    return [offX + (p[0] - minX) * s, offY + (maxY - p[1]) * s];
  };

  const paths: ProjectedDistrict[] = features.map((f) => {
    const props = f.properties;
    let d = '';
    if (f.geometry) {
      const polys =
        f.geometry.type === 'Polygon'
          ? [f.geometry.coordinates as number[][][]]
          : (f.geometry.coordinates as number[][][][]);
      for (const poly of polys) {
        for (const ring of poly) {
          ring.forEach((pt, i) => {
            const xy = project(pt[0], pt[1]);
            d += (i === 0 ? 'M' : 'L') + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1);
          });
          d += 'Z';
        }
      }
    }
    return {
      name: props.dt_name,
      state: props.st_nm,
      nfhsDistrict: props.nfhs_district,
      nfhsState: props.nfhs_state,
      nfhsKeys: nfhsKeysForFeature(props),
      d,
    };
  });

  return { paths, project, W, H };
}

/** All district features whose display state (`st_nm`) matches `st_nm`. */
export function districtsForState(st_nm: string): DistrictFeature[] {
  return INDIA_DISTRICTS_GEO.features.filter((f) => f.properties.st_nm === st_nm);
}
