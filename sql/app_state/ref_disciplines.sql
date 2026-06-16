-- ref_disciplines: the 9 UI disciplines in display order (from UI contract).
CREATE TABLE IF NOT EXISTS workspace.app_state.ref_disciplines (
  discipline STRING,
  ord        INT
) USING DELTA;

DELETE FROM workspace.app_state.ref_disciplines WHERE TRUE;

INSERT INTO workspace.app_state.ref_disciplines (discipline, ord) VALUES
('Cardiology',1),
('Nephrology',2),
('Oncology',3),
('Obstetrics',4),
('Pediatrics',5),
('Orthopedics',6),
('Trauma',7),
('Ophthalmology',8),
('General Medicine',9);
