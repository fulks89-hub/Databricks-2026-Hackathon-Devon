/**
 * Asclepius — Track 4 "Data Readiness Desk" routes.
 *
 * READS  (GET /api/data/readiness/*) over the Lakebase Postgres schema `readiness.*`:
 *   readiness.data_readiness        — per-facility readiness (PK unique_id)
 *   readiness.readiness_gap_items   — one row per facility x firing gap (the reviewer queue)
 *   readiness.gold_district_supply_need — Peter-corrected desert scoring (data-poor vs real-gap)
 * plus trust.facility_trust_card (cite the underlying claim text) and app_read.facility_district
 * (NFHS district crosswalk for the district roll-up).
 *
 * WRITES (POST/GET /api/readiness/action[s]) persist the human-in-the-loop remediation loop:
 *   every action  -> app.user_review_actions (audit log + flag queue)
 *   action=patch  -> also app.overrides (the field patch the rest of the app reads)
 *   action=note   -> also app.notes
 *   action=dedupe -> also app.dup_decisions
 * Identity from X-Forwarded-Email (callerEmail). No assertions: the UI shows flags +
 * data_confidence and cites the field/text being changed; it never claims a facility "can't".
 */
import type express from 'express';
import { callerEmail } from './persistence-routes.js';
import type { AppkitLike, LakebaseClient } from './persistence-routes.js';

// --- small local helpers (mirrors read-routes.ts) --------------------------
function ok(res: express.Response, body: unknown, status = 200): void {
  res.status(status).json(body);
}
function fail(res: express.Response, code: string, message: string, status = 400): void {
  res.status(status).json({ error: { code, message } });
}
function h(
  fn: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res) => {
    fn(req, res).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[asclepius:readiness] route error:', message);
      if (!res.headersSent) fail(res, 'INTERNAL', message, 500);
    });
  };
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
function limitParam(raw: unknown, def = 60, max = 1000): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

const GAP_TYPES = [
  'flagged_quality',
  'possible_duplicate',
  'unverified_claims',
  'missing_coords',
  'missing_contact',
  'sparse_fields',
] as const;

