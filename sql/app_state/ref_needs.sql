-- ref_needs: patient need key -> display label -> mapped UI discipline (NEEDS, from UI contract).
CREATE TABLE IF NOT EXISTS workspace.app_state.ref_needs (
  need_key  STRING,
  label     STRING,
  specialty STRING
) USING DELTA;

DELETE FROM workspace.app_state.ref_needs WHERE TRUE;

INSERT INTO workspace.app_state.ref_needs (need_key, label, specialty) VALUES
('cardiac','Cardiac care','Cardiology'),
('maternity','Maternity','Obstetrics'),
('injury','Injury','Orthopedics'),
('cancer','Cancer','Oncology'),
('child','Child health','Pediatrics'),
('eyes','Eye care','Ophthalmology'),
('kidney','Kidney care','Nephrology'),
('general','General care','General Medicine');
