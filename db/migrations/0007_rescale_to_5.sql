-- 0007_rescale_to_5.sql
-- Re-scale maturity tiers from NIST CSF 2.0's 1-4 (Partial/Risk Informed/Repeatable/Adaptive)
-- to the 5-level CMM scheme (Initial/Repeatable/Defined/Managed/Optimizing) used by the
-- Collision Leaders attainment worksheet and most of the larger industry frameworks.
--
-- Effects:
--   - current_scores.pol/pra/gol now accept 1..5 instead of 1..4.
--   - prio stays 1..4 (priority levels Low/Medium/High/Critical, unchanged).
--   - The framework_versions.definition.scoring.tiers list is rewritten to the 5-level set.

alter table current_scores drop constraint if exists current_scores_pol_check;
alter table current_scores add  constraint current_scores_pol_check  check (pol  between 1 and 5);

alter table current_scores drop constraint if exists current_scores_pra_check;
alter table current_scores add  constraint current_scores_pra_check  check (pra  between 1 and 5);

alter table current_scores drop constraint if exists current_scores_gol_check;
alter table current_scores add  constraint current_scores_gol_check  check (gol  between 1 and 5);

-- Update framework definition for NIST CSF 2.0 (active version)
update framework_versions
   set definition = jsonb_set(
         definition,
         '{scoring,tiers}',
         '[
            { "value": 1, "label": "Initial" },
            { "value": 2, "label": "Repeatable" },
            { "value": 3, "label": "Defined" },
            { "value": 4, "label": "Managed" },
            { "value": 5, "label": "Optimizing" }
          ]'::jsonb
       )
 where framework_id = (select id from frameworks where slug = 'nist-csf-2.0')
   and is_current;
