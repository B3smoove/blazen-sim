/**
 * DatabaseClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT IN USE – the database layer was removed from Blazen Sim.
 * This file is intentionally empty. It can be deleted safely.
 *
 * Responsibilities (Single Responsibility: data persistence and retrieval):
 *  - Manage a connection pool to the PostgreSQL database via the `pg` driver.
 *  - Expose typed query methods for each domain entity (users, configs, logs,
 *    rate limits).
 *  - Never contain any HTTP or business logic; return plain data objects only.
 *
 * Design Pattern: Repository / Data Access Object (DAO) – abstracts all SQL
 * behind named methods so callers are not coupled to the database schema.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export {};
