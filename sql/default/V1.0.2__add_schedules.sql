-- V1.0.2__add_schedules.sql — scheduled agent runs

CREATE TABLE schedules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id   UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    cron        TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    last_run    TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedules_thread_id ON schedules (thread_id);
CREATE INDEX idx_schedules_enabled ON schedules (enabled) WHERE enabled = true;
