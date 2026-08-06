-- V1.0.4__add_schedule_label.sql — optional label for schedules

ALTER TABLE schedules ADD COLUMN label TEXT;
