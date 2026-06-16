// India state-level GeoJSON + an SVG projection helper for the Atlas choropleth.
//
// The raw FeatureCollection (37 state/UT polygons, `properties.st_nm`) is the
// same data the design prototype loaded as `window.INDIA_GEO` from
// design-import/india-geo.js — extracted here into a typed JSON module so the
// Atlas screen can render an inline SVG choropleth with no network fetch.
//
// `projectGeo()` reproduces the prototype's buildGeo(): a web-Mercator
// projection fit to a fixed viewBox, returning per-state SVG path `d` strings
// plus a lng/lat → [x,y] projector for plotting facility markers. Structured so
// a district-level GeoJSON can drop into the same projector unchanged.

import rawGeo from './india-geo.json';

// ---- GeoJSON shapes (only the bits we consume) ---------------------------

export interface GeoFeature {
  type: 'Feature';
  properties: { st_nm: string; [k: string]: unknown };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    // Polygon: number[][][]; MultiPolygon: number[][][][]. We walk it generically.
    coordinates: unknown;
  } | null;
}

export interface IndiaGeo {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

// The JSON module's inferred type (literal `type: string`, concrete nested
// coordinate arrays) is structurally incompatible with the hand-written
// IndiaGeo interface, so we widen through a typed `unknown` intermediate
// rather than a forbidden `as unknown as` double assertion.
const rawGeoUnknown: unknown = rawGeo;
export const INDIA_GEO = rawGeoUnknown as IndiaGeo;

// ---- Projection ----------------------------------------------------------

/** One state polygon, ready to drop into <path d=…/>, keyed by its st_nm. */
export interface ProjectedState {
  name: string;
  d: string;
}

/** Result of projecting the whole FeatureCollection to a fixed viewBox. */
export interface ProjectedGeo {
  paths: ProjectedState[];
  /** lng/lat → [x, y] in the same viewBox (for facility markers). */
  project: (lng: number, lat: number) => [number, number];
  /** SVG viewBox width / height. */
  W: number;
  H: number;
}

// Web-Mercator (radians on x, log-tangent on y), matching the prototype.
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
 * Project `geo` into a fixed `W×H` viewBox (default 600×660, pad 16) using a
 * bounds-fit web-Mercator. Identical math to the prototype's buildGeo so the
 * choropleth renders the same shape. Pass a district GeoJSON to reuse as-is.
 */
export function projectGeo(
  geo: IndiaGeo = INDIA_GEO,
  opts?: { W?: number; H?: number; pad?: number },
): ProjectedGeo {
  const W = opts?.W ?? 600;
  const H = opts?.H ?? 660;
  const pad = opts?.pad ?? 16;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const f of geo.features) {
    if (!f.geometry) continue;
    eachCoord(f.geometry.coordinates, ([lng, lat]) => {
      const p = merc(lng, lat);
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    });
  }

  const s = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxY - minY));
  const offX = pad + ((W - 2 * pad) - s * (maxX - minX)) / 2;
  const offY = pad + ((H - 2 * pad) - s * (maxY - minY)) / 2;

  const project = (lng: number, lat: number): [number, number] => {
    const p = merc(lng, lat);
    return [offX + (p[0] - minX) * s, offY + (maxY - p[1]) * s];
  };

  const paths: ProjectedState[] = geo.features.map((f) => {
    const name = f.properties.st_nm;
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
    return { name, d };
  });

  return { paths, project, W, H };
}
