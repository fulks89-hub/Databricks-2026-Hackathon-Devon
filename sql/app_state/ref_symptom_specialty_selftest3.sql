-- Self-test 3: 6 sample symptom -> discipline rows spanning NFHS-derived and
-- base-seed sources (incl. Orthopedics & Ophthalmology seeds).
SELECT symptom, discipline, source_condition, source_indicator, confidence
FROM workspace.app_state.ref_symptom_specialty
WHERE symptom IN ('chest pain','blurred vision','joint pain','lump','swelling','head injury')
ORDER BY symptom, discipline
LIMIT 6
