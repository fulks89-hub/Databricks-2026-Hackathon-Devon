-- ref_specialty_discipline: maps real camelCase specialty tokens -> 9 UI disciplines.
-- Source: workspace.virtue_foundation_clean_v2.facilities.specialties (JSON-array-string).
-- Tokens with no sensible fit (dentistry/dermatology/ENT/psychiatry/radiology/pathology/
-- rehab/derm-cosmetic/podiatry/psychology/lab/public-health/anesthesia) are intentionally
-- omitted so they map to NULL (no discipline) rather than a wrong bucket.

CREATE TABLE IF NOT EXISTS workspace.app_state.ref_specialty_discipline (
  raw_specialty STRING,
  discipline    STRING
) USING DELTA;

-- Idempotent: clear and repopulate so reruns stay clean.
DELETE FROM workspace.app_state.ref_specialty_discipline WHERE TRUE;

INSERT INTO workspace.app_state.ref_specialty_discipline (raw_specialty, discipline) VALUES
-- ===== General Medicine =====
('internalMedicine','General Medicine'),
('familyMedicine','General Medicine'),
('generalMedicine','General Medicine'),
('preventiveMedicine','General Medicine'),
('geriatricsInternalMedicine','General Medicine'),
('chronicDiseasePreventionAndLifestyleMedicine','General Medicine'),
('hospiceAndPalliativeInternalMedicine','General Medicine'),
('infectiousDiseases','General Medicine'),
('pediatricInfectiousDiseases','Pediatrics'),
('endocrinologyAndDiabetesAndMetabolism','General Medicine'),
('endocrinology','General Medicine'),
('diabetology','General Medicine'),
('rheumatology','General Medicine'),
('gastroenterology','General Medicine'),
('surgicalGastroenterology','General Medicine'),
('hepatology','General Medicine'),
('pulmonology','General Medicine'),
('pulmonaryMedicine','General Medicine'),
('allergyAndImmunology','General Medicine'),
('sleepMedicine','General Medicine'),
('sportsInternalMedicine','General Medicine'),
('adolescentMedicine','General Medicine'),
('publicHealth','General Medicine'),

-- ===== Cardiology =====
('cardiology','Cardiology'),
('interventionalCardiology','Cardiology'),
('pediatricCardiology','Cardiology'),
('cardiacSurgery','Cardiology'),
('cardiothoracicSurgery','Cardiology'),

-- ===== Nephrology =====
('nephrology','Nephrology'),
('pediatricNephrology','Nephrology'),
('renalTransplantationUrology','Nephrology'),
('urology','Nephrology'),
('pediatricUrology','Nephrology'),
('urologicOncology','Nephrology'),
('andrologyAndMaleFertility','Nephrology'),
('andrology','Nephrology'),
('minimallyInvasiveSurgeryAndEndourology','Nephrology'),
('genitourinaryReconstructiveSurgery','Nephrology'),

-- ===== Oncology =====
('medicalOncology','Oncology'),
('surgicalOncology','Oncology'),
('radiationOncology','Oncology'),
('oncology','Oncology'),
('gynecologicalOncology','Oncology'),
('gynecologicOncology','Oncology'),
('pediatricHematologyOncology','Oncology'),
('orthopedicOncology','Oncology'),
('neuroOncology','Oncology'),
('ocularOncology','Oncology'),
('hematology','Oncology'),
('haematology','Oncology'),
('boneMarrowTransplant','Oncology'),
('breastSurgery','Oncology'),
('breastImaging','Oncology'),

-- ===== Obstetrics =====
('gynecologyAndObstetrics','Obstetrics'),
('obstetricsAndGynecology','Obstetrics'),
('obstetricsAndGynaecology','Obstetrics'),
('obstetricsAndMaternityCare','Obstetrics'),
('gynecology','Obstetrics'),
('gynecologicalSurgery','Obstetrics'),
('reproductiveEndocrinologyAndInfertility','Obstetrics'),
('maternalFetalMedicineOrPerinatology','Obstetrics'),
('maternalAndChildHealth','Obstetrics'),
('familyPlanningAndComplexContraception','Obstetrics'),
('menopauseAndMidlifeHealth','Obstetrics'),
('urogynecologyAndReconstructivePelvisSurgery','Obstetrics'),

-- ===== Pediatrics =====
('pediatrics','Pediatrics'),
('neonatologyPerinatalMedicine','Pediatrics'),
('pediatricSurgery','Pediatrics'),
('paediatricSurgery','Pediatrics'),
('pediatricCriticalCareMedicine','Pediatrics'),
('pediatricEmergencyMedicine','Pediatrics'),
('pediatricEndocrinology','Pediatrics'),
('pediatricGastroenterology','Pediatrics'),
('pediatricPulmonology','Pediatrics'),
('pediatricNeurology','Pediatrics'),
('childNeurology','Pediatrics'),
('pediatricNeurosurgery','Pediatrics'),
('pediatricNeurodevelopmentalDisabilities','Pediatrics'),
-- NOTE: stored with U+2013 EN-DASH; inserted at runtime via decode(unhex('E28093'),'UTF-8')
-- to avoid shell encoding corruption: concat('developmental', <en-dash>, 'behavioralPediatrics')
('developmental–behavioralPediatrics','Pediatrics'),
('pediatricAllergyAndImmunology','Pediatrics'),
('pediatricRehabilitationMedicine','Pediatrics'),
('pediatricOrthopedicSurgery','Pediatrics'),
('pediatricOtolaryngology','Pediatrics'),
('pediatricOphthalmology','Pediatrics'),
('pediatricDermatology','Pediatrics'),
('pediatricRadiology','Pediatrics'),
('pediatricsAndStrabismusOphthalmology','Pediatrics'),

-- ===== Orthopedics =====
('orthopedicSurgery','Orthopedics'),
('orthopedics','Orthopedics'),
('orthopaedics','Orthopedics'),
('jointReconstructionSurgery','Orthopedics'),
('jointReplacementSurgery','Orthopedics'),
('orthopedicSpineSurgery','Orthopedics'),
('spineNeurosurgery','Orthopedics'),
('shoulderAndElbowOrthopedicSurgery','Orthopedics'),
('footAndAnkleOrthopedicSurgery','Orthopedics'),
('orthopedicSportsMedicine','Orthopedics'),
('handOrUpperExtremityAndPeripheralNerveSurgery','Orthopedics'),
('handAndUpperExtremitiesSurgery','Orthopedics'),
('physicalMedicineAndRehabilitation','Orthopedics'),
('sportsMedicinePMR','Orthopedics'),
('spinalCordInjuryMedicine','Orthopedics'),

-- ===== Trauma =====
('emergencyMedicine','Trauma'),
('criticalCareMedicine','Trauma'),
('generalSurgery','Trauma'),
('traumaSurgery','Trauma'),
('vascularSurgery','Trauma'),
('eyeTraumaAndEmergencyEyeCare','Trauma'),
('burnAndTraumaPlasticSurgery','Trauma'),

-- ===== Ophthalmology =====
('ophthalmology','Ophthalmology'),
('cataractAndAnteriorSegmentSurgery','Ophthalmology'),
('retinaAndVitreoretinalOphthalmology','Ophthalmology'),
('corneaOphthalmology','Ophthalmology'),
('glaucomaOphthalmology','Ophthalmology'),
('refractiveSurgeryOphthalmology','Ophthalmology'),
('oculoplasticsAndReconstructiveOrbitalSurgery','Ophthalmology'),
('neuroOphthalmology','Ophthalmology'),
('uveitisOphthalmology','Ophthalmology'),
('optometry','Ophthalmology');
