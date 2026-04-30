/**
 * VisualizationPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – Simulation result visualisation panel.
 *
 * Responsibilities:
 *  - Manage a toggle between two display modes: Canvas (thermal) and JSON.
 *  - On receiving a new SimulationRunResult, instantiate ThermalRenderer and
 *    trigger an animated render of the thermalGrid data.
 *  - In JSON mode, display the full simulationResult payload in a formatted
 *    code block for inspection.
 *  - Handle the case where no simulation has been run yet (empty state).
 *
 * Canvas Contract (CRITICAL per spec):
 *  - Canvas background: #000000 (pure black).
 *  - Fire rendered with yellow thermal core (#FFFF00) via radial gradients.
 *  - NO geometric markers, gridlines, or bounding boxes rendered.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ThermalRenderer } from '../engine/ThermalRenderer';
import type { ThermalCell } from '../engine/ThermalRenderer';
import type { SimulationRunResult } from './ChatInterface';
import './VisualizationPanel.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type DisplayMode = 'canvas' | 'json';
type PlayState = 'idle' | 'playing' | 'paused' | 'complete';

interface VisualizationPanelProps {
  /** The latest simulation result forwarded from App.tsx; null before first run */
  result: SimulationRunResult | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default grid dimensions – used when DEVS-FIRE does not specify them */
const DEFAULT_GRID_COLS = 50;
const DEFAULT_GRID_ROWS = 50;

/** Every simulation plays back in at most this many wall-clock milliseconds */
const TARGET_TOTAL_MS = 25_000;

/** Floor for ms-per-frame; prevents imperceptibly fast playback */
const MIN_MS_PER_FRAME = 30;

// ── Component ─────────────────────────────────────────────────────────────────

