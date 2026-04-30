/**
 * SimulationController.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – HTTP Controller for simulation-related routes.
 *
 * Responsibilities (Single Responsibility: HTTP orchestration only):
 *  - Validate and parse incoming HTTP requests.
 *  - Delegate business logic to the appropriate Service layer.
 *  - Serialise Service results into HTTP responses.
 *  - Never contain direct database queries or external API calls.
 *
 * Routes exposed:
 *  POST /api/v1/simulation/run – Extract params via Claude then execute DEVS-FIRE.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ClaudeAgentService } from '../services/ClaudeAgentService';
import type { AgentExtractionResult } from '../services/ClaudeAgentService';
import { DevsFireClient } from '../services/DevsFireClient';

// ── Router instance ──────────────────────────────────────────────────────────

/**
 * SimulationController is exported as an Express Router rather than a class.
 * This adheres to the Express convention of modular sub-routers while keeping
 * route handler logic co-located for readability.
 */
export const SimulationController: Router = Router();

// ── Service instantiation ─────────────────────────────────────────────────────

/**
 * Services are instantiated once at module load time (module-level singletons).
 * In a dependency-injection framework (e.g. InversifyJS) these would be injected,
 * but for this project constructor-based singletons are sufficient.
 */
const claudeService = new ClaudeAgentService();
const devsFireClient = new DevsFireClient();

// ── Route: POST /run ──────────────────────────────────────────────────────────

/**
 * runSimulation
 * Accepts a natural-language prompt, delegates parameter extraction to
 * ClaudeAgentService, then passes the extracted JSON to DevsFireClient
 * to execute the simulation. Returns the result directly – no persistence.
 *
 * Request body:
 *  {
 *    prompt: string;  // Free-form natural-language simulation description
 *  }
 */
SimulationController.post(
  '/run',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { prompt, simulationContext } = req.body as { prompt: string; simulationContext?: string };

      // ── Input validation ─────────────────────────────────────────────────
      if (!prompt) {
        res.status(400).json({ error: 'prompt is required.' });
        return;
      }

      // ── Step 1: Extract structured parameters via Claude ─────────────────
      const agentResult: AgentExtractionResult =
        await claudeService.extractSimulationParams(prompt, simulationContext);

      // ── Step 2: Short-circuit if Claude needs more information ────────────
      if (!agentResult.isReady || !agentResult.parameters) {
        res.status(200).json({
          success: true,
          isReady: false,
          chatReply: agentResult.chatReply,
        });
        return;
      }

      // ── Step 3: Forward parameters to DEVS-FIRE and execute ──────────────
      const startTime = Date.now();
      const simulationResult = await devsFireClient.runFullSimulation(
        agentResult.parameters
      );
      const durationMs = Date.now() - startTime;

      // ── Step 4: Compute fire statistics for the safety analysis ───────────
      const CELL_AREA_HA = 0.09; // 30 m × 30 m = 900 m² = 0.09 ha
      const cellsBurned     = simulationResult.thermalGrid?.length ?? 0;
      const areaHa          = cellsBurned * CELL_AREA_HA;
      const perimeterCells  = simulationResult.perimeterCellIds?.length ?? 0;
      const stepInterval    = agentResult.parameters.stepInterval ?? 360;
      const totalSteps      = agentResult.parameters.totalSteps   ?? 10;
      const totalSimTimeSec = stepInterval * totalSteps;
      const spreadRateHaHr  = totalSimTimeSec > 0
        ? areaHa / (totalSimTimeSec / 3600)
        : 0;

      // ── Step 5: Generate danger-level + safety briefing via Claude ─────────
      const safetyBriefing = await claudeService.generateFireAnalysis(
        agentResult.parameters,
        { cellsBurned, areaHa, perimeterCells, totalSimTimeSec, spreadRateHaHr }
      );

      // ── Step 6: Return the result to the client ───────────────────────────
      res.status(200).json({
        success: true,
        isReady: true,
        chatReply: safetyBriefing,
        extractedParams: agentResult.parameters,
        simulationResult,
        durationMs,
      });
    } catch (err) {
      next(err);
    }
  }
);
