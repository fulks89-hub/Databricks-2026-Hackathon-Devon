/**
 * Asclepius — Lakebase persistence (OLTP write) routes.
 *
 * All application STATE lives in the Lakebase Postgres schema `app`, created by
 * the app service-principal on boot (the app SP holds CAN_CONNECT_AND_CREATE).
 * Reads of synced UC data live in `app_read.*` (see read-routes.ts) — never here.
 *
 * Identity: Databricks Apps injects `X-Forwarded-Email`; we capture it as
 * `created_by` / `user_email` on every write. No passwords anywhere (DEC-001).
 *
 * Public API used here (from the `lakebase()` plugin):
 *   appkit.lakebase.query<T>(text, values?) -> Promise<{ rows: T[] }>
 *   appkit.server.extend((app) => { app.get/post/... })
 * Parameters are positional Postgres placeholders ($1, $2, ...).
 */
import { z } from 'zod';
import type express from 'express';

// ---------------------------------------------------------------------------
// Minimal structural typing over the appkit handle (avoids importing `pg`
// types, which are not a direct dependency). The lakebase plugin returns a
// `pg.QueryResult`, of which we only use `.rows`.
// ---------------------------------------------------------------------------

export interface QueryResultLike<T = Record<string, unknown>> {
  rows: T[];
}

export interface LakebaseClient {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResultLike<T>>;
}

export interface ServerExtender {
  extend(fn: (app: express.Application) => void): unknown;
}

export interface AppkitLike {
  lakebase: LakebaseClient;
  server: ServerExtender;
}

// ---------------------------------------------------------------------------
// Identity + small helpers
// ---------------------------------------------------------------------------

const DEV_EMAIL = 'demo@asclepius';

/** Caller email from the Apps-injected header, with a local-dev fallback. */
export function callerEmail(req: express.Request): string {
  const raw = req.header('X-Forwarded-Email');
  const v = raw && raw.trim() ? raw.trim() : '';
  return v || DEV_EMAIL;
}

function callerDisplay(req: express.Request, fallback: string): string {
  const raw =
    req.header('X-Forwarded-User') ??
    req.header('X-Forwarded-Preferred-Username') ??
    undefined;
  const v = raw && raw.trim() ? raw.trim() : '';
  return v || fallback;
}

function ok(res: express.Response, body: unknown, status = 200): void {
  res.status(status).json(body);
}
function fail(res: express.Response, code: string, message: string, status = 400): void {
  res.status(status).json({ error: { code, message } });
}

/** Wrap an async handler so thrown errors become a JSON 500 envelope. */
function h(
  fn: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res) => {
    fn(req, res).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[asclepius:write] route error:', message);
      if (!res.headersSent) fail(res, 'INTERNAL', message, 500);
    });
  };
}

/** Validate `req.body` against a zod schema, sending a 400 on failure. */
function parseBody<T>(
  schema: z.ZodType<T>,
  req: express.Request,
  res: express.Response,
): T | undefined {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) {
    fail(res, 'BAD_REQUEST', r.error.issues.map((i) => i.message).join('; '));
    return undefined;
  }
  return r.data;
}

