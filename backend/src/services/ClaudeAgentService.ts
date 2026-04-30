/**
 * ClaudeAgentService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – Anthropic Claude API integration service.
 *
 * Responsibilities (Single Responsibility: LLM-based parameter extraction):
 *  - Construct a structured system prompt that instructs Claude to act as a
 *    DEVS-FIRE parameter extractor.
 *  - Send the user's natural-language prompt to the Claude API.
 *  - Parse and validate the JSON returned by Claude.
 *  - Surface extraction errors with meaningful messages to the controller.
 *
 * Design Pattern: Service Layer – isolates all Anthropic SDK interactions
 * behind a clean public interface so swapping models is a one-file change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic from '@anthropic-ai/sdk';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Core simulation parameters extracted from the user's natural language prompt.
 * Field names and units match the DEVS-FIRE ignition plan spec exactly.
 */
export interface SimulationParams {
  /** Ignition latitude (WGS-84 decimal degrees) */
  lat?: number;
  /** Ignition longitude (WGS-84 decimal degrees) */
  lng?: number;
  /** Wind speed in miles per hour */
  windSpeed?: number;
  /** Wind direction in degrees (0=South, 90=West, 180=North, 270=East) */
  windDirection?: number;
  /** Timesteps per animation step */
  stepInterval?: number;
  /** Total number of animation steps to run */
  totalSteps?: number;
}

/**
 * Full response envelope returned by ClaudeAgentService.
 * When isReady is false the controller returns chatReply to the user without
 * running the simulation. When true, parameters is always populated.
 */
export interface AgentExtractionResult {
  /** True when all required parameters have been collected */
  isReady: boolean;
  /** Extracted simulation parameters – present only when isReady is true */
  parameters?: SimulationParams;
  /** Conversational reply shown directly in the chat UI */
  chatReply: string;
}

// ── Service class ─────────────────────────────────────────────────────────────

export class ClaudeAgentService {
  /** Anthropic SDK client instance – initialised once per service lifetime */
  private readonly client: Anthropic;

  /** Model identifier – configurable via environment variable for easy upgrades */
  private readonly model: string;

  /**
   * System prompt used for the post-simulation safety analysis call.
   * Instructs Claude to act as a wildland fire safety analyst and output
   * a structured danger-level briefing based on the simulation statistics.
   */
  private readonly analysisSystemPrompt: string = `You are a certified wildland fire safety analyst briefing emergency personnel after a DEVS-FIRE spread simulation.

Given the simulation input parameters and computed fire statistics, produce a structured safety briefing using EXACTLY this format (plain text, no JSON, no extra headings):

🔥 DANGER LEVEL: [LOW | MODERATE | HIGH | EXTREME]

📊 Fire Behavior Summary:
[2–3 sentences describing how the fire behaved based on wind and spread data]

⚠️ Safety Recommendations:
• [Specific, actionable recommendation tied to these conditions]
• [Specific, actionable recommendation]
• [Specific, actionable recommendation]
• [Specific, actionable recommendation]

Danger level guidelines:
- Spread rate < 1 ha/hr AND wind ≤ 10 mph  → LOW
- Spread rate 1–5 ha/hr  OR  wind 10–20 mph → MODERATE
- Spread rate 5–15 ha/hr OR  wind 20–30 mph → HIGH
- Spread rate > 15 ha/hr OR  wind > 30 mph  → EXTREME

Tailor every recommendation to the specific wind direction, speed, and burn size. Be concise — emergency personnel need fast, actionable information.`;

  /**
   * System prompt that instructs Claude to behave as a structured data extractor.
   * The JSON schema embedded here guides Claude's output format so downstream
   * code can rely on a predictable structure.
   */
  private readonly systemPrompt: string = `You are the Agentic AI core for 'Blazen Sim,' a conversational interface for the DEVS-FIRE wildland fire simulation API.

Your primary goal is to parse the user's natural language request, extract the required simulation parameters, and output a strict JSON object that the backend middleware will use to execute the simulation.

The Parameters You Must Extract:
- Ignition Point: lat (number) and lng (number) — real-world geographic coordinates.
- Wind Conditions: windSpeed (in mph) and windDirection (in degrees, where 0 is South, 90 is West, 180 is North, 270 is East).
- Time/Steps: stepInterval (timesteps per step) and totalSteps (number of steps).

Your Workflow:
Step 1 (Clarify): If the user's prompt is missing critical information (e.g., they mention wind but forget to say where the fire starts), respond with a conversational follow-up question. Set "isReady": false.
Step 2 (Execute): Once you have enough parameters, output the JSON object below.

Strict JSON Output Format — return ONLY raw JSON, no markdown, no prose:
{
  "isReady": true,
  "parameters": {
    "lat": 37.24318,
    "lng": -99.03919,
    "windSpeed": 8,
    "windDirection": 90,
    "stepInterval": 1500,
    "totalSteps": 8
  },
  "chatReply": "Setting up the simulation at lat 37.24, lng -99.03 with an 8mph Eastern wind. I will run this in 8 steps..."
}

When isReady is false:
{
  "isReady": false,
  "chatReply": "<your follow-up question here>"
}

Never return null values. Omit optional keys rather than nulling them. Make reasonable scientific assumptions for ambiguous values.`;

