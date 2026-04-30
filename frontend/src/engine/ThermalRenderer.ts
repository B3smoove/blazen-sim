/**
 * ThermalRenderer.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – HTML5 Canvas thermal fire visualisation engine.
 *
 * Responsibilities (Single Responsibility: Canvas rendering only):
 *  - Accept a ThermalCell grid from the DEVS-FIRE simulation result.
 *  - Render each cell as an organic radial gradient on a pure-black canvas.
 *  - Use a yellow thermal core (#FFFF00) that dissipates outward through
 *    orange to deep red, simulating organic thermal spread.
 *  - STRICTLY omit all geometric markers, gridlines, or bounding boxes.
 *  - Expose a clear() method to reset the canvas between renders.
 *  - Expose a renderFrame() method for animated playback over time.
 *
 * Visual Algorithm:
 *  For each ThermalCell, paint a radial gradient centred on the cell's
 *  canvas coordinate. The gradient radius is scaled by the cell's intensity
 *  value. A composite 'screen' or 'lighter' globalCompositeOperation is used
 *  so overlapping fire zones blend naturally into brighter combined regions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ThermalCell {
  col: number;
  row: number;
  intensity: number;        // normalised [0.0 – 1.0]
  timeOffsetSeconds: number;
  /** True for cells on the active fire perimeter (fire front) */
  isPerimeter?: boolean;
}

