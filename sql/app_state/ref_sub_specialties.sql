-- ref_sub_specialties: sub-specialties per discipline (SUBS, from UI contract).
CREATE TABLE IF NOT EXISTS workspace.app_state.ref_sub_specialties (
  discipline    STRING,
  sub_specialty STRING,
  ord           INT
) USING DELTA;

DELETE FROM workspace.app_state.ref_sub_specialties WHERE TRUE;

INSERT INTO workspace.app_state.ref_sub_specialties (discipline, sub_specialty, ord) VALUES
('Cardiology','Heart failure',1),
('Cardiology','Interventional',2),
('Cardiology','Electrophysiology',3),
('Cardiology','Non-invasive / Echo',4),
('Nephrology','Dialysis / CKD',1),
('Nephrology','Transplant',2),
('Oncology','Medical oncology',1),
('Oncology','Radiation oncology',2),
('Oncology','Surgical oncology',3),
('Obstetrics','High-risk pregnancy',1),
('Obstetrics','General obstetrics',2),
('Pediatrics','Neonatology',1),
('Pediatrics','General paediatrics',2),
('Orthopedics','Trauma & implants',1),
('Orthopedics','Joint replacement',2),
('Orthopedics','Spine',3),
('Trauma','Emergency / casualty',1),
('Ophthalmology','Cataract & retina',1),
('Ophthalmology','Glaucoma',2),
('General Medicine','Internal medicine',1);