/** JSON value -> a param safe to bind into a JSONB column (string or null). */
function jsonParam(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Schema + table DDL (runs once on boot; deploy-first, app SP creates its own)
// ---------------------------------------------------------------------------

const DDL: string[] = [
  `CREATE SCHEMA IF NOT EXISTS app`,

  // 1. accounts — DEC-001 sign-up, NO password column.
  `CREATE TABLE IF NOT EXISTS app.accounts (
     account_id       TEXT PRIMARY KEY,
     email            TEXT UNIQUE NOT NULL,
     display_name     TEXT,
     role             TEXT,
     city             TEXT,
     specialty        TEXT,
     sub_specialty    TEXT,
     years_experience INT,
     availability     TEXT,
     relocate         BOOLEAN,
     telehealth       BOOLEAN,
     hospital_city    TEXT,
     registration_no  TEXT,
     created_at       TIMESTAMPTZ DEFAULT NOW(),
     created_by       TEXT
   )`,

  // 1b. accounts migration — add registration_no to pre-existing deployments.
  //     CREATE TABLE IF NOT EXISTS won't add a column to an already-created
  //     table, so this ALTER backfills the IMR registration number column.
  `ALTER TABLE app.accounts ADD COLUMN IF NOT EXISTS registration_no TEXT`,

  // 2. shortlist — saved facilities, owner-scoped.
  `CREATE TABLE IF NOT EXISTS app.shortlist (
     user_email   TEXT NOT NULL,
     facility_id  TEXT NOT NULL,
     created_at   TIMESTAMPTZ DEFAULT NOW(),
     PRIMARY KEY (user_email, facility_id)
   )`,

  // 3. notes — one note per (owner, facility).
  `CREATE TABLE IF NOT EXISTS app.notes (
     user_email   TEXT NOT NULL,
     facility_id  TEXT NOT NULL,
     note         TEXT,
     created_at   TIMESTAMPTZ DEFAULT NOW(),
     PRIMARY KEY (user_email, facility_id)
   )`,

  // 4. reviews — Trust Desk confirm/dispute (facility + per-claim).
  `CREATE TABLE IF NOT EXISTS app.reviews (
     user_email   TEXT NOT NULL,
     facility_id  TEXT NOT NULL,
     decision     TEXT,
     via          TEXT,
     claim_label  TEXT,
     claim_status TEXT,
     created_at   TIMESTAMPTZ DEFAULT NOW()
   )`,

  // 5. overrides — inline field overrides for missing registry fields.
  `CREATE TABLE IF NOT EXISTS app.overrides (
     user_email   TEXT NOT NULL,
     facility_id  TEXT NOT NULL,
     field        TEXT NOT NULL,
     value        TEXT,
     created_at   TIMESTAMPTZ DEFAULT NOW(),
     PRIMARY KEY (user_email, facility_id, field)
   )`,

  // 6. dup_decisions — entity-resolution decisions.
  `CREATE TABLE IF NOT EXISTS app.dup_decisions (
     user_email   TEXT NOT NULL,
     facility_id  TEXT NOT NULL,
     decision     TEXT,
     created_at   TIMESTAMPTZ DEFAULT NOW(),
     PRIMARY KEY (user_email, facility_id)
   )`,

  // 7. roster — one count per (owner, city, discipline).
  `CREATE TABLE IF NOT EXISTS app.roster (
     user_email   TEXT NOT NULL,
     city         TEXT NOT NULL,
     discipline   TEXT NOT NULL,
     headcount    INT DEFAULT 0,
     created_at   TIMESTAMPTZ DEFAULT NOW(),
     PRIMARY KEY (user_email, city, discipline)
   )`,

  // 8. pipeline — recruitment pipeline (owner recruits an agent).
  `CREATE TABLE IF NOT EXISTS app.pipeline (
     user_email   TEXT NOT NULL,
     agent_id     TEXT NOT NULL,
     created_at   TIMESTAMPTZ DEFAULT NOW(),
     PRIMARY KEY (user_email, agent_id)
   )`,

  // 9. postings — hospital openings.
  `CREATE TABLE IF NOT EXISTS app.postings (
     posting_id   SERIAL PRIMARY KEY,
     user_email   TEXT NOT NULL,
     city         TEXT,
     hospital     TEXT,
     discipline   TEXT,
     sub          TEXT,
     driver       TEXT,
     urgency      TEXT,
     created_at   TIMESTAMPTZ DEFAULT NOW()
   )`,

  // 10. applications — clinician "express interest".
  `CREATE TABLE IF NOT EXISTS app.applications (
     application_id   SERIAL PRIMARY KEY,
     user_email       TEXT NOT NULL,
     posting_id       INT NOT NULL,
     specialty        TEXT,
     sub              TEXT,
     years_experience INT,
     created_at       TIMESTAMPTZ DEFAULT NOW()
   )`,

  // 11. referrals — sent -> accepted -> completed.
  `CREATE TABLE IF NOT EXISTS app.referrals (
     referral_id    SERIAL PRIMARY KEY,
     user_email     TEXT NOT NULL,
     facility_id    TEXT,
     facility_name  TEXT,
     city           TEXT,
     state          TEXT,
     reason         TEXT,
     urgency        TEXT,
     patient        TEXT,
     status         TEXT DEFAULT 'sent',
     created_at     TIMESTAMPTZ DEFAULT NOW()
   )`,

  // 12. scenarios — saved roster scenarios w/ authoritative gap count.
  `CREATE TABLE IF NOT EXISTS app.scenarios (
     scenario_id  SERIAL PRIMARY KEY,
     user_email   TEXT NOT NULL,
     name         TEXT,
     city         TEXT,
     roster_json  JSONB,
     gaps         INT,
     created_at   TIMESTAMPTZ DEFAULT NOW()
   )`,

  // 13. saved_searches — saved registry searches.
  `CREATE TABLE IF NOT EXISTS app.saved_searches (
     search_id    SERIAL PRIMARY KEY,
     user_email   TEXT NOT NULL,
     query        TEXT,
     filters_json JSONB,
     created_at   TIMESTAMPTZ DEFAULT NOW()
   )`,

  // 14. notifications — de-duped via (user_email, notif_key).
  `CREATE TABLE IF NOT EXISTS app.notifications (
     notification_id  SERIAL PRIMARY KEY,
     user_email       TEXT NOT NULL,
     type             TEXT,
     notif_key        TEXT,
     text             TEXT,
     read             BOOLEAN DEFAULT false,
     created_at       TIMESTAMPTZ DEFAULT NOW()
   )`,

  // Dedup index for notifications keyed on (user_email, notif_key).
  `CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe
     ON app.notifications (user_email, notif_key)
     WHERE notif_key IS NOT NULL`,

  // 15. user_review_actions — Track 4 (Data Readiness Desk) human-in-the-loop
  //     remediation audit log + flag queue. One row per reviewer action on a
  //     readiness gap; patches mirror to app.overrides, dedupe to app.dup_decisions.
  `CREATE TABLE IF NOT EXISTS app.user_review_actions (
     action_id         SERIAL PRIMARY KEY,
     user_email        TEXT NOT NULL,
     gap_id            TEXT,
     unique_id         TEXT,
     entity_type       TEXT DEFAULT 'facility',
     gap_type          TEXT,
     action            TEXT,            -- patched | flagged | dismissed | noted | dedupe
     field             TEXT,
     new_value         TEXT,
     issue_description TEXT,
     status            TEXT DEFAULT 'open',  -- open | patched | flagged | dismissed | confirmed
     created_at        TIMESTAMPTZ DEFAULT NOW()
   )`,

  // Latest-action lookups per (owner, gap).
  `CREATE INDEX IF NOT EXISTS ura_user_gap
     ON app.user_review_actions (user_email, gap_id, created_at DESC)`,
];

/** Best-effort schema bootstrap. Logs but never crashes boot (deploy-first:
 *  SELECT grants on app_read land later, and the app SP creates `app` itself). */
async function ensureSchema(db: LakebaseClient): Promise<void> {
  for (const stmt of DDL) {
    try {
      await db.query(stmt);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // First ~40 chars of the statement for log context.
      console.warn(`[asclepius:write] DDL skipped (${message}): ${stmt.slice(0, 48)}…`);
    }
  }
}

// ---------------------------------------------------------------------------
// Notification push helper (idempotent on (user_email, notif_key))
// ---------------------------------------------------------------------------

interface PushArgs {
  userEmail: string;
  type: string;
  text: string;
  notifKey: string;
}

async function pushNotification(db: LakebaseClient, a: PushArgs): Promise<void> {
  await db.query(
    `INSERT INTO app.notifications (user_email, type, notif_key, text, read)
     VALUES ($1, $2, $3, $4, false)
     ON CONFLICT (user_email, notif_key) WHERE notif_key IS NOT NULL
     DO NOTHING`,
    [a.userEmail, a.type, a.notifKey, a.text],
  );
}

// ---------------------------------------------------------------------------
// zod schemas
// ---------------------------------------------------------------------------

const Email = z.string().min(1);

const AccountSchema = z.object({
  email: Email.optional(),
  display_name: z.string().optional(),
  role: z.enum(['patient', 'doctor', 'hospital_admin']).default('patient'),
  city: z.string().optional(),
  specialty: z.string().optional(),
  sub_specialty: z.string().optional(),
  years_experience: z.coerce.number().int().optional(),
  availability: z.string().optional(),
  relocate: z.boolean().optional(),
  telehealth: z.boolean().optional(),
  hospital_city: z.string().optional(),
  registration_no: z.string().optional(),
});

const ShortlistSchema = z.object({
  facility_id: z.string().min(1, 'facility_id required'),
  on: z.boolean().optional(),
});

const NotesSchema = z.object({
  facility_id: z.string().min(1, 'facility_id required'),
  text: z.string().default(''),
});

const ReviewSchema = z.object({
  facility_id: z.string().min(1, 'facility_id required'),
  decision: z.enum(['confirmed', 'site_visit']).optional(),
  via: z.enum(['manual', 'call']).default('manual'),
  claim_label: z.string().optional(),
  claim_status: z.enum(['confirmed', 'disputed']).optional(),
});

const OverrideSchema = z.object({
  facility_id: z.string().min(1, 'facility_id required'),
  field: z.string().min(1, 'field required'),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

const DupSchema = z.object({
  facility_id: z.string().min(1, 'facility_id required'),
  decision: z.enum(['merged', 'distinct']).optional(),
});

const RosterSchema = z.object({
  city: z.string().min(1, 'city required'),
  counts: z.record(z.string(), z.coerce.number().int().min(0)),
});

const PipelineSchema = z.object({
  agent_id: z.string().min(1, 'agent_id required'),
});

const PostingSchema = z.object({
  city: z.string().min(1, 'city required'),
  hospital: z.string().optional(),
  discipline: z.string().min(1, 'discipline required'),
  sub: z.string().optional(),
  driver: z.string().optional(),
  urgency: z.enum(['high', 'medium', 'low']).default('medium'),
});

const ApplicationSchema = z.object({
  posting_id: z.coerce.number().int(),
  specialty: z.string().optional(),
  sub: z.string().optional(),
  years_experience: z.coerce.number().int().optional(),
});

const ReferralSchema = z.object({
  facility_id: z.string().optional(),
  facility_name: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  reason: z.string().optional(),
  urgency: z.enum(['high', 'medium', 'low']).default('medium'),
  patient: z.string().optional(),
});

const ReferralPatchSchema = z.object({
  status: z.enum(['sent', 'accepted', 'completed']).optional(),
});

const ScenarioSchema = z.object({
  name: z.string().optional(),
  city: z.string().optional(),
  roster: z.record(z.string(), z.coerce.number().int().min(0)).default({}),
});

const SavedSearchSchema = z.object({
  query: z.string().default(''),
  filters: z.record(z.string(), z.unknown()).optional(),
});

const NotificationSchema = z.object({
  type: z.enum(['reach', 'interest', 'match']).default('match'),
  text: z.string().min(1, 'text required'),
  notif_key: z.string().optional(),
  user_email: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

function registerWriteRoutes(app: express.Application, db: LakebaseClient): void {
  // ===== 1. ACCOUNTS (DEC-001 — no password) ================================

  // POST /api/accounts — sign-up / profile upsert (idempotent on email).
  // A doctor sign-up is simultaneously a recruitable free-agent listing.
  app.post(
    '/api/accounts',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(AccountSchema, req, res);
      if (!body) return;
      const accountEmail = body.email || email;
      const display = body.display_name || callerDisplay(req, accountEmail);
      const accountId = `acc_${accountEmail}`;

      const r = await db.query(
        `INSERT INTO app.accounts (
           account_id, email, display_name, role, city, specialty, sub_specialty,
           years_experience, availability, relocate, telehealth, hospital_city,
           registration_no, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (email) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           role = EXCLUDED.role,
           city = EXCLUDED.city,
           specialty = EXCLUDED.specialty,
           sub_specialty = EXCLUDED.sub_specialty,
           years_experience = EXCLUDED.years_experience,
           availability = EXCLUDED.availability,
           relocate = EXCLUDED.relocate,
           telehealth = EXCLUDED.telehealth,
           hospital_city = EXCLUDED.hospital_city,
           registration_no = EXCLUDED.registration_no
         RETURNING *`,
        [
          accountId,
          accountEmail,
          display,
          body.role,
          body.city ?? null,
          body.specialty ?? null,
          body.sub_specialty ?? null,
          body.years_experience ?? null,
          body.availability ?? null,
          body.relocate ?? null,
          body.telehealth ?? null,
          body.hospital_city ?? null,
          body.registration_no ?? null,
          email,
        ],
      );
      ok(res, { account: r.rows[0] ?? null, seededAgent: body.role === 'doctor' }, 201);
    }),
  );

  // GET /api/accounts/me — current profile from header identity.
  app.get(
    '/api/accounts/me',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(`SELECT * FROM app.accounts WHERE email = $1 LIMIT 1`, [
        email,
      ]);
      ok(res, { account: r.rows[0] ?? null, email });
    }),
  );

  // POST /api/accounts/login — load profile by email (no password check).
  app.post(
    '/api/accounts/login',
    h(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const loginEmail = (body.email as string) || callerEmail(req);
      const r = await db.query(`SELECT * FROM app.accounts WHERE email = $1 LIMIT 1`, [
        loginEmail,
      ]);
      if (!r.rows[0]) return fail(res, 'NOT_FOUND', 'No account for that email', 404);
      ok(res, { account: r.rows[0] });
    }),
  );

  // GET /api/accounts/:email — login = load profile.
  app.get(
    '/api/accounts/:email',
    h(async (req, res) => {
      const r = await db.query(`SELECT * FROM app.accounts WHERE email = $1 LIMIT 1`, [
        req.params.email,
      ]);
      if (!r.rows[0]) return fail(res, 'NOT_FOUND', 'No account for that email', 404);
      ok(res, { account: r.rows[0] });
    }),
  );

  // ===== 2. SHORTLIST (toggle add/remove; owner-scoped) =====================

  app.get(
    '/api/shortlist',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(
        `SELECT facility_id, created_at FROM app.shortlist
         WHERE user_email = $1 ORDER BY created_at DESC LIMIT 200`,
        [email],
      );
      ok(res, { items: r.rows });
    }),
  );

  // POST /api/shortlist — idempotent toggle. Body { facility_id, on? }.
  app.post(
    '/api/shortlist',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(ShortlistSchema, req, res);
      if (!body) return;

      const existing = await db.query(
        `SELECT 1 FROM app.shortlist WHERE user_email = $1 AND facility_id = $2 LIMIT 1`,
        [email, body.facility_id],
      );
      const isOn = existing.rows.length > 0;
      const want = body.on === undefined ? !isOn : body.on;

      if (want && !isOn) {
        await db.query(
          `INSERT INTO app.shortlist (user_email, facility_id) VALUES ($1, $2)
           ON CONFLICT (user_email, facility_id) DO NOTHING`,
          [email, body.facility_id],
        );
      } else if (!want && isOn) {
        await db.query(
          `DELETE FROM app.shortlist WHERE user_email = $1 AND facility_id = $2`,
          [email, body.facility_id],
        );
      }
      ok(res, { facility_id: body.facility_id, saved: want });
    }),
  );

  // DELETE /api/shortlist/:facilityId
  app.delete(
    '/api/shortlist/:facilityId',
    h(async (req, res) => {
      const email = callerEmail(req);
      await db.query(
        `DELETE FROM app.shortlist WHERE user_email = $1 AND facility_id = $2`,
        [email, req.params.facilityId],
      );
      ok(res, { facility_id: req.params.facilityId, saved: false });
    }),
  );

  // ===== 3. NOTES (one note per (owner, facility); upsert) ==================

  app.get(
    '/api/notes',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(
        `SELECT facility_id, note, created_at FROM app.notes
         WHERE user_email = $1 ORDER BY created_at DESC LIMIT 200`,
        [email],
      );
      ok(res, { items: r.rows });
    }),
  );

  // POST /api/notes — upsert one note per (owner, facility). Body { facility_id, text }.
  app.post(
    '/api/notes',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(NotesSchema, req, res);
      if (!body) return;
      await db.query(
        `INSERT INTO app.notes (user_email, facility_id, note, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_email, facility_id)
         DO UPDATE SET note = EXCLUDED.note, created_at = NOW()`,
        [email, body.facility_id, body.text],
      );
      ok(res, { facility_id: body.facility_id, text: body.text });
    }),
  );

  // ===== 4. REVIEWS (Trust Desk confirm/dispute) ============================

  app.get(
    '/api/reviews',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(
        `SELECT facility_id, decision, via, claim_label, claim_status, created_at
         FROM app.reviews WHERE user_email = $1 ORDER BY created_at DESC LIMIT 200`,
        [email],
      );
      ok(res, { items: r.rows });
    }),
  );

  // POST /api/reviews — facility decision and/or per-claim confirm/dispute.
  // Re-POST same value clears (toggle). One row per (owner, facility, claim slot).
  app.post(
    '/api/reviews',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(ReviewSchema, req, res);
      if (!body) return;
      const claimLabel = body.claim_label ?? null;
      const isClaim = claimLabel !== null;
      const newDecision = isClaim ? (body.claim_status ?? null) : (body.decision ?? null);

      const existing = await db.query<{ decision: string | null; claim_status: string | null }>(
        `SELECT decision, claim_status FROM app.reviews
         WHERE user_email = $1 AND facility_id = $2
           AND (($3::text IS NULL AND claim_label IS NULL) OR claim_label = $3)
         LIMIT 1`,
        [email, body.facility_id, claimLabel],
      );
      const prev = existing.rows[0];
      const prevDecision = isClaim ? prev?.claim_status : prev?.decision;
      const toggleOff = existing.rows.length > 0 && prevDecision === newDecision;

      await db.query(
        `DELETE FROM app.reviews
         WHERE user_email = $1 AND facility_id = $2
           AND (($3::text IS NULL AND claim_label IS NULL) OR claim_label = $3)`,
        [email, body.facility_id, claimLabel],
      );

      if (!toggleOff) {
        await db.query(
          `INSERT INTO app.reviews
             (user_email, facility_id, decision, via, claim_label, claim_status)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            email,
            body.facility_id,
            body.decision ?? null,
            body.via,
            claimLabel,
            body.claim_status ?? null,
          ],
        );
      }
      ok(res, {
        facility_id: body.facility_id,
        decision: isClaim ? null : toggleOff ? null : newDecision,
        claim_label: claimLabel,
        claim_status: isClaim ? (toggleOff ? null : newDecision) : null,
      });
    }),
  );

  // ===== 5. OVERRIDES (inline field override; value=null clears) ============

  app.get(
    '/api/overrides',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(
        `SELECT facility_id, field, value FROM app.overrides
         WHERE user_email = $1 ORDER BY created_at DESC LIMIT 500`,
        [email],
      );
      ok(res, { items: r.rows });
    }),
  );

  // PUT /api/overrides/:facilityId — Body { field, value }. value=null clears.
  app.put(
    '/api/overrides/:facilityId',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(
        OverrideSchema.omit({ facility_id: true }),
        req,
        res,
      );
      if (!body) return;
      const fid = req.params.facilityId;
      const value =
        body.value === undefined || body.value === null ? null : String(body.value);

      if (value === null) {
        await db.query(
          `DELETE FROM app.overrides WHERE user_email = $1 AND facility_id = $2 AND field = $3`,
          [email, fid, body.field],
        );
        return ok(res, { facility_id: fid, field: body.field, value: null });
      }
      await db.query(
        `INSERT INTO app.overrides (user_email, facility_id, field, value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_email, facility_id, field)
         DO UPDATE SET value = EXCLUDED.value, created_at = NOW()`,
        [email, fid, body.field, value],
      );
      ok(res, { facility_id: fid, field: body.field, value });
    }),
  );

  // ===== 6. DUP_DECISIONS (entity-resolution; re-POST same = clear) =========

  app.get(
    '/api/duplicates',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(
        `SELECT facility_id, decision FROM app.dup_decisions
         WHERE user_email = $1 ORDER BY created_at DESC LIMIT 500`,
        [email],
      );
      ok(res, { items: r.rows });
    }),
  );

  app.post(
    '/api/duplicates',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(DupSchema, req, res);
      if (!body) return;

      const existing = await db.query<{ decision: string | null }>(
        `SELECT decision FROM app.dup_decisions
         WHERE user_email = $1 AND facility_id = $2 LIMIT 1`,
        [email, body.facility_id],
      );
      const toggleOff =
        existing.rows.length > 0 && existing.rows[0].decision === (body.decision ?? null);

      if (toggleOff) {
        await db.query(
          `DELETE FROM app.dup_decisions WHERE user_email = $1 AND facility_id = $2`,
          [email, body.facility_id],
        );
        return ok(res, { facility_id: body.facility_id, decision: null });
      }
      await db.query(
        `INSERT INTO app.dup_decisions (user_email, facility_id, decision)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_email, facility_id)
         DO UPDATE SET decision = EXCLUDED.decision, created_at = NOW()`,
        [email, body.facility_id, body.decision ?? null],
      );
      ok(res, { facility_id: body.facility_id, decision: body.decision ?? null });
    }),
  );

  // ===== 7. ROSTER (one count per (owner, city, discipline)) ================

  app.get(
    '/api/roster',
    h(async (req, res) => {
      const email = callerEmail(req);
      const city = (req.query.city as string) ?? '';
      const r = await db.query(
        `SELECT city, discipline, headcount FROM app.roster
         WHERE user_email = $1 AND ($2 = '' OR city = $2)
         ORDER BY city, discipline`,
        [email, city],
      );
      ok(res, { items: r.rows });
    }),
  );

  // PUT /api/roster — Body { city, counts:{discipline:int} }. Replaces the
  // city's roster for this owner.
  app.put(
    '/api/roster',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(RosterSchema, req, res);
      if (!body) return;
      for (const [discipline, headcount] of Object.entries(body.counts)) {
        await db.query(
          `INSERT INTO app.roster (user_email, city, discipline, headcount)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_email, city, discipline)
           DO UPDATE SET headcount = EXCLUDED.headcount, created_at = NOW()`,
          [email, body.city, discipline, headcount],
        );
      }
      ok(res, { city: body.city, counts: body.counts });
    }),
  );

  // ===== 8. PIPELINE (recruit toggle; emits 'reach' notification) ===========

  app.get(
    '/api/pipeline',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(
        `SELECT agent_id, created_at FROM app.pipeline
         WHERE user_email = $1 ORDER BY created_at DESC LIMIT 200`,
        [email],
      );
      ok(res, { items: r.rows });
    }),
  );

  app.post(
    '/api/pipeline',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(PipelineSchema, req, res);
      if (!body) return;

      const existing = await db.query(
        `SELECT 1 FROM app.pipeline WHERE user_email = $1 AND agent_id = $2 LIMIT 1`,
        [email, body.agent_id],
      );
      if (existing.rows.length > 0) {
        await db.query(
          `DELETE FROM app.pipeline WHERE user_email = $1 AND agent_id = $2`,
          [email, body.agent_id],
        );
        return ok(res, { agent_id: body.agent_id, recruited: false });
      }
      await db.query(
        `INSERT INTO app.pipeline (user_email, agent_id) VALUES ($1, $2)
         ON CONFLICT (user_email, agent_id) DO NOTHING`,
        [email, body.agent_id],
      );
      // Fan-out: notify the agent (their email == agent_id for doctor sign-ups).
      await pushNotification(db, {
        userEmail: body.agent_id,
        type: 'reach',
        text: `A hospital reached out to you about an opening.`,
        notifKey: `reach_${email}_${body.agent_id}`,
      });
      ok(res, { agent_id: body.agent_id, recruited: true }, 201);
    }),
  );

  app.delete(
    '/api/pipeline/:agentId',
    h(async (req, res) => {
      const email = callerEmail(req);
      await db.query(
        `DELETE FROM app.pipeline WHERE user_email = $1 AND agent_id = $2`,
        [email, req.params.agentId],
      );
      ok(res, { agent_id: req.params.agentId, recruited: false });
    }),
  );

  // ===== 9. POSTINGS (hospital openings; toggle post/withdraw) ==============

  app.get(
    '/api/postings',
    h(async (req, res) => {
      const email = callerEmail(req);
      const mine = req.query.mine === '1' || req.query.mine === 'true';
      const discipline = (req.query.discipline as string) ?? '';

      if (mine) {
        const r = await db.query(
          `SELECT p.posting_id, p.city, p.hospital, p.discipline, p.sub, p.driver,
                  p.urgency, p.created_at,
                  (SELECT COUNT(*) FROM app.applications a
                   WHERE a.posting_id = p.posting_id)::int AS applicants
           FROM app.postings p
           WHERE p.user_email = $1
           ORDER BY p.created_at DESC LIMIT 200`,
          [email],
        );
        return ok(res, { items: r.rows });
      }
      const r = await db.query(
        `SELECT posting_id, city, hospital, discipline, sub, driver, urgency,
                user_email, created_at
         FROM app.postings
         WHERE ($1 = '' OR discipline = $1)
         ORDER BY created_at DESC LIMIT 200`,
        [discipline],
      );
      ok(res, { items: r.rows });
    }),
  );

  // POST /api/postings — toggle post/withdraw for (owner, city, discipline, sub).
  app.post(
    '/api/postings',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(PostingSchema, req, res);
      if (!body) return;
      const sub = body.sub ?? '';

      const existing = await db.query<{ posting_id: number }>(
        `SELECT posting_id FROM app.postings
         WHERE user_email = $1 AND city = $2 AND discipline = $3
           AND COALESCE(sub,'') = $4 LIMIT 1`,
        [email, body.city, body.discipline, sub],
      );
      if (existing.rows.length > 0) {
        const pid = existing.rows[0].posting_id;
        await db.query(
          `DELETE FROM app.postings WHERE user_email = $1 AND posting_id = $2`,
          [email, pid],
        );
        return ok(res, { posting_id: pid, posted: false });
      }
      const r = await db.query<{ posting_id: number }>(
        `INSERT INTO app.postings
           (user_email, city, hospital, discipline, sub, driver, urgency)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING posting_id`,
        [
          email,
          body.city,
          body.hospital ?? null,
          body.discipline,
          body.sub ?? null,
          body.driver ?? null,
          body.urgency,
        ],
      );
      ok(res, { posting_id: r.rows[0]?.posting_id, posted: true }, 201);
    }),
  );

  app.delete(
    '/api/postings/:id',
    h(async (req, res) => {
      const email = callerEmail(req);
      await db.query(
        `DELETE FROM app.postings WHERE user_email = $1 AND posting_id = $2`,
        [email, Number(req.params.id)],
      );
      ok(res, { posting_id: Number(req.params.id), posted: false });
    }),
  );

  // ===== 10. APPLICATIONS ("Express interest"; toggle) ======================
  // Side effect: emit an 'interest' notification to the posting owner.

  app.get(
    '/api/applications',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(
        `SELECT application_id, posting_id, specialty, sub, years_experience, created_at
         FROM app.applications WHERE user_email = $1
         ORDER BY created_at DESC LIMIT 200`,
        [email],
      );
      ok(res, { items: r.rows });
    }),
  );

  // POST /api/applications — toggle interest. Body { posting_id, specialty, sub, years_experience }.
  app.post(
    '/api/applications',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(ApplicationSchema, req, res);
      if (!body) return;

      const existing = await db.query(
        `SELECT 1 FROM app.applications WHERE user_email = $1 AND posting_id = $2 LIMIT 1`,
        [email, body.posting_id],
      );
      if (existing.rows.length > 0) {
        await db.query(
          `DELETE FROM app.applications WHERE user_email = $1 AND posting_id = $2`,
          [email, body.posting_id],
        );
        return ok(res, { posting_id: body.posting_id, applied: false });
      }
      await db.query(
        `INSERT INTO app.applications
           (user_email, posting_id, specialty, sub, years_experience)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          email,
          body.posting_id,
          body.specialty ?? null,
          body.sub ?? null,
          body.years_experience ?? null,
        ],
      );
      // Fan-out: notify the posting owner (hospital).
      const posting = await db.query<{
        owner: string;
        discipline: string | null;
        city: string | null;
      }>(
        `SELECT user_email AS owner, discipline, city FROM app.postings
         WHERE posting_id = $1 LIMIT 1`,
        [body.posting_id],
      );
      const owner = posting.rows[0]?.owner;
      if (owner) {
        const disc = posting.rows[0]?.discipline ?? 'opening';
        const city = posting.rows[0]?.city ?? '';
        await pushNotification(db, {
          userEmail: owner,
          type: 'interest',
          text: `A ${body.specialty ?? 'clinician'} is interested in your ${disc} opening${
            city ? ` in ${city}` : ''
          }.`,
          notifKey: `interest_${body.posting_id}_${email}`,
        });
      }
      ok(res, { posting_id: body.posting_id, applied: true }, 201);
    }),
  );

  app.delete(
    '/api/applications/:id',
    h(async (req, res) => {
      const email = callerEmail(req);
      await db.query(
        `DELETE FROM app.applications WHERE user_email = $1 AND application_id = $2`,
        [email, Number(req.params.id)],
      );
      ok(res, { application_id: Number(req.params.id), applied: false });
    }),
  );

  // ===== 11. REFERRALS (sent -> accepted -> completed) ======================

  app.get(
    '/api/referrals',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(
        `SELECT referral_id, facility_id, facility_name, city, state, reason,
                urgency, patient, status, created_at
         FROM app.referrals WHERE user_email = $1
         ORDER BY created_at DESC LIMIT 200`,
        [email],
      );
      ok(res, { items: r.rows });
    }),
  );

  // POST /api/referrals — create with status 'sent'.
  app.post(
    '/api/referrals',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(ReferralSchema, req, res);
      if (!body) return;
      const r = await db.query<{ referral_id: number }>(
        `INSERT INTO app.referrals
           (user_email, facility_id, facility_name, city, state, reason,
            urgency, patient, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sent')
         RETURNING referral_id`,
        [
          email,
          body.facility_id ?? null,
          body.facility_name ?? null,
          body.city ?? null,
          body.state ?? null,
          body.reason ?? null,
          body.urgency,
          body.patient ?? null,
        ],
      );
      ok(res, { referral_id: r.rows[0]?.referral_id, status: 'sent' }, 201);
    }),
  );

  // PATCH /api/referrals/:id — advance sent -> accepted -> completed.
  app.patch(
    '/api/referrals/:id',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(ReferralPatchSchema, req, res);
      if (!body) return;
      const next: Record<string, string> = {
        sent: 'accepted',
        accepted: 'completed',
        completed: 'completed',
      };
      const cur = await db.query<{ status: string | null }>(
        `SELECT status FROM app.referrals WHERE user_email = $1 AND referral_id = $2 LIMIT 1`,
        [email, Number(req.params.id)],
      );
      if (!cur.rows[0]) return fail(res, 'NOT_FOUND', 'referral not found', 404);
      const target = body.status ?? next[cur.rows[0].status ?? 'sent'] ?? 'accepted';
      await db.query(
        `UPDATE app.referrals SET status = $1 WHERE user_email = $2 AND referral_id = $3`,
        [target, email, Number(req.params.id)],
      );
      ok(res, { referral_id: Number(req.params.id), status: target });
    }),
  );

  app.delete(
    '/api/referrals/:id',
    h(async (req, res) => {
      const email = callerEmail(req);
      await db.query(
        `DELETE FROM app.referrals WHERE user_email = $1 AND referral_id = $2`,
        [email, Number(req.params.id)],
      );
      ok(res, { referral_id: Number(req.params.id), deleted: true });
    }),
  );

  // ===== 12. SCENARIOS (server recomputes gaps authoritatively) =============

  app.get(
    '/api/scenarios',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(
        `SELECT scenario_id, name, city, roster_json, gaps, created_at
         FROM app.scenarios WHERE user_email = $1
         ORDER BY created_at DESC LIMIT 200`,
        [email],
      );
      ok(res, { items: r.rows });
    }),
  );

  // POST /api/scenarios — Body { name, city, roster:{disc:int} }.
  // `gaps` recomputed server-side: disciplines with demand>=70 (app_read) and
  // no roster coverage. Falls back to 0 if app_read is not yet granted.
  app.post(
    '/api/scenarios',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(ScenarioSchema, req, res);
      if (!body) return;

      let gaps = 0;
      try {
        const demand = await db.query<{ discipline: string }>(
          `SELECT discipline FROM app_read.district_demand
           WHERE state = $1 AND demand_score >= 70`,
          [body.city ?? ''],
        );
        for (const row of demand.rows) {
          const have = body.roster[row.discipline] ?? 0;
          if (have === 0) gaps += 1;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[asclepius:write] scenario gap recompute skipped:', message);
      }

      const r = await db.query<{ scenario_id: number }>(
        `INSERT INTO app.scenarios (user_email, name, city, roster_json, gaps)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING scenario_id`,
        [email, body.name ?? null, body.city ?? null, jsonParam(body.roster), gaps],
      );
      ok(res, { scenario_id: r.rows[0]?.scenario_id, gaps }, 201);
    }),
  );

  app.delete(
    '/api/scenarios/:id',
    h(async (req, res) => {
      const email = callerEmail(req);
      await db.query(
        `DELETE FROM app.scenarios WHERE user_email = $1 AND scenario_id = $2`,
        [email, Number(req.params.id)],
      );
      ok(res, { scenario_id: Number(req.params.id), deleted: true });
    }),
  );

  // ===== 13. SAVED_SEARCHES =================================================

  app.get(
    '/api/saved-searches',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query(
        `SELECT search_id, query, filters_json, created_at
         FROM app.saved_searches WHERE user_email = $1
         ORDER BY created_at DESC LIMIT 200`,
        [email],
      );
      ok(res, { items: r.rows });
    }),
  );

  app.post(
    '/api/saved-searches',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(SavedSearchSchema, req, res);
      if (!body) return;
      const r = await db.query<{ search_id: number }>(
        `INSERT INTO app.saved_searches (user_email, query, filters_json)
         VALUES ($1, $2, $3::jsonb)
         RETURNING search_id`,
        [email, body.query, jsonParam(body.filters ?? {})],
      );
      ok(res, { search_id: r.rows[0]?.search_id }, 201);
    }),
  );

  app.delete(
    '/api/saved-searches/:id',
    h(async (req, res) => {
      const email = callerEmail(req);
      await db.query(
        `DELETE FROM app.saved_searches WHERE user_email = $1 AND search_id = $2`,
        [email, Number(req.params.id)],
      );
      ok(res, { search_id: Number(req.params.id), deleted: true });
    }),
  );

  // ===== 14. NOTIFICATIONS ==================================================

  app.get(
    '/api/notifications',
    h(async (req, res) => {
      const email = callerEmail(req);
      const r = await db.query<{ read: boolean }>(
        `SELECT notification_id, type, notif_key, text, read, created_at
         FROM app.notifications WHERE user_email = $1
         ORDER BY created_at DESC LIMIT 200`,
        [email],
      );
      ok(res, { items: r.rows, unread: r.rows.filter((x) => !x.read).length });
    }),
  );

  // POST /api/notifications — explicit/internal push (defaults owner to caller).
  app.post(
    '/api/notifications',
    h(async (req, res) => {
      const email = callerEmail(req);
      const body = parseBody(NotificationSchema, req, res);
      if (!body) return;
      const userEmail = body.user_email || email;
      const notifKey = body.notif_key || `${body.type}_${Date.now()}`;
      await pushNotification(db, {
        userEmail,
        type: body.type,
        text: body.text,
        notifKey,
      });
      ok(res, { user_email: userEmail, notif_key: notifKey }, 201);
    }),
  );

  // PATCH /api/notifications/read — mark all the caller's notifications read.
  app.patch(
    '/api/notifications/read',
    h(async (req, res) => {
      const email = callerEmail(req);
      await db.query(`UPDATE app.notifications SET read = true WHERE user_email = $1`, [
        email,
      ]);
      ok(res, { read: true });
    }),
  );

  // DELETE /api/notifications — clear all the caller's notifications.
  app.delete(
    '/api/notifications',
    h(async (req, res) => {
      const email = callerEmail(req);
      await db.query(`DELETE FROM app.notifications WHERE user_email = $1`, [email]);
      ok(res, { cleared: true });
    }),
  );
}

// ---------------------------------------------------------------------------
// Entry point — called from onPluginsReady.
// ---------------------------------------------------------------------------

/**
 * Bootstraps the `app` schema/tables and mounts all OLTP write routes.
 * Schema creation is best-effort (logs, never crashes boot).
 */
export async function setupPersistenceRoutes(appkit: AppkitLike): Promise<void> {
  await ensureSchema(appkit.lakebase);
  appkit.server.extend((app) => {
    registerWriteRoutes(app, appkit.lakebase);
  });
}
