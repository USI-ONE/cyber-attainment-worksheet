-- 0008_decimals_and_editable_snapshots.sql
-- Allow decimal maturity scores (e.g., 0.5, 1.5, 2.5) for both current_scores and snapshot_scores.
-- Snapshots remain "snapshots" but their scores become editable through the UI; trend integrity is
-- preserved by the user's discipline (don't edit shipped board reports, take new snapshots instead),
-- not by an immutability lock.

-- Drop existing 1..5 integer check constraints on current_scores
alter table current_scores drop constraint if exists current_scores_pol_check;
alter table current_scores drop constraint if exists current_scores_pra_check;
alter table current_scores drop constraint if exists current_scores_gol_check;

-- Change column types to numeric(3,1) (max 99.9; plenty for 0.0..5.0)
alter table current_scores alter column pol type numeric(3,1) using pol::numeric(3,1);
alter table current_scores alter column pra type numeric(3,1) using pra::numeric(3,1);
alter table current_scores alter column gol type numeric(3,1) using gol::numeric(3,1);

-- Add range constraints (0..5 inclusive; 0 = "does not exist", aligned with the user's CMM gloss)
alter table current_scores add constraint current_scores_pol_check check (pol is null or (pol >= 0 and pol <= 5));
alter table current_scores add constraint current_scores_pra_check check (pra is null or (pra >= 0 and pra <= 5));
alter table current_scores add constraint current_scores_gol_check check (gol is null or (gol >= 0 and gol <= 5));

-- Same treatment for snapshot_scores (no existing constraints to drop, just type-change + add)
alter table snapshot_scores alter column pol type numeric(3,1) using pol::numeric(3,1);
alter table snapshot_scores alter column pra type numeric(3,1) using pra::numeric(3,1);
alter table snapshot_scores alter column gol type numeric(3,1) using gol::numeric(3,1);
alter table snapshot_scores add constraint snapshot_scores_pol_check check (pol is null or (pol >= 0 and pol <= 5));
alter table snapshot_scores add constraint snapshot_scores_pra_check check (pra is null or (pra >= 0 and pra <= 5));
alter table snapshot_scores add constraint snapshot_scores_gol_check check (gol is null or (gol >= 0 and gol <= 5));
