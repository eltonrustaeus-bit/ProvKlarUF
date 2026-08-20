-- Rollback för 20260820_per_collective_stats.sql
-- Vyn är härledd — inget dataförlust vid drop.
drop view if exists public.concept_collective_stats;
