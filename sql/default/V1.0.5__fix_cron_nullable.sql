-- V1.0.5__fix_cron_nullable.sql — allow NULL cron for one-time schedules

ALTER TABLE schedules ALTER COLUMN cron DROP NOT NULL;