export const VisualizationPanel: React.FC<VisualizationPanelProps> = ({ result }) => {
  const [displayMode, setDisplayMode] = useState<DisplayMode>('canvas');
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [frameCount, setFrameCount] = useState(0);
  const [scrubIndex, setScrubIndex] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);

  /** Ref to the <canvas> DOM element */
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** Ref to the ThermalRenderer instance; persists across re-renders */
  const rendererRef = useRef<ThermalRenderer | null>(null);

  /** Stores the perimeter-annotated grid so playback handlers use the same data */
  const annotatedGridRef = useRef<ThermalCell[] | null>(null);

  // ── Effect: (re)render when a new result arrives ────────────────────────────

  useEffect(() => {
    if (!result || !canvasRef.current) return;

    const rawGrid = result.simulationResult?.thermalGrid;

    // If no thermal grid was returned, nothing to render on canvas
    if (!rawGrid || rawGrid.length === 0) return;

    // Mark perimeter cells using the perimeterCellIds list when available.
    // The renderer colours them as fire-front regardless of their age.
    const perimeterSet = result.simulationResult?.perimeterCellIds
      ? new Set(result.simulationResult.perimeterCellIds)
      : null;

    const thermalGrid = perimeterSet
      ? rawGrid.map((c) => {
          // Cell ID reverse-lookup: id = row * gridWidth + col
          const gw = result.simulationResult?.gridWidth;
          if (!gw) return c;
          const cellId = c.row * gw + c.col;
          return perimeterSet.has(cellId) ? { ...c, isPerimeter: true } : c;
        })
      : rawGrid;

    // Use grid dimensions from DEVS-FIRE if provided; otherwise infer from data
    const gridCols =
      result.simulationResult?.gridWidth ??
      ((Math.max(...rawGrid.map((c) => c.col)) + 1) || DEFAULT_GRID_COLS);
    const gridRows =
      result.simulationResult?.gridHeight ??
      ((Math.max(...rawGrid.map((c) => c.row)) + 1) || DEFAULT_GRID_ROWS);

    // Cancel any previously running animation before creating a new renderer
    rendererRef.current?.cancelAnimation();

    // Instantiate a fresh ThermalRenderer for this result
    rendererRef.current = new ThermalRenderer({
      canvas: canvasRef.current,
      gridCols,
      gridRows,
      baseRadius: 36,
    });

    // Persist the annotated grid so handleReplay can reuse it
    annotatedGridRef.current = thermalGrid;

    setPlayState('playing');
    setFrameCount(0);
    setScrubIndex(0);

    // Compute frame rate so total playback never exceeds TARGET_TOTAL_MS
    const uniqueFrames = new Set(thermalGrid.map((c) => c.timeOffsetSeconds)).size;
    setTotalFrames(uniqueFrames);
    const msPerTimeUnit = uniqueFrames > 0
      ? Math.max(MIN_MS_PER_FRAME, Math.floor(TARGET_TOTAL_MS / uniqueFrames))
      : MIN_MS_PER_FRAME;

    // Begin animated thermal playback
    rendererRef.current.renderAnimated(
      thermalGrid,
      msPerTimeUnit,
      (_timeOffset, frameIdx) => {
        setFrameCount(frameIdx + 1);
        setScrubIndex(frameIdx);
      },
      () => setPlayState('complete')
    );

    return () => {
      rendererRef.current?.cancelAnimation();
    };
  }, [result]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  /** Shared helper – (re)starts animation from a given frame index */
  const startAnimation = useCallback((grid: ThermalCell[], fromFrame = 0): void => {
    if (!rendererRef.current) return;
    rendererRef.current.cancelAnimation();
    setFrameCount(fromFrame + 1);
    setScrubIndex(fromFrame);
    setPlayState('playing');
    const uniqueFrames = new Set(grid.map((c) => c.timeOffsetSeconds)).size;
    const msPerTimeUnit = uniqueFrames > 0
      ? Math.max(MIN_MS_PER_FRAME, Math.floor(TARGET_TOTAL_MS / uniqueFrames))
      : MIN_MS_PER_FRAME;
    rendererRef.current.renderAnimated(
      grid,
      msPerTimeUnit,
      (_timeOffset, frameIdx) => {
        setFrameCount(frameIdx + 1);
        setScrubIndex(frameIdx);
      },
      () => setPlayState('complete'),
      fromFrame
    );
  }, []);

  const handlePause = useCallback((): void => {
    rendererRef.current?.pauseAnimation();
    setPlayState('paused');
  }, []);

  const handlePlayResume = useCallback((): void => {
    const grid = annotatedGridRef.current ?? result?.simulationResult?.thermalGrid;
    if (grid) startAnimation(grid, scrubIndex);
  }, [result, startAnimation, scrubIndex]);

  const handleReset = useCallback((): void => {
    const grid = annotatedGridRef.current ?? result?.simulationResult?.thermalGrid;
    if (grid) startAnimation(grid, 0);
  }, [result, startAnimation]);

  const handleScrubChange = useCallback((idx: number): void => {
    const grid = annotatedGridRef.current ?? result?.simulationResult?.thermalGrid;
    if (!grid || !rendererRef.current) return;
    rendererRef.current.pauseAnimation();
    if (playState === 'playing') setPlayState('paused');
    setScrubIndex(idx);
    setFrameCount(idx + 1);
    rendererRef.current.renderSnapshot(grid, idx);
  }, [playState, result]);

  // ── Render: empty state ──────────────────────────────────────────────────────

  if (!result) {
    return (
      <div className="viz-panel viz-panel--empty">
        <div className="viz-panel__empty-state">
          <span className="viz-panel__empty-icon" aria-hidden="true">🔥</span>
          <h3 className="viz-panel__empty-heading">No Simulation Yet</h3>
          <p className="viz-panel__empty-body text-muted">
            Submit a natural-language wildfire scenario in the chat panel to run a
            DEVS-FIRE simulation and view the thermal output here.
          </p>
        </div>
      </div>
    );
  }

  // ── Render: result panel ─────────────────────────────────────────────────────

  const hasThermalData =
    (result.simulationResult?.thermalGrid?.length ?? 0) > 0;

  return (
    <div className="viz-panel">

      {/* ── Toolbar ── */}
      <div className="viz-panel__toolbar">
        <div className="viz-panel__mode-toggle" role="group" aria-label="Display mode">
          <button
            className={`viz-panel__mode-btn ${displayMode === 'canvas' ? 'viz-panel__mode-btn--active' : ''}`}
            onClick={() => setDisplayMode('canvas')}
            aria-pressed={displayMode === 'canvas'}
          >
            Thermal Canvas
          </button>
          <button
            className={`viz-panel__mode-btn ${displayMode === 'json' ? 'viz-panel__mode-btn--active' : ''}`}
            onClick={() => setDisplayMode('json')}
            aria-pressed={displayMode === 'json'}
          >
            JSON Data
          </button>
        </div>

        {/* Canvas controls */}
        {displayMode === 'canvas' && hasThermalData && (
          <div className="viz-panel__canvas-controls">
            <div className="viz-panel__playback-controls" role="group" aria-label="Playback controls">
              <button
                className="viz-panel__ctrl-btn"
                onClick={handlePlayResume}
                disabled={playState === 'playing'}
                aria-label={playState === 'paused' ? 'Resume' : 'Play'}
                title={playState === 'paused' ? 'Resume' : playState === 'complete' ? 'Replay' : 'Play'}
              >
                ▶
              </button>
              <button
                className="viz-panel__ctrl-btn"
                onClick={handlePause}
                disabled={playState !== 'playing'}
                aria-label="Pause"
                title="Pause"
              >
                ⏸
              </button>
              <button
                className="viz-panel__ctrl-btn"
                onClick={handleReset}
                aria-label="Reset"
                title="Reset"
              >
                ⟳
              </button>
            </div>
            <span className="viz-panel__frame-counter text-muted">
              Frame {frameCount}
            </span>
          </div>
        )}

        {/* Simulation metadata */}
        <div className="viz-panel__meta text-muted">
          <span>
            Status:&nbsp;
            <span
              className={
                result.simulationResult.status === 'completed'
                  ? 'text-success'
                  : 'text-error'
              }
            >
              {result.simulationResult.status}
            </span>
          </span>
          <span>Duration: {(result.durationMs / 1000).toFixed(2)}s</span>
        </div>
      </div>

      {/* ── Timeline scrubber ── */}
      {displayMode === 'canvas' && hasThermalData && totalFrames > 1 && (
        <div className="viz-panel__scrubber">
          <input
            type="range"
            className="viz-panel__scrubber-input"
            min={0}
            max={totalFrames - 1}
            value={scrubIndex}
            onChange={(e) => handleScrubChange(Number(e.target.value))}
            style={{
              background: `linear-gradient(to right,
                var(--color-accent-bright) 0%,
                var(--color-accent-bright) ${(scrubIndex / Math.max(1, totalFrames - 1)) * 100}%,
                #2a2a2a ${(scrubIndex / Math.max(1, totalFrames - 1)) * 100}%,
                #2a2a2a 100%)`,
            }}
            aria-label="Simulation timeline"
          />
        </div>
      )}

      {/* ── Canvas view ── */}
      <div
        className="viz-panel__canvas-container"
        style={{ display: displayMode === 'canvas' ? 'flex' : 'none' }}
        aria-hidden={displayMode !== 'canvas'}
      >
        <canvas
          ref={canvasRef}
          className="viz-panel__canvas"
          width={800}
          height={600}
          aria-label="Thermal fire spread visualisation"
        />

        {!hasThermalData && (
          <div className="viz-panel__no-thermal text-muted">
            No thermal grid data was returned for this simulation run.
          </div>
        )}
      </div>

      {/* ── JSON view ── */}
      {displayMode === 'json' && (
        <div className="viz-panel__json-container">
          <pre className="viz-panel__json-output">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

    </div>
  );
};
