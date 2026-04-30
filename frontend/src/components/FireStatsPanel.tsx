/**
 * FireStatsPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – Computed fire statistics bar displayed below the canvas.
 *
 * Derives all statistics from the simulation result already held in state —
 * no additional API calls required.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import type { SimulationRunResult } from './ChatInterface';
import './FireStatsPanel.css';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Area of one 30 m × 30 m DEVS-FIRE cell in hectares */
const CELL_AREA_HA = 0.09;


// ── Types ─────────────────────────────────────────────────────────────────────

interface FireStatsPanelProps {
  result: SimulationRunResult | null;
}

// ── Sub-component ─────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: string;
  value: string;
  label: string;
  highlight?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ icon, value, label, highlight }) => (
  <div className={`fire-stats__card${highlight ? ' fire-stats__card--highlight' : ''}`}>
    <span className="fire-stats__icon" aria-hidden="true">{icon}</span>
    <span className="fire-stats__value">{value}</span>
    <span className="fire-stats__label">{label}</span>
  </div>
);

// ── Component ─────────────────────────────────────────────────────────────────

export const FireStatsPanel: React.FC<FireStatsPanelProps> = ({ result }) => {
  if (!result) return null;

  const grid           = result.simulationResult.thermalGrid ?? [];
  const cellsBurned    = grid.length;
  const areaHa         = cellsBurned * CELL_AREA_HA;
  const stepInterval    = Number(result.extractedParams.stepInterval ?? 360);
  const totalSteps      = Number(result.extractedParams.totalSteps   ?? 10);
  const totalSimTimeSec = stepInterval * totalSteps;
  const spreadRateHaHr  = totalSimTimeSec > 0
    ? areaHa / (totalSimTimeSec / 3600)
    : 0;

  const simHours   = Math.floor(totalSimTimeSec / 3600);
  const simMinutes = Math.floor((totalSimTimeSec % 3600) / 60);
  const simDurLabel = simHours > 0
    ? `${simHours}h ${simMinutes}m`
    : `${simMinutes}m`;

  return (
    <div className="fire-stats" role="region" aria-label="Fire statistics">
      <StatCard
        icon="🔲"
        value={cellsBurned.toLocaleString()}
        label="Cells Burned"
      />
      <div className="fire-stats__divider" />
      <StatCard
        icon="🔥"
        value={`${areaHa.toFixed(1)} ha`}
        label="Area Burned"
        highlight
      />
      <div className="fire-stats__divider" />
      <StatCard
        icon="⚡"
        value={`${spreadRateHaHr.toFixed(1)} ha/hr`}
        label="Spread Rate"
        highlight={spreadRateHaHr > 5}
      />
      <div className="fire-stats__divider" />
      <StatCard
        icon="⏱"
        value={simDurLabel}
        label="Sim Duration"
      />
    </div>
  );
};
