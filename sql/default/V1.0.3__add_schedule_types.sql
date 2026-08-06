-- V1.0.3__add_schedule_types.sql — support one-time (non-recurring) schedules

ALTER TABLE schedules ADD COLUMN type TEXT NOT NULL DEFAULT 'recurring';
ALTER TABLE schedules ADD COLUMN run_at TIMESTAMPTZ;
