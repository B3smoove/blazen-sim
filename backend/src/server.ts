/**
 * server.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – Express application entry point.
 *
 * Responsibilities (Single Responsibility: HTTP server bootstrap):
 *  1. Load environment variables via dotenv.
 *  2. Instantiate and configure the Express application.
 *  3. Register global middleware (JSON body parsing, CORS, request logging).
 *  4. Mount all route controllers under versioned API prefixes.
 *  5. Attach a global error-handling middleware.
 *  6. Bind to the configured PORT and start listening.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { SimulationController } from './controllers/SimulationController';
import { rateLimiterMiddleware } from './middleware/RateLimiter';

// ── Application bootstrap ────────────────────────────────────────────────────

const app: Application = express();
const PORT: number = parseInt(process.env.PORT ?? '4000', 10);

// ── Global middleware ────────────────────────────────────────────────────────

/**
 * CORS configuration – restricts origins to the Vite dev server and the
 * deployed frontend hostname supplied via environment variable.
 */
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

/** Parse incoming JSON request bodies; cap payload at 1 MB to prevent abuse. */
app.use(express.json({ limit: '1mb' }));

/**
 * Minimal request logger – logs method, path, and timestamp to stdout.
 * In production, replace with a structured logger (e.g. winston, pino).
 */
app.use((req: Request, _res: Response, next: NextFunction): void => {
  console.info(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/**
 * Rate-limiter middleware – applied globally before routes to intercept
 * excessive call volumes and manage exponential back-off per user/service.
 */
app.use(rateLimiterMiddleware);

// ── Route mounting ───────────────────────────────────────────────────────────

/** SimulationController owns all /api/v1/simulation routes */
app.use('/api/v1/simulation', SimulationController);

/**
 * Health-check endpoint – used by load balancers and container orchestration
 * to verify the service is responsive.
 */
app.get('/health', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Global error handler ─────────────────────────────────────────────────────

/**
 * Catch-all error handler; must accept four parameters so Express recognises
 * it as an error-handling middleware (the `_next` param is required by design).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  console.error(`[ERROR] ${err.message}`, err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

// ── Server startup ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.info(`🔥 Blazen Sim backend listening on http://localhost:${PORT}`);
});

export default app;
