-- Self-test: which of the 9 UI disciplines appear across all indicators, with
-- the count of indicators referencing each. Explodes ui_disciplines arrays.
SELECT d AS ui_discipline, COUNT(*) AS n_indicators
FROM workspace.app_state.nfhs_indicator_specialty
LATERAL VIEW explode(ui_disciplines) e AS d
GROUP BY d
ORDER BY n_indicators DESC, ui_discipline
