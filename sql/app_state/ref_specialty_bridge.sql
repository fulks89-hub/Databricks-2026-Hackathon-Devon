-- ref_specialty_bridge: maps the TSV's granular lowercased specialty tokens
-- to the 9 canonical UI disciplines (NULL ui_discipline = no fit / out-of-scope).
-- One row per distinct granular token present in
-- nfhs_condition_symptom_specialty_map.tsv (probed exhaustively: 30 tokens,
-- 29 real + NO_SPECIALTY_MATCH). Canonical clinical mapping per the BRIDGE spec.
-- Idempotent: CREATE TABLE IF NOT EXISTS + full DELETE + INSERT.
CREATE TABLE IF NOT EXISTS workspace.app_state.ref_specialty_bridge (
  granular_specialty STRING,
  ui_discipline      STRING
) USING DELTA;

DELETE FROM workspace.app_state.ref_specialty_bridge;

INSERT INTO workspace.app_state.ref_specialty_bridge (granular_specialty, ui_discipline) VALUES
  ('internalmedicine',                              'General Medicine'),
  ('familymedicine',                                'General Medicine'),
  ('generalmedicine',                               'General Medicine'),
  ('preventivemedicine',                            'General Medicine'),
  ('chronicdiseasepreventionandlifestylemedicine',  'General Medicine'),
  ('infectiousdiseases',                            'General Medicine'),
  ('gastroenterology',                              'General Medicine'),
  ('pulmonology',                                   'General Medicine'),
  ('hematology',                                    'General Medicine'),
  ('endocrinologyanddiabetesandmetabolism',         'General Medicine'),
  ('cardiology',                                    'Cardiology'),
  ('nephrology',                                    'Nephrology'),
  ('pediatrics',                                    'Pediatrics'),
  ('pediatriccriticalcaremedicine',                 'Pediatrics'),
  ('neonatologyperinatalmedicine',                  'Pediatrics'),
  ('gynecologyandobstetrics',                       'Obstetrics'),
  ('obstetricsandmaternitycare',                    'Obstetrics'),
  ('maternalfetalmedicineorperinatology',           'Obstetrics'),
  ('familyplanningandcomplexcontraception',         'Obstetrics'),
  ('reproductiveendocrinologyandinfertility',       'Obstetrics'),
  ('medicaloncology',                               'Oncology'),
  ('surgicaloncology',                              'Oncology'),
  ('gynecologiconcology',                           'Oncology'),
  ('emergencymedicine',                             'Trauma'),
  ('bariatricsurgery',                              NULL),
  ('psychiatry',                                    NULL),
  ('otolaryngology',                                NULL),
  ('oralandmaxillofacialsurgery',                   NULL),
  ('dentistry',                                     NULL),
  ('NO_SPECIALTY_MATCH',                            NULL);
