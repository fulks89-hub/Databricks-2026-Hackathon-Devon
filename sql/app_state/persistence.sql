-- ============================================================================
-- Asclepius app_state — OLTP PERSISTENCE tables (the 15 localStorage concepts)
-- Initial store = Delta (Lakebase migration is later). Idempotent DDL.
-- Keyed by user_email where per-user. created_at TIMESTAMP everywhere;
-- created_by STRING (real Databricks identity) where audit-relevant.
-- GUARDRAIL: accounts has NO password column (DEC-001).
-- ============================================================================

-- 1. accounts (DEC-001) — NO password column. One row per registered user.
CREATE TABLE IF NOT EXISTS workspace.app_state.accounts (
  account_id       STRING,
  email            STRING,
  display_name     STRING,
  role             STRING,          -- 'patient' | 'doctor' | 'hospital_admin'
  city             STRING,
  specialty        STRING,          -- doctor role field
  sub_specialty    STRING,          -- doctor role field
  years_experience INT,             -- doctor role field
  availability     STRING,          -- doctor role field
  relocate         BOOLEAN,         -- doctor role field
  telehealth       BOOLEAN,         -- doctor role field
  hospital_city    STRING,          -- hospital_admin role field
  created_at       TIMESTAMP,
  created_by       STRING
) USING DELTA;

-- 2. shortlist — facilities a user has saved.
CREATE TABLE IF NOT EXISTS workspace.app_state.shortlist (
  user_email   STRING,
  facility_id  STRING,
  created_at   TIMESTAMP
) USING DELTA;

-- 3. notes — free-text note per (user, facility).
CREATE TABLE IF NOT EXISTS workspace.app_state.notes (
  user_email   STRING,
  facility_id  STRING,
  note         STRING,
  updated_at   TIMESTAMP
) USING DELTA;

-- 4. reviews — Trust Desk verification decisions on facility claims.
CREATE TABLE IF NOT EXISTS workspace.app_state.reviews (
  user_email    STRING,
  facility_id   STRING,
  decision      STRING,   -- e.g. 'verified' | 'rejected' | 'needs_info'
  via           STRING,   -- verification channel/source
  claim_label   STRING,   -- which claim text was reviewed
  claim_status  STRING,   -- resulting status for that claim
  ts            TIMESTAMP
) USING DELTA;

-- 5. overrides — field-level corrections to facility data.
CREATE TABLE IF NOT EXISTS workspace.app_state.overrides (
  user_email   STRING,
  facility_id  STRING,
  field        STRING,
  value        STRING,
  ts           TIMESTAMP
) USING DELTA;

-- 6. dup_decisions — keep/merge/not-a-dup decisions on possible duplicates.
CREATE TABLE IF NOT EXISTS workspace.app_state.dup_decisions (
  user_email   STRING,
  facility_id  STRING,
  decision     STRING,
  ts           TIMESTAMP
) USING DELTA;

-- 7. roster — headcount of a discipline a hospital has, per city.
CREATE TABLE IF NOT EXISTS workspace.app_state.roster (
  user_email   STRING,
  city         STRING,
  discipline   STRING,
  headcount    INT
) USING DELTA;

-- 8. pipeline — agents added to a user's recruiting pipeline.
CREATE TABLE IF NOT EXISTS workspace.app_state.pipeline (
  user_email   STRING,
  agent_id     STRING,
  created_at   TIMESTAMP
) USING DELTA;

-- 9. postings — open positions a hospital admin has posted.
CREATE TABLE IF NOT EXISTS workspace.app_state.postings (
  posting_id   STRING,
  user_email   STRING,
  city         STRING,
  hospital     STRING,
  discipline   STRING,
  sub          STRING,
  driver       STRING,    -- need/driver justifying the posting
  urgency      STRING,
  created_at   TIMESTAMP
) USING DELTA;

-- 10. applications — a doctor's application to a posting.
CREATE TABLE IF NOT EXISTS workspace.app_state.applications (
  application_id    STRING,
  user_email        STRING,
  posting_id        STRING,
  specialty         STRING,
  sub               STRING,
  years_experience  INT,
  created_at        TIMESTAMP
) USING DELTA;

-- 11. referrals — patient referral sent to a facility.
CREATE TABLE IF NOT EXISTS workspace.app_state.referrals (
  referral_id    STRING,
  user_email     STRING,
  facility_id    STRING,
  facility_name  STRING,
  city           STRING,
  state          STRING,
  reason         STRING,
  urgency        STRING,
  patient        STRING,
  status         STRING,
  ts             TIMESTAMP
) USING DELTA;

-- 12. scenarios — saved roster/coverage planning scenarios.
CREATE TABLE IF NOT EXISTS workspace.app_state.scenarios (
  scenario_id  STRING,
  user_email   STRING,
  name         STRING,
  city         STRING,
  roster_json  STRING,   -- serialized roster snapshot
  gaps         INT,
  ts           TIMESTAMP
) USING DELTA;

-- 13. saved_searches — saved query + filter state.
CREATE TABLE IF NOT EXISTS workspace.app_state.saved_searches (
  search_id     STRING,
  user_email    STRING,
  query         STRING,
  filters_json  STRING,   -- serialized filter object
  created_at    TIMESTAMP
) USING DELTA;

-- 14. notifications — in-app notifications for a user.
CREATE TABLE IF NOT EXISTS workspace.app_state.notifications (
  notification_id  STRING,
  user_email       STRING,
  type             STRING,
  notif_key        STRING,
  text             STRING,
  read             BOOLEAN,
  ts               TIMESTAMP
) USING DELTA;