// ---------------------------------------------------------------------------
// Read routes
// ---------------------------------------------------------------------------
function registerReadinessReadRoutes(app: express.Application, db: LakebaseClient): void {
  // GET /api/data/readiness/summary — overall + per-section counts (the KPIs).
  app.get(
    '/api/data/readiness/summary',
    h(async (_req, res) => {
      const overall = await db.query<{
        total_facilities: number;
        high_leverage: number;
        clean_facilities: number;
        total_gaps: number;
        avg_confidence: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM readiness.data_readiness)                              AS total_facilities,
           (SELECT COUNT(*)::int FROM readiness.data_readiness WHERE high_leverage)          AS high_leverage,
           (SELECT COUNT(*)::int FROM readiness.data_readiness WHERE primary_gap_type='none') AS clean_facilities,
           (SELECT COUNT(*)::int FROM readiness.readiness_gap_items)                         AS total_gaps,
           (SELECT ROUND(AVG(data_confidence)::numeric,3)::float8 FROM readiness.data_readiness) AS avg_confidence`,
      );
      const byGap = await db.query<{
        gap_type: string;
        n: number;
        high_leverage: number;
        avg_confidence: number;
      }>(
        `SELECT gap_type,
                COUNT(*)::int                              AS n,
                SUM(high_leverage::int)::int               AS high_leverage,
                ROUND(AVG(data_confidence)::numeric,2)::float8 AS avg_confidence
         FROM readiness.readiness_gap_items
         GROUP BY gap_type
         ORDER BY n DESC`,
      );
      ok(res, { summary: overall.rows[0] ?? null, by_gap: byGap.rows });
    }),
  );

  // GET /api/data/readiness/gaps?gap_type=&state=&high_leverage=&q=&fields=&limit=&offset=
  // The reviewer work-queue. Overlays this caller's latest action so a patched/
  // flagged/dismissed item reflects their progress (COALESCE over user_review_actions).
  app.get(
    '/api/data/readiness/gaps',
    h(async (req, res) => {
      const email = callerEmail(req);
      const gapType = str(req.query.gap_type);
      const state = str(req.query.state);
      const q = str(req.query.q).trim();
      const highOnly = req.query.high_leverage === '1' || req.query.high_leverage === 'true';
      const limit = limitParam(req.query.limit, 50, 500);
      const offset = Math.max(0, Number(req.query.offset) || 0);
      // Sub-filter for the sparse_fields section: comma-separated field names
      // (capability,procedure,equipment). OR semantics — a row matches if its
      // missing_fields cites ANY selected field. '' = no field filter.
      const fields = str(req.query.fields).trim();

      const r = await db.query(
        `SELECT g.gap_id, g.unique_id, g.facility_name, g.state, g.district, g.gap_type,
                g.suggested_action, g.contact_channel, g.contact_value, g.missing_fields,
                g.high_leverage, g.data_confidence, g.completeness_score,
                g.sample_unverified_specialty, g.unverified_claims,
                COALESCE(ua.status, g.status) AS status,
                ua.action AS last_action
         FROM readiness.readiness_gap_items g
         LEFT JOIN LATERAL (
           SELECT status, action FROM app.user_review_actions a
           WHERE a.gap_id = g.gap_id AND a.user_email = $1
           ORDER BY a.created_at DESC LIMIT 1
         ) ua ON true
         WHERE ($2 = '' OR g.gap_type = $2)
           AND ($3 = '' OR g.state = $3)
           AND ($4 = '' OR g.facility_name ILIKE '%' || $4 || '%')
           AND ($5 = false OR g.high_leverage = true)
           AND ($8 = '' OR EXISTS (
                 SELECT 1 FROM unnest(string_to_array($8, ',')) AS f(name)
                 WHERE g.missing_fields ILIKE '%' || trim(f.name) || '%'
               ))
         ORDER BY g.high_leverage DESC, g.data_confidence ASC, g.severity_rank ASC, g.facility_name ASC
         LIMIT $6 OFFSET $7`,
        [email, gapType, state, q, highOnly, limit, offset, fields],
      );
      ok(res, { items: r.rows });
    }),
  );

  // GET /api/data/readiness/sparse-fields — facet list for the sparse_fields
  // section: every distinct field cited across sparse-field gaps, with counts.
  // Drives the dynamic "Filter by sparse field" chips (no hardcoded field set).
  app.get(
    '/api/data/readiness/sparse-fields',
    h(async (_req, res) => {
      const r = await db.query(
        `SELECT trim(f.name) AS field, COUNT(*)::int AS n
           FROM readiness.readiness_gap_items g,
                unnest(string_to_array(g.missing_fields, ',')) AS f(name)
          WHERE g.gap_type = 'sparse_fields' AND trim(f.name) <> ''
          GROUP BY trim(f.name)
          ORDER BY n DESC`,
      );
      ok(res, { items: r.rows });
    }),
  );

  // GET /api/data/readiness/facility/:id — one facility's readiness card,
  // its gaps, and the cited Track-1 claim evidence (corroboration='none' first).
  app.get(
    '/api/data/readiness/facility/:id',
    h(async (req, res) => {
      const email = callerEmail(req);
      const id = req.params.id;
      const card = await db.query(`SELECT * FROM readiness.data_readiness WHERE unique_id = $1`, [id]);
      if (!card.rows[0]) return fail(res, 'NOT_FOUND', 'facility not in readiness layer', 404);
      const gaps = await db.query(
        `SELECT g.*, COALESCE(ua.status, g.status) AS status
         FROM readiness.readiness_gap_items g
         LEFT JOIN LATERAL (
           SELECT status FROM app.user_review_actions a
           WHERE a.gap_id = g.gap_id AND a.user_email = $2 ORDER BY a.created_at DESC LIMIT 1
         ) ua ON true
         WHERE g.unique_id = $1 ORDER BY g.severity_rank ASC`,
        [id, email],
      );
      const evidence = await db.query(
        `SELECT claimed_specialty, trust_tier, corroboration, consistency_flag,
                matched_evidence, evidence_snippet, accredited
         FROM trust.facility_trust_card
         WHERE unique_id = $1
         ORDER BY (corroboration = 'none') DESC, claimed_specialty
         LIMIT 12`,
        [id],
      );
      const overrides = await db.query(
        `SELECT field, value FROM app.overrides WHERE user_email = $1 AND facility_id = $2`,
        [email, id],
      );
      ok(res, {
        facility: card.rows[0],
        gaps: gaps.rows,
        evidence: evidence.rows,
        overrides: overrides.rows,
      });
    }),
  );

  // GET /api/data/readiness/districts — the demo centrepiece: roll readiness up to
  // NFHS district (avg data_confidence) and cross it with Peter-corrected desert_score
  // to separate a REAL gap (low supply + trustworthy data) from a DATA-POOR district
  // (low supply + low-confidence data = investigate before acting). The 189 unknown-
  // supply districts surface as 'unknown_supply' (0 mapped facilities — not a true zero).
  app.get(
    '/api/data/readiness/districts',
    h(async (req, res) => {
      const limit = limitParam(req.query.limit, 200, 706);
      // Driven from the corrected gold (all 706 districts) so the 189 unknown-supply
      // districts (0 MAPPED facilities = coverage_flag='insufficient_supply_data') surface
      // as 'unknown_supply' — the data-gap that the naive desert map mistook for scarcity.
      // avg_confidence is NULL for those (no mapped facilities to measure).
      const r = await db.query(
        `WITH agg AS (
           SELECT fd.nfhs_district, fd.nfhs_state AS state,
                  COUNT(*)::int AS n_mapped,
                  ROUND(AVG(dr.data_confidence)::numeric,3)::float8 AS avg_confidence,
                  SUM(dr.high_leverage::int)::int AS high_leverage
           FROM readiness.data_readiness dr
           JOIN app_read.facility_district fd ON fd.unique_id = dr.unique_id
           WHERE fd.nfhs_district IS NOT NULL
           GROUP BY fd.nfhs_district, fd.nfhs_state
         )
         SELECT g.nfhs_district AS district, g.state,
                COALESCE(a.n_mapped, 0) AS n_facilities,
                a.avg_confidence,
                COALESCE(a.high_leverage, 0) AS high_leverage,
                g.desert_score, g.coverage_flag, g.facility_count, g.need_score,
                CASE
                  WHEN g.coverage_flag = 'insufficient_supply_data' THEN 'unknown_supply'
                  WHEN g.desert_score >= 60 AND COALESCE(a.avg_confidence, 1) < 0.8 THEN 'data_poor'
                  WHEN g.desert_score >= 60 THEN 'real_gap'
                  ELSE 'adequate'
                END AS gap_label
         FROM readiness.gold_district_supply_need g
         LEFT JOIN agg a ON a.nfhs_district = g.nfhs_district AND a.state = g.state
         ORDER BY g.desert_score DESC NULLS LAST, g.need_score DESC
         LIMIT $1`,
        [limit],
      );
      ok(res, { items: r.rows });
    }),
  );
}

// ---------------------------------------------------------------------------
// Write route — the remediation loop
// ---------------------------------------------------------------------------
function registerReadinessWriteRoutes(app: express.Application, db: LakebaseClient): void {
  // POST /api/readiness/action
  // Body: { action, unique_id, gap_id?, gap_type?, field?, new_value?, issue_description?, decision? }
  app.post(
    '/api/readiness/action',
    h(async (req, res) => {
      const email = callerEmail(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const action = str(b.action);
      const uniqueId = str(b.unique_id);
      if (!action || !uniqueId) return fail(res, 'BAD_REQUEST', 'action and unique_id are required');
      const allowed = ['patch', 'flag', 'dismiss', 'note', 'dedupe'];
      if (!allowed.includes(action)) return fail(res, 'BAD_REQUEST', `action must be one of ${allowed.join(', ')}`);

      const gapId = str(b.gap_id) || null;
      const gapType = str(b.gap_type) || null;
      const field = str(b.field) || null;
      const newValue =
        typeof b.new_value === 'string'
          ? b.new_value
          : typeof b.new_value === 'number' || typeof b.new_value === 'boolean'
            ? String(b.new_value)
            : null;
      const issue = str(b.issue_description) || null;
      const status =
        action === 'patch' ? 'patched'
        : action === 'flag' ? 'flagged'
        : action === 'dismiss' ? 'dismissed'
        : action === 'dedupe' ? 'patched'
        : 'open';
      const actionVerb =
        action === 'patch' ? 'patched'
        : action === 'flag' ? 'flagged'
        : action === 'dismiss' ? 'dismissed'
        : action === 'note' ? 'noted'
        : 'dedupe';

      // 1. always: the audit log / flag queue.
      await db.query(
        `INSERT INTO app.user_review_actions
           (user_email, gap_id, unique_id, gap_type, action, field, new_value, issue_description, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [email, gapId, uniqueId, gapType, actionVerb, field, newValue, issue, status],
      );

      // 2. mirror into the canonical tables the rest of the app reads.
      if (action === 'patch' && field) {
        await db.query(
          `INSERT INTO app.overrides (user_email, facility_id, field, value)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_email, facility_id, field)
           DO UPDATE SET value = EXCLUDED.value, created_at = NOW()`,
          [email, uniqueId, field, newValue],
        );
      } else if (action === 'note') {
        await db.query(
          `INSERT INTO app.notes (user_email, facility_id, note, created_at)
           VALUES ($1,$2,$3,NOW())
           ON CONFLICT (user_email, facility_id)
           DO UPDATE SET note = EXCLUDED.note, created_at = NOW()`,
          [email, uniqueId, issue ?? newValue ?? ''],
        );
      } else if (action === 'dedupe') {
        const decision = str(b.decision) === 'distinct' ? 'distinct' : 'merged';
        await db.query(
          `INSERT INTO app.dup_decisions (user_email, facility_id, decision)
           VALUES ($1,$2,$3)
           ON CONFLICT (user_email, facility_id)
           DO UPDATE SET decision = EXCLUDED.decision, created_at = NOW()`,
          [email, uniqueId, decision],
        );
      }
      ok(res, { gap_id: gapId, unique_id: uniqueId, status }, 201);
    }),
  );

  // GET /api/readiness/actions — the caller's consolidated remediation history / flag queue.
  app.get(
    '/api/readiness/actions',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(
        `SELECT action_id, gap_id, unique_id, gap_type, action, field, new_value,
                issue_description, status, created_at
         FROM app.user_review_actions
         WHERE user_email = $1
         ORDER BY created_at DESC LIMIT 200`,
        [email],
      );
      ok(res, { items: r.rows, gap_types: GAP_TYPES });
    }),
  );
}

// ---------------------------------------------------------------------------
// Entry point — called from onPluginsReady (after persistence bootstrap).
// ---------------------------------------------------------------------------
export function setupReadinessRoutes(appkit: AppkitLike): Promise<void> {
  appkit.server.extend((app) => {
    registerReadinessReadRoutes(app, appkit.lakebase);
    registerReadinessWriteRoutes(app, appkit.lakebase);
  });
  return Promise.resolve();
}
