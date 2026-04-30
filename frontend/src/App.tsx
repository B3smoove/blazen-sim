/**
 * App.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – Root application component.
 *
 * Responsibilities:
 *  - Manage top-level authentication state (authenticated user session).
 *  - Conditionally render the AuthGateway (unauthenticated) or the
 *    main application shell (authenticated).
 *  - Compose the three primary UI regions: header, ChatInterface, and
 *    VisualizationPanel in a responsive two-column layout.
 *
 * State managed here (lifted to avoid prop-drilling):
 *  - currentUser: the authenticated user's minimal profile
 *  - simulationResult: the last simulation result forwarded to VisualizationPanel
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useCallback } from 'react';
import { AuthGateway } from './components/AuthGateway';
import { ChatInterface } from './components/ChatInterface';
import { VisualizationPanel } from './components/VisualizationPanel';
import { SimInfoSidebar } from './components/SimInfoSidebar';
import { FireStatsPanel } from './components/FireStatsPanel';
import type { SimulationRunResult } from './components/ChatInterface';
import type { HistoryEntry } from './components/SimInfoSidebar';
import './App.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

const CELL_AREA_HA = 0.09; // 30 m × 30 m cell

/**
 * Builds a compact, Claude-readable summary of all past simulation runs.
 * Injected into every prompt so Claude can answer comparison questions.
 */
function buildSimulationContext(history: HistoryEntry[]): string | undefined {
  if (history.length === 0) return undefined;

  const dirs = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];

  const lines = [...history].reverse().map((entry, idx) => {
    const runNum = idx + 1;
    const p = entry.result.extractedParams;
    const grid = entry.result.simulationResult.thermalGrid ?? [];
    const cellsBurned = grid.length;
    const areaHa = (cellsBurned * CELL_AREA_HA).toFixed(1);
    const stepInterval = Number(p.stepInterval ?? 360);
    const totalSteps = Number(p.totalSteps ?? 10);
    const totalSimTimeSec = stepInterval * totalSteps;
    const spreadRate = totalSimTimeSec > 0
      ? ((cellsBurned * CELL_AREA_HA) / (totalSimTimeSec / 3600)).toFixed(1)
      : '—';
    const windDeg = Number(p.windDirection ?? 0);
    const windDir = dirs[Math.round(windDeg / 45) % 8] ?? '—';
    return (
      `  Run #${runNum} [${entry.runAt}]: ` +
      `lat=${Number(p.lat ?? 0).toFixed(3)}, lng=${Number(p.lng ?? 0).toFixed(3)}, ` +
      `wind=${p.windSpeed}mph ${windDir} (${windDeg}°), ` +
      `cells=${cellsBurned}, area=${areaHa}ha, spread=${spreadRate}ha/hr, ` +
      `status=${entry.result.simulationResult.status}, ` +
      `api_time=${(entry.result.durationMs / 1000).toFixed(2)}s`
    );
  });

  return (
    `SIMULATION RUN HISTORY (${history.length} run${history.length !== 1 ? 's' : ''}, ` +
    `chronological — Run #1 is oldest, Run #${history.length} is most recent):\n` +
    lines.join('\n')
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  /** false = not authenticated; toggled true after AuthGateway succeeds */
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  /** Username for display purposes only */
  const [username, setUsername] = useState('');

  /** The most recent simulation result; null before the first run */
  const [simulationResult, setSimulationResult] = useState<SimulationRunResult | null>(null);

  /** Ordered history of all completed simulation runs (most recent first) */
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  /** id of the history entry currently displayed in the canvas */
  const [activeId, setActiveId] = useState<string | null>(null);

  // ── Handlers ───────────────────────────────────────────────────────────────

  /**
   * handleAuthSuccess
   * Called by AuthGateway when the user submits their name.
   * Unlocks the main application shell.
   */
  const handleAuthSuccess = useCallback((name: string): void => {
    setUsername(name);
    setIsAuthenticated(true);
  }, []);

  /**
   * handleLogout
   * Clears the session, routing back to the AuthGateway.
   */
  const handleLogout = useCallback((): void => {
    setIsAuthenticated(false);
    setUsername('');
    setSimulationResult(null);
    setHistory([]);
    setActiveId(null);
  }, []);

  /**
   * handleSimulationResult
   * Forwarded to ChatInterface; called when the backend responds with
   * a completed simulation result so VisualizationPanel can render it.
   */
  const handleSimulationResult = useCallback((result: SimulationRunResult): void => {
    setSimulationResult(result);
    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setHistory((prev) => [
      { id, result, runAt: new Date().toLocaleTimeString() },
      ...prev,
    ]);
    setActiveId(id);
  }, []);

  /**
   * handleSelectRun
   * Called by SimInfoSidebar when the user clicks a history entry.
   * Re-loads that run's result into the VisualizationPanel canvas.
   */
  const handleSelectRun = useCallback((entry: HistoryEntry): void => {
    setSimulationResult(entry.result);
    setActiveId(entry.id);
  }, []);

  // ── Render: unauthenticated ─────────────────────────────────────────────────

  if (!isAuthenticated) {
    return <AuthGateway onAuthSuccess={handleAuthSuccess} />;
  }

  // ── Render: authenticated application shell ──────────────────────────────────

  return (
    <div className="app-shell">

      {/* ── Application Header ── */}
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__logo">🔥</span>
          <h1 className="app-header__title">Blazen Sim</h1>
          <span className="app-header__subtitle">DEVS-FIRE Conversational Interface</span>
        </div>
        <div className="app-header__session">
          <span className="app-header__username text-muted">
            {username}
          </span>
          <button className="btn-ghost app-header__logout" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      {/* ── Main Content: three-column layout ── */}
      <main className="app-main">
        <section className="app-main__chat" aria-label="Simulation Chat">
          <ChatInterface
            onSimulationResult={handleSimulationResult}
            simulationContext={buildSimulationContext(history)}
          />
        </section>
        <section className="app-main__viz" aria-label="Simulation Visualization">
          <VisualizationPanel result={simulationResult} />
          <FireStatsPanel result={simulationResult} />
        </section>
        <aside className="app-main__sidebar" aria-label="Simulation Info">
          <SimInfoSidebar
            result={simulationResult}
            activeId={activeId}
            history={history}
            onSelectRun={handleSelectRun}
          />
        </aside>
      </main>

    </div>
  );
};

export default App;