export interface RendererConfig {
  /** Canvas element to render onto */
  canvas: HTMLCanvasElement;
  /**
   * Number of columns in the simulation grid.
   * Used to map grid coordinates to canvas pixel coordinates.
   */
  gridCols: number;
  /**
   * Number of rows in the simulation grid.
   */
  gridRows: number;
  /**
   * Base radius (in pixels) of the radial gradient at full freshness.
   * Burned-out cells shrink to ~60% of this value.
   */
  baseRadius?: number;
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class ThermalRenderer {
  /** The 2D rendering context acquired from the supplied canvas element */
  private readonly ctx: CanvasRenderingContext2D;

  /** Canvas element reference for dimension queries */
  private readonly canvas: HTMLCanvasElement;

  /** Grid dimensions – used to compute cell-to-pixel coordinate mapping */
  private readonly gridCols: number;
  private readonly gridRows: number;

  /** Base gradient radius at full intensity; defaults to 40px */
  private readonly baseRadius: number;

  /** Animation frame ID returned by requestAnimationFrame, for cancellation */
  private animationFrameId: number | null = null;

  /** Whether the animation is currently paused mid-playback */
  private isPaused = false;

  /** Wall-clock timestamp of the last advanced frame; null = reset on next tick */
  private lastAnimationFrameTime: number | null = null;

  /** Reference to the active animate closure so resumeAnimation can restart it */
  private currentAnimateFn: ((ts: number) => void) | null = null;

  constructor(config: RendererConfig) {
    const ctx = config.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('ThermalRenderer: Failed to acquire 2D canvas context.');
    }

    this.ctx = ctx;
    this.canvas = config.canvas;
    this.gridCols = config.gridCols;
    this.gridRows = config.gridRows;
    this.baseRadius = config.baseRadius ?? 40;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * clear
   * Fills the entire canvas with pure black (#000000), erasing all previous
   * thermal renders. Call before each new simulation result is loaded.
   */
  clear(): void {
    const { width, height } = this.canvas;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, width, height);
  }

  /**
   * renderAll
   * Renders every ThermalCell in a single synchronous pass using age-based
   * coloring that follows DEVS-FIRE semantics:
   *   - Cells with the LARGEST ignitionTime (fire front) → bright yellow core
   *   - Cells with the SMALLEST ignitionTime (ignited first) → dark charcoal
   * This represents the final state after the full simulation.
   *
   * @param cells – Array of ThermalCell objects from the simulation result.
   */
  renderAll(cells: ThermalCell[]): void {
    this.clear();
    this.ctx.globalCompositeOperation = 'lighter';

    const maxTime = cells.reduce((m, c) => Math.max(m, c.timeOffsetSeconds), 0);

    for (const cell of cells) {
      // age = 0 → just ignited (newest / fire front) → bright
      // age = 1 → ignited first (oldest / burned out)  → dark
      const age = maxTime > 0 ? 1 - cell.timeOffsetSeconds / maxTime : 0;
      this.paintCell(cell, age);
    }

    this.ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * renderAnimated
   * Plays back the ThermalCell array as a time-ordered animation following
   * DEVS-FIRE fire-spread semantics. Each rAF frame:
   *   1. Adds newly igniting cells to the cumulative set.
   *   2. CLEARS the canvas and REPAINTS all ignited cells with fresh age values
   *      so cells cool visually as the fire front advances past them.
   *
   * Colour semantics:
   *   normalizedAge = 0  → cell just ignited (fire front)  → bright yellow
   *   normalizedAge = 1  → cell ignited at time 0 (oldest) → dark charcoal
   *
   * @param cells            – Full set of ThermalCells from the simulation.
   * @param msPerTimeUnit    – Wall-clock ms to spend on each simulation time step.
   * @param onFrameComplete  – Optional callback invoked after each frame is drawn.
   * @param onComplete       – Optional callback fired when the last frame finishes.
   * @param startFrameIndex  – Frame index to resume from (default 0).
   */
  renderAnimated(
    cells: ThermalCell[],
    msPerTimeUnit = 100,
    onFrameComplete?: (timeOffset: number, frameIndex: number) => void,
    onComplete?: () => void,
    startFrameIndex = 0
  ): void {
    this.cancelAnimation();
    this.clear();

    const timeGroups = this.groupByTimeOffset(cells);
    const timeKeys = Array.from(timeGroups.keys()).sort((a, b) => a - b);
    const maxTimeOffset = timeKeys[timeKeys.length - 1] ?? 0;

    const clampedStart = Math.max(0, Math.min(startFrameIndex, timeKeys.length - 1));
    let frameIndex = clampedStart;
    const ignitedCells: ThermalCell[] = [];

    // Pre-populate cells for all frames before startFrameIndex
    for (let i = 0; i < clampedStart; i++) {
      ignitedCells.push(...(timeGroups.get(timeKeys[i]) ?? []));
    }

    // Immediately paint the pre-populated state so canvas is correct before first tick
    if (ignitedCells.length > 0) {
      const initTime = timeKeys[clampedStart];
      this.ctx.globalCompositeOperation = 'lighter';
      for (const cell of ignitedCells) {
        const age = maxTimeOffset > 0 ? (initTime - cell.timeOffsetSeconds) / maxTimeOffset : 0;
        this.paintCell(cell, Math.max(0, age));
      }
      this.ctx.globalCompositeOperation = 'source-over';
    }

    const animate = (timestamp: number): void => {
      if (this.lastAnimationFrameTime === null) this.lastAnimationFrameTime = timestamp;

      const elapsed = timestamp - this.lastAnimationFrameTime;

      if (elapsed >= msPerTimeUnit) {
        this.lastAnimationFrameTime = timestamp;

        const currentTime = timeKeys[frameIndex];

        // Accumulate cells igniting at this time step
        const newCells = timeGroups.get(currentTime) ?? [];
        ignitedCells.push(...newCells);

        // Full repaint: all ignited cells with their current age
        this.clear();
        this.ctx.globalCompositeOperation = 'lighter';

        for (const cell of ignitedCells) {
          // How long ago did this cell ignite, normalised to [0,1]?
          // 0 = just ignited (fire front), 1 = ignited at time 0 (burned out)
          const age = maxTimeOffset > 0
            ? (currentTime - cell.timeOffsetSeconds) / maxTimeOffset
            : 0;
          this.paintCell(cell, Math.max(0, age));
        }

        this.ctx.globalCompositeOperation = 'source-over';

        onFrameComplete?.(currentTime, frameIndex);
        frameIndex++;
      }

      if (frameIndex < timeKeys.length) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        this.animationFrameId = null;
        this.currentAnimateFn = null;
        onComplete?.();
      }
    };

    this.currentAnimateFn = animate;
    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * renderSnapshot
   * Renders a single static frame showing all cells that had ignited by
   * frameIndex. Does not affect the animation loop state.
   * Call pauseAnimation() before this to stop any running animation.
   *
   * @param cells      – Full ThermalCell array.
   * @param frameIndex – 0-based index into the sorted unique-time-key array.
   */
  renderSnapshot(cells: ThermalCell[], frameIndex: number): void {
    this.clear();

    const timeGroups = this.groupByTimeOffset(cells);
    const timeKeys = Array.from(timeGroups.keys()).sort((a, b) => a - b);
    if (timeKeys.length === 0) return;

    const clampedIdx = Math.max(0, Math.min(frameIndex, timeKeys.length - 1));
    const currentTime = timeKeys[clampedIdx];
    const maxTimeOffset = timeKeys[timeKeys.length - 1] ?? 0;

    const ignitedCells: ThermalCell[] = [];
    for (let i = 0; i <= clampedIdx; i++) {
      ignitedCells.push(...(timeGroups.get(timeKeys[i]) ?? []));
    }

    this.ctx.globalCompositeOperation = 'lighter';
    for (const cell of ignitedCells) {
      const age = maxTimeOffset > 0
        ? (currentTime - cell.timeOffsetSeconds) / maxTimeOffset
        : 0;
      this.paintCell(cell, Math.max(0, age));
    }
    this.ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * cancelAnimation
   * Cancels any active rAF animation loop. Call on component unmount to
   * prevent memory leaks and phantom renders.
   */
  cancelAnimation(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isPaused = false;
    this.lastAnimationFrameTime = null;
    this.currentAnimateFn = null;
  }

  /**
   * pauseAnimation
   * Freezes the animation at the current frame without losing playback position.
   * Resets lastAnimationFrameTime so resuming does not skip frames.
   */
  pauseAnimation(): void {
    if (this.animationFrameId !== null && !this.isPaused) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
      this.lastAnimationFrameTime = null;
      this.isPaused = true;
    }
  }

  /**
   * resumeAnimation
   * Continues playback from the exact frame where pauseAnimation was called.
   */
  resumeAnimation(): void {
    if (this.isPaused && this.currentAnimateFn) {
      this.isPaused = false;
      this.animationFrameId = requestAnimationFrame(this.currentAnimateFn);
    }
  }

  /** True when an animation is actively playing (not paused, not idle) */
  get isAnimating(): boolean {
    return this.animationFrameId !== null;
  }

  // ── Private rendering primitives ──────────────────────────────────────────

  /**
   * paintCell
   * Renders a single ThermalCell as a radial gradient using DEVS-FIRE age
   * semantics. No geometric outlines, gridlines, or markers are drawn.
   *
   * @param cell          – The ThermalCell to render.
   * @param normalizedAge – 0 = fire front (just ignited, brightest yellow),
   *                        1 = burned out (oldest, dark charcoal).
   *                        Perimeter cells are forced to age 0 regardless.
   */
  private paintCell(cell: ThermalCell, normalizedAge: number): void {
    const { x, y } = this.gridToPixel(cell.col, cell.row);

    // Perimeter cells always render as fire-front regardless of actual age
    const age = cell.isPerimeter ? 0 : Math.min(1, Math.max(0, normalizedAge));

    // Radius shrinks as the cell ages (burned-out cells have a smaller glow)
    const radius = Math.max(6, this.baseRadius * (0.55 + (1 - age) * 0.45));

    const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);

    if (age <= 0.20) {
      // ── Fire front / freshly ignited ────────────────────────────────────
      // Bright white-yellow core → orange → red edge
      const t = age / 0.20;                    // 0→1 across this band
      gradient.addColorStop(0.00, `rgba(255, 255, ${Math.round(220 - t * 220)}, 1.0)`);
      gradient.addColorStop(0.22, `rgba(255, ${Math.round(255 - t * 95)}, 0, 0.95)`);
      gradient.addColorStop(0.50, `rgba(255, ${Math.round(140 - t * 90)}, 0, 0.70)`);
      gradient.addColorStop(0.78, `rgba(200, ${Math.round(40  - t * 30)}, 0, 0.40)`);
      gradient.addColorStop(1.00, 'rgba(0, 0, 0, 0)');
    } else if (age <= 0.55) {
      // ── Active burning ───────────────────────────────────────────────────
      // Orange core → deep red → transparent
      const t = (age - 0.20) / 0.35;          // 0→1 across this band
      const a = 0.85 - t * 0.30;
      gradient.addColorStop(0.00, `rgba(255, ${Math.round(160 - t * 130)}, 0, ${a})`);
      gradient.addColorStop(0.38, `rgba(${Math.round(230 - t * 70)}, ${Math.round(60 - t * 45)}, 0, ${a * 0.65})`);
      gradient.addColorStop(0.70, `rgba(${Math.round(160 - t * 50)}, ${Math.round(18 - t * 8)}, 0, ${a * 0.35})`);
      gradient.addColorStop(1.00, 'rgba(0, 0, 0, 0)');
    } else if (age <= 0.80) {
      // ── Smoldering ───────────────────────────────────────────────────────
      // Deep red core → dark, fading
      const t = (age - 0.55) / 0.25;          // 0→1 across this band
      const a = 0.55 - t * 0.30;
      gradient.addColorStop(0.00, `rgba(${Math.round(160 - t * 60)}, ${Math.round(22 - t * 10)}, 0, ${a})`);
      gradient.addColorStop(0.45, `rgba(${Math.round(80  - t * 30)}, ${Math.round(8  - t * 4)},  0, ${a * 0.55})`);
      gradient.addColorStop(1.00, 'rgba(0, 0, 0, 0)');
    } else {
      // ── Burned out / ash ─────────────────────────────────────────────────
      // Dark charcoal – just enough to show the fire has passed
      const t = (age - 0.80) / 0.20;          // 0→1 across this band
      const a = Math.max(0.06, 0.25 - t * 0.19);
      gradient.addColorStop(0.00, `rgba(${Math.round(70 - t * 40)}, ${Math.round(12 - t * 8)}, 0, ${a})`);
      gradient.addColorStop(0.50, `rgba(${Math.round(28 - t * 18)}, 4, 0, ${a * 0.5})`);
      gradient.addColorStop(1.00, 'rgba(0, 0, 0, 0)');
    }

    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = gradient;
    this.ctx.fill();
  }

  /**
   * gridToPixel
   * Converts a (col, row) grid index to (x, y) canvas pixel coordinates.
   * Adds a half-cell offset so gradients are centred within their cells.
   *
   * @param col – Grid column index (0-based).
   * @param row – Grid row index (0-based).
   * @returns    { x, y } in canvas pixels.
   */
  private gridToPixel(col: number, row: number): { x: number; y: number } {
    const cellW = this.canvas.width  / this.gridCols;
    const cellH = this.canvas.height / this.gridRows;
    return {
      x: col * cellW + cellW / 2,
      y: row * cellH + cellH / 2,
    };
  }

  /**
   * groupByTimeOffset
   * Partitions an array of ThermalCells into a Map keyed by their
   * timeOffsetSeconds value, preserving insertion order within each group.
   *
   * @param cells – Flat array of ThermalCells.
   * @returns      Map<timeOffset, ThermalCell[]>.
   */
  private groupByTimeOffset(cells: ThermalCell[]): Map<number, ThermalCell[]> {
    const map = new Map<number, ThermalCell[]>();
    for (const cell of cells) {
      const key = cell.timeOffsetSeconds;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(cell);
    }
    return map;
  }
}
