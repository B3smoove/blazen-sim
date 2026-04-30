-- =============================================================================
-- Blazen Sim Database Schema
-- DDL for users, simulation_configs, execution_logs, and api_rate_limits tables
-- Follows normalized relational design; all timestamps stored in UTC.
-- =============================================================================

-- Enable the pgcrypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- TABLE: users
-- Stores registered application users and their hashed credentials.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(64)   NOT NULL UNIQUE,
    email         VARCHAR(255)  NOT NULL UNIQUE,
    password_hash TEXT          NOT NULL,          -- bcrypt hash, never plaintext
    role          VARCHAR(32)   NOT NULL DEFAULT 'analyst', -- 'admin' | 'analyst'
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index: fast look-up by email during authentication
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- -----------------------------------------------------------------------------
-- TABLE: simulation_configs
-- Persists the extracted parameter sets that are forwarded to the DEVS-FIRE API.
-- Each row represents one named configuration scoped to a user.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS simulation_configs (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name             VARCHAR(128)  NOT NULL,
    raw_prompt       TEXT          NOT NULL,   -- original natural-language prompt from user
    extracted_params JSONB         NOT NULL,   -- Claude-extracted parameter JSON object
    devs_fire_model  VARCHAR(128),             -- optional: model name forwarded to DEVS-FIRE
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index: look up all configs belonging to a user (common query pattern)
CREATE INDEX IF NOT EXISTS idx_simulation_configs_user_id ON simulation_configs (user_id);

-- Index: GIN index on JSONB params for fast parameter-level queries
CREATE INDEX IF NOT EXISTS idx_simulation_configs_params ON simulation_configs USING GIN (extracted_params);

-- -----------------------------------------------------------------------------
-- TABLE: execution_logs
-- Append-only audit trail recording every simulation run, its status, and output.
-- Never update or delete rows; insert-only for data integrity.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS execution_logs (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id       UUID          NOT NULL REFERENCES simulation_configs (id) ON DELETE SET NULL,
    user_id         UUID          NOT NULL REFERENCES users (id) ON DELETE SET NULL,
    status          VARCHAR(32)   NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
    request_payload JSONB,        -- payload sent to DEVS-FIRE API
    response_body   JSONB,        -- raw response received from DEVS-FIRE API
    error_message   TEXT,         -- populated when status = 'failed'
    duration_ms     INTEGER,      -- wall-clock time for the simulation run in milliseconds
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index: query logs by configuration to reconstruct run history
CREATE INDEX IF NOT EXISTS idx_execution_logs_config_id ON execution_logs (config_id);

-- Index: query logs by user for dashboard views
CREATE INDEX IF NOT EXISTS idx_execution_logs_user_id ON execution_logs (user_id);

-- Index: filter by status for monitoring dashboards
CREATE INDEX IF NOT EXISTS idx_execution_logs_status ON execution_logs (status);

-- -----------------------------------------------------------------------------
-- TABLE: api_rate_limits
-- Tracks per-user, per-service call counts to support the RateLimiter middleware.
-- The middleware reads and updates these rows to enforce exponential back-off.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_rate_limits (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    service       VARCHAR(64)   NOT NULL,  -- 'devs_fire' | 'claude'
    window_start  TIMESTAMPTZ   NOT NULL DEFAULT NOW(), -- start of the current rate window
    call_count    INTEGER       NOT NULL DEFAULT 0,
    last_call_at  TIMESTAMPTZ,
    backoff_until TIMESTAMPTZ,             -- if set, requests are blocked until this timestamp
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- Composite unique: one row per (user, service) combination
    CONSTRAINT uq_rate_limits_user_service UNIQUE (user_id, service)
);

-- Index: look up rate-limit state for a specific user + service pair
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_user_service ON api_rate_limits (user_id, service);

-- =============================================================================
-- TRIGGER: keep updated_at columns current automatically
-- =============================================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Attach the trigger to tables that carry an updated_at column
CREATE TRIGGER set_updated_at_users
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_simulation_configs
    BEFORE UPDATE ON simulation_configs
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_api_rate_limits
    BEFORE UPDATE ON api_rate_limits
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
