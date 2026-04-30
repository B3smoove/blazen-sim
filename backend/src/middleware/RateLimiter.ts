/**
 * RateLimiter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – Express middleware for API rate limiting and exponential back-off.
 *
 * Responsibilities (Single Responsibility: traffic throttling):
 *  - Intercept every incoming request before it reaches a route handler.
 *  - Track per-IP call counts and back-off windows using an in-memory Map.
 *  - Reject with HTTP 429 if a caller exceeds the allowed call rate.
 *  - Expose applyUpstream429Backoff() for service-layer code to call when
 *    DEVS-FIRE or Claude themselves return a 429 upstream.
 *
 * Exponential back-off formula:
 *   backoff_seconds = BASE_BACKOFF_S * (2 ^ consecutiveOverages)
 *   capped at MAX_BACKOFF_S to prevent indefinitely long blocks.
 *
 * Design Pattern: Middleware (Chain of Responsibility).
 * Storage: in-process Map – no database required.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Request, Response, NextFunction } from 'express';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum allowed API calls per key per rolling window */
const MAX_CALLS_PER_WINDOW = parseInt(process.env.RATE_LIMIT_MAX_CALLS ?? '100', 10);

/** Rolling window duration in milliseconds (default: 1 hour) */
const WINDOW_DURATION_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '3600000', 10);

/** Base back-off period in seconds (doubles on each consecutive overage) */
const BASE_BACKOFF_S = parseInt(process.env.RATE_LIMIT_BASE_BACKOFF_S ?? '5', 10);

/** Maximum back-off cap in seconds */
const MAX_BACKOFF_S = parseInt(process.env.RATE_LIMIT_MAX_BACKOFF_S ?? '300', 10);

// ── In-memory store ───────────────────────────────────────────────────────────

/** Shape of a single rate-limit record stored in memory */
interface RateLimitEntry {
  callCount: number;
  windowStart: number;      // Unix ms
  backoffUntil: number | null; // Unix ms, or null when not in back-off
  overageCount: number;     // consecutive window over-limit events
}

/**
 * rateLimitStore
 * Key: `${ip}` or `${ip}:${service}` – Value: RateLimitEntry.
 * Entries are pruned lazily when a window expires.
 */
const rateLimitStore = new Map<string, RateLimitEntry>();

// ── Middleware function ───────────────────────────────────────────────────────

/**
 * rateLimiterMiddleware
 * Express middleware that enforces per-IP rate limits using in-memory state.
 * If no caller key can be derived the request is passed through.
 */
export function rateLimiterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Use the client IP as the rate-limit key (falls back to 'unknown')
  const ip = (req.ip ?? req.socket.remoteAddress ?? 'unknown').replace('::ffff:', '');
  const key = ip;

  const now = Date.now();
  let entry = rateLimitStore.get(key);

  // ── Initialise missing entry ─────────────────────────────────────────────
  if (!entry) {
    entry = { callCount: 0, windowStart: now, backoffUntil: null, overageCount: 0 };
    rateLimitStore.set(key, entry);
  }

  // ── Back-off check ────────────────────────────────────────────────────────
  if (entry.backoffUntil !== null && now < entry.backoffUntil) {
    const retryAfterMs = entry.backoffUntil - now;
    res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000).toString());
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit back-off active. Retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      retryAfterMs,
    });
    return;
  }

  // ── Window reset check ────────────────────────────────────────────────────
  if (now - entry.windowStart > WINDOW_DURATION_MS) {
    entry.callCount = 0;
    entry.windowStart = now;
    entry.backoffUntil = null;
  }

  // ── Call count check ──────────────────────────────────────────────────────
  if (entry.callCount >= MAX_CALLS_PER_WINDOW) {
    entry.overageCount += 1;
    const backoffSeconds = Math.min(
      BASE_BACKOFF_S * Math.pow(2, entry.overageCount - 1),
      MAX_BACKOFF_S
    );
    entry.backoffUntil = now + backoffSeconds * 1000;

    res.setHeader('Retry-After', backoffSeconds.toString());
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Call limit of ${MAX_CALLS_PER_WINDOW} exceeded. Back-off applied for ${backoffSeconds}s.`,
      retryAfterSeconds: backoffSeconds,
    });
    return;
  }

  // ── Increment and proceed ─────────────────────────────────────────────────
  entry.callCount += 1;
  next();
}

// ── Exported helper: apply back-off after upstream 429 ───────────────────────

/**
 * applyUpstream429Backoff
 * Called by service-layer code when DEVS-FIRE or Claude return a 429.
 * Schedules an exponential back-off for the given IP key.
 *
 * @param ip – Caller IP address to apply back-off for.
 */
export function applyUpstream429Backoff(ip: string): void {
  const key = ip;
  const now = Date.now();
  const entry = rateLimitStore.get(key) ?? {
    callCount: 0, windowStart: now, backoffUntil: null, overageCount: 0,
  };

  entry.overageCount = Math.max(1, entry.overageCount + 1);
  const backoffSeconds = Math.min(
    BASE_BACKOFF_S * Math.pow(2, entry.overageCount - 1),
    MAX_BACKOFF_S
  );
  entry.backoffUntil = now + backoffSeconds * 1000;
  rateLimitStore.set(key, entry);

  console.warn(
    `[RateLimiter] Upstream 429 for IP ${ip}. Back-off applied: ${backoffSeconds}s.`
  );
}
