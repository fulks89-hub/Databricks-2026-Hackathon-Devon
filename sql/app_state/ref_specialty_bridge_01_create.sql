-- ref_specialty_bridge (statement 1/3): create the table if absent.
-- Maps the TSV's granular lowercased specialty tokens to the 9 canonical UI
-- disciplines (NULL ui_discipline = no fit / out-of-scope). Idempotent.
CREATE TABLE IF NOT EXISTS workspace.app_state.ref_specialty_bridge (
  granular_specialty STRING,
  ui_discipline      STRING
) USING DELTA