  constructor() {
    // Retrieve the API key from the environment; fail fast if absent
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is not set. Claude service cannot initialise.'
      );
    }

    this.client = new Anthropic({ apiKey });
    this.model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5';
  }

  // ── Public interface ────────────────────────────────────────────────────────

  /**
   * generateFireAnalysis
   * ─────────────────────────────────────────────────────────────────────────
   * Sends simulation parameters and computed fire statistics to Claude and
   * returns a formatted danger-level + safety-recommendations briefing that
   * is shown directly in the chat UI after the simulation completes.
   *
   * @param params – The Claude-extracted simulation parameters.
   * @param stats  – Fire statistics computed from the DEVS-FIRE result.
   * @returns        Formatted safety briefing string (plain text).
   */
  async generateFireAnalysis(
    params: SimulationParams,
    stats: {
      cellsBurned: number;
      areaHa: number;
      perimeterCells: number;
      totalSimTimeSec: number;
      spreadRateHaHr: number;
    }
  ): Promise<string> {
    const windDirLabel = (deg?: number): string => {
      if (deg == null) return 'unknown';
      if (deg >= 315 || deg < 45)  return 'southerly';
      if (deg >= 45  && deg < 135) return 'westerly';
      if (deg >= 135 && deg < 225) return 'northerly';
      return 'easterly';
    };

    const userMessage = [
      'DEVS-FIRE simulation completed. Please provide a safety briefing.',
      '',
      'Input Parameters:',
      `  Location       : ${params.lat ?? '—'}°, ${params.lng ?? '—'}°`,
      `  Wind Speed     : ${params.windSpeed ?? '—'} mph`,
      `  Wind Direction : ${params.windDirection ?? '—'}° (${windDirLabel(params.windDirection)})`,
      `  Sim Duration   : ${stats.totalSimTimeSec}s`,
      '',
      'Computed Fire Statistics:',
      `  Cells Burned   : ${stats.cellsBurned}`,
      `  Area Burned    : ${stats.areaHa.toFixed(2)} ha`,
      `  Perimeter Cells: ${stats.perimeterCells}`,
      `  Spread Rate    : ${stats.spreadRateHaHr.toFixed(2)} ha/hr`,
    ].join('\n');

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 600,
      system: this.analysisSystemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = response.content[0];
    return block?.type === 'text' ? block.text.trim() : 'Safety analysis unavailable.';
  }

  /**
   * extractSimulationParams
   * ─────────────────────────────────────────────────────────────────────────
   * Sends the user's natural-language prompt to Claude and parses the
   * resulting JSON into a typed SimulationParams object.
   *
   * @param userPrompt       – Free-form text describing the desired simulation scenario.
   * @param simulationContext – Optional compact history of past runs for comparison queries.
   * @returns                  A validated SimulationParams object ready for DEVS-FIRE.
   * @throws                   Error if Claude returns malformed JSON or the API call fails.
   */
  async extractSimulationParams(
    userPrompt: string,
    simulationContext?: string
  ): Promise<AgentExtractionResult> {
    // Validate that the prompt is non-empty before issuing an API call
    if (!userPrompt || userPrompt.trim().length === 0) {
      throw new Error('User prompt must not be empty for parameter extraction.');
    }

    // Append run history to the system prompt when available so Claude can
    // answer comparison / analysis questions without launching a new simulation.
    const effectiveSystemPrompt = simulationContext
      ? [
          this.systemPrompt,
          '',
          '---',
          simulationContext,
          '---',
          'When the user asks a question that compares, analyses, or refers to the past runs',
          'listed above (e.g. "which run burned more?", "compare wind conditions"), answer',
          'directly using the history data. Set "isReady": false and put your full answer in',
          '"chatReply". Do NOT attempt to run a new simulation for comparison-only questions.',
        ].join('\n')
      : this.systemPrompt;

    // ── Issue the Claude API request ──────────────────────────────────────
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: effectiveSystemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt.trim(),
        },
      ],
    });

    // ── Extract the text content block from Claude's response ───────────────
    const rawContent = response.content[0];

    if (!rawContent || rawContent.type !== 'text') {
      throw new Error('Claude returned an unexpected response format (no text block).');
    }

    const rawText = rawContent.text.trim();

    // ── Parse and return the JSON payload ────────────────────────────────────
    const result = this.parseJsonSafely(rawText);
    return result;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * parseJsonSafely
   * Attempts to parse a string as JSON. Strips common Claude artefacts such as
   * accidental markdown code-fences before parsing.
   *
   * @param raw – The raw string returned by Claude.
   * @returns    Parsed SimulationParams object.
   * @throws     Error with the raw string included for debugging.
   */
  private parseJsonSafely(raw: string): AgentExtractionResult {
    // Strip markdown code fences if Claude wrapped the JSON despite instructions
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    if (!cleaned) {
      throw new Error('ClaudeAgentService: Claude returned an empty response.');
    }

    try {
      return JSON.parse(cleaned) as AgentExtractionResult;
    } catch {
      throw new Error(
        `ClaudeAgentService: Failed to parse extraction response as JSON.\nRaw response: ${raw}`
      );
    }
  }
}
