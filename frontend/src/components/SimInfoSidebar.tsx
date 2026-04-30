/**
 * SimInfoSidebar.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – Right sidebar: extracted simulation parameters + run history.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { SimulationRunResult } from './ChatInterface';
import './SimInfoSidebar.css';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  result: SimulationRunResult;
  runAt: string;
}

interface SimInfoSidebarProps {
  result: SimulationRunResult | null;
  activeId: string | null;
  history: HistoryEntry[];
  onSelectRun: (entry: HistoryEntry) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWindLabel(deg: unknown): string {
  const d = Number(deg);
  if (isNaN(d)) return '—';
  if (d >= 315 || d < 45)  return 'S';
  if (d >= 45  && d < 90)  return 'SW';
  if (d >= 90  && d < 135) return 'W';
  if (d >= 135 && d < 180) return 'NW';
  if (d >= 180 && d < 225) return 'N';
  if (d >= 225 && d < 270) return 'NE';
  if (d >= 270 && d < 315) return 'E';
  return 'SE';
}

function fmt(v: unknown, decimals = 2): string {
  const n = Number(v);
  return isNaN(n) ? '—' : n.toFixed(decimals);
}

// ── Component ─────────────────────────────────────────────────────────────────

export const SimInfoSidebar: React.FC<SimInfoSidebarProps> = ({
  result,
  activeId,
  history,
  onSelectRun,
}) => {
  const params = result?.extractedParams ?? null;
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside the sidebar
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleShare = useCallback((entry: HistoryEntry): void => {
    const p = entry.result.extractedParams;
    const grid = entry.result.simulationResult.thermalGrid ?? [];
    const cellsBurned = grid.length;
    const areaHa = (cellsBurned * 0.09).toFixed(1);
    const summary =
      `Blazen Sim Run #${entry.id}\n` +
      `Location: ${Number(p.lat).toFixed(3)}°, ${Number(p.lng).toFixed(3)}°\n` +
      `Wind: ${p.windSpeed} mph @ ${p.windDirection}°\n` +
      `Cells burned: ${cellsBurned}\n` +
      `Area burned: ${areaHa} ha\n` +
      `Duration: ${(entry.result.durationMs / 1000).toFixed(2)}s\n` +
      `Status: ${entry.result.simulationResult.status}`;
    void navigator.clipboard.writeText(summary);
    setMenuOpenId(null);
  }, []);

  const handleDownload = useCallback((entry: HistoryEntry): void => {
    const data = JSON.stringify(entry.result, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blazen-sim-run-${entry.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpenId(null);
  }, []);

  return (
    <div className="sim-sidebar" ref={sidebarRef}>

      {/* ── Extracted Parameters Panel ── */}
      <section className="sim-sidebar__section">
        <h3 className="sim-sidebar__section-title">
          <span className="sim-sidebar__title-icon" aria-hidden="true">⚙</span>
          Extracted Parameters
        </h3>

        {params ? (
          <dl className="sim-sidebar__params-grid">
            <div className="sim-sidebar__param-row">
              <dt>Latitude</dt>
              <dd>{fmt(params.lat, 5)}°</dd>
            </div>
            <div className="sim-sidebar__param-row">
              <dt>Longitude</dt>
              <dd>{fmt(params.lng, 5)}°</dd>
            </div>
            <div className="sim-sidebar__param-row sim-sidebar__param-row--divider" />
            <div className="sim-sidebar__param-row">
              <dt>Wind Speed</dt>
              <dd>{fmt(params.windSpeed, 1)} mph</dd>
            </div>
            <div className="sim-sidebar__param-row">
              <dt>Wind Dir.</dt>
              <dd>
                {fmt(params.windDirection, 0)}°{' '}
                <span className="sim-sidebar__wind-label">
                  ({getWindLabel(params.windDirection)})
                </span>
              </dd>
            </div>
            <div className="sim-sidebar__param-row sim-sidebar__param-row--divider" />
            <div className="sim-sidebar__param-row">
              <dt>Step Interval</dt>
              <dd>{fmt(params.stepInterval, 0)} s</dd>
            </div>
            <div className="sim-sidebar__param-row">
              <dt>Total Steps</dt>
              <dd>{fmt(params.totalSteps, 0)}</dd>
            </div>
          </dl>
        ) : (
          <p className="sim-sidebar__empty text-muted">
            Run a simulation to see parameters.
          </p>
        )}
      </section>

      {/* ── Simulation History Panel ── */}
      <section className="sim-sidebar__section sim-sidebar__section--history">
        <h3 className="sim-sidebar__section-title">
          <span className="sim-sidebar__title-icon" aria-hidden="true">📋</span>
          Run History
          {history.length > 0 && (
            <span className="sim-sidebar__badge">{history.length}</span>
          )}
        </h3>

        <div className="sim-sidebar__history-list">
          {history.length === 0 ? (
            <p className="sim-sidebar__empty text-muted">
              No simulations run yet.
            </p>
          ) : (
            history.map((entry, idx) => {
              const runNum = history.length - idx;
              const p = entry.result.extractedParams;
              const status = entry.result.simulationResult.status;
              const isActive = entry.id === activeId;

              return (
                <div key={entry.id} className="sim-sidebar__history-wrapper">
                  <button
                    className={`sim-sidebar__history-item${isActive ? ' sim-sidebar__history-item--active' : ''}`}
                    onClick={() => onSelectRun(entry)}
                    title={`View Run #${runNum}`}
                  >
                    <div className="sim-sidebar__history-header">
                      <span className="sim-sidebar__run-num">Run #{runNum}</span>
                      <span className={`sim-sidebar__run-status ${status === 'completed' ? 'text-success' : 'text-error'}`}>
                        {status}
                      </span>
                    </div>
                    <div className="sim-sidebar__history-body">
                      <span className="text-muted">
                        {fmt(p.lat, 3)}°, {fmt(p.lng, 3)}°
                      </span>
                      <span className="text-muted">
                        {fmt(p.windSpeed, 1)} mph · {getWindLabel(p.windDirection)}
                      </span>
                    </div>
                    <div className="sim-sidebar__history-footer text-muted">
                      <span>{entry.runAt}</span>
                      <span>{(entry.result.durationMs / 1000).toFixed(2)}s</span>
                    </div>
                  </button>
                  <div className="sim-sidebar__history-menu-container">
                    <button
                      className="sim-sidebar__menu-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === entry.id ? null : entry.id);
                      }}
                      aria-label="Run options"
                      aria-haspopup="true"
                      aria-expanded={menuOpenId === entry.id}
                    >
                      •••
                    </button>
                    {menuOpenId === entry.id && (
                      <div className="sim-sidebar__menu-dropdown">
                        <button
                          className="sim-sidebar__menu-item"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleShare(entry);
                          }}
                        >
                          Share
                        </button>
                        <button
                          className="sim-sidebar__menu-item"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(entry);
                          }}
                        >
                          Download JSON
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

    </div>
  );
};
