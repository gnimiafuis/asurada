-- V1.0.6__add_schedule_timezone.sql — timezone for clock-time cron schedules

ALTER TABLE schedules ADD COLUMN timezone TEXT;
