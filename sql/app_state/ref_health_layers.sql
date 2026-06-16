-- ref_health_layers: the 7 NFHS-5 health prevalence layers (key,label,ord) from UI contract.
CREATE TABLE IF NOT EXISTS workspace.app_state.ref_health_layers (
  layer_key STRING,
  label     STRING,
  ord       INT
) USING DELTA;

DELETE FROM workspace.app_state.ref_health_layers WHERE TRUE;

INSERT INTO workspace.app_state.ref_health_layers (layer_key, label, ord) VALUES
('ncd','Chronic / NCD',1),
('anaemia','Anaemia',2),
('malnutrition','Child malnutrition',3),
('womensnut','Women''s nutrition',4),
('acutechild','Acute child illness',5),
('cancerscreen','Cancer screening gaps',6),
('riskfactors','Risk factors',7);
