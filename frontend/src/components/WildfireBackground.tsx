/**
 * WildfireBackground.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – Wildfire simulation canvas background.
 *
 * A cellular automata wildfire simulation that runs in the background
 * of the AuthGateway component.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef } from 'react';
import './WildfireBackground.css';

// ── Configuration ─────────────────────────────────────────────────────────────

const COLS = 90;
const ROWS = 55;
const CELL_SIZE = 8;
const CANVAS_WIDTH = COLS * CELL_SIZE;
const CANVAS_HEIGHT = ROWS * CELL_SIZE;

// Grid states
const EMPTY = 0;
const TREE = 1;
const BURNING = 2;
const BURNT = 3;
const FIREBREAK = 4;

// Simulation timing
const TICK_INTERVAL_MS = 110; // ~9 ticks per second
const BURN_DURATION_MIN = 18;
const BURN_DURATION_MAX = 35;
const REGROW_THRESHOLD = 280; // ticks before burnt -> empty starts regrowing
const REGROW_CHANCE = 0.015; // chance per tick for empty/burnt to regrow a tree
const FIREBREAK_DECAY = 90; // ticks before firebreak degrades to empty

// Fire spread
const BASE_SPREAD_PROB = 0.11;
const WIND_INFLUENCE = 0.30;
const FUEL_INFLUENCE = 1.4;
const DIAGONAL_FACTOR = 0.72;

// Firefighters
const NUM_FIREFIGHTERS = 5;
const FIREFIGHTER_SPEED = 1.6; // cells per tick
const EXTINGUISH_RADIUS = 2.5;
const EXTINGUISH_COST = 8; // water per extinguish action
const MAX_WATER = 120;
const WATER_RECHARGE = 0.6; // per tick
const FIREBREAK_CLEAR_RADIUS = 1.0;
const FIREFIGHTER_SAFE_DISTANCE = 4;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Cell {
  state: number;
  fuel: number;
  burnTimer: number;
  regrowTimer: number;
  firebreakTimer: number;
}

interface BurningCell {
  r: number;
  c: number;
}

interface Wind {
  angle: number;
  speed: number;
  targetAngle: number;
  targetSpeed: number;
  gustTimer: number;
  gustActive: boolean;
  shiftCooldown: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const WildfireBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    const ctx = canvas.getContext('2d')!;

    // ── Grid Data ─────────────────────────────────────────────────────────────

    const grid: Cell[][] = [];
    for (let r = 0; r < ROWS; r++) {
      grid[r] = [];
      for (let c = 0; c < COLS; c++) {
        grid[r][c] = {
          state: EMPTY,
          fuel: 0,
          burnTimer: 0,
          regrowTimer: 0,
          firebreakTimer: 0,
        };
      }
    }

    // ── Wind System ───────────────────────────────────────────────────────────

    const wind: Wind = {
      angle: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.5,
      targetAngle: 0,
      targetSpeed: 0,
      gustTimer: 0,
      gustActive: false,
      shiftCooldown: 0,
    };
    wind.targetAngle = wind.angle;
    wind.targetSpeed = wind.speed;

    function getWindVector() {
      return {
        dx: Math.cos(wind.angle),
        dy: Math.sin(wind.angle),
      };
    }

    function scheduleWindShift() {
      if (Math.random() < 0.25 && wind.shiftCooldown <= 0) {
        wind.targetAngle = wind.angle + (Math.random() - 0.5) * Math.PI * 1.6;
        wind.targetSpeed = 0.2 + Math.random() * 0.8;
        wind.gustActive = true;
        wind.gustTimer = 18;
        wind.shiftCooldown = 40 + Math.random() * 80;
      } else {
        wind.targetAngle = wind.angle + (Math.random() - 0.5) * 0.7;
        wind.targetSpeed = 0.25 + Math.random() * 0.65;
        wind.shiftCooldown = Math.max(0, wind.shiftCooldown - 1);
      }
      wind.targetSpeed = Math.max(0.15, Math.min(0.95, wind.targetSpeed));
    }

    function updateWind() {
      const angleDiff = wind.targetAngle - wind.angle;
      let adjustedDiff = angleDiff;
      while (adjustedDiff > Math.PI) adjustedDiff -= Math.PI * 2;
      while (adjustedDiff < -Math.PI) adjustedDiff += Math.PI * 2;
      wind.angle += adjustedDiff * 0.06;
      while (wind.angle > Math.PI * 2) wind.angle -= Math.PI * 2;
      while (wind.angle < 0) wind.angle += Math.PI * 2;

      wind.speed += (wind.targetSpeed - wind.speed) * 0.08;

      if (wind.gustActive) {
        wind.gustTimer--;
        if (wind.gustTimer <= 0) {
          wind.gustActive = false;
        }
      }

      if (wind.shiftCooldown <= 0 && Math.random() < 0.008) {
        scheduleWindShift();
      }
      if (wind.shiftCooldown > 0) {
        wind.shiftCooldown--;
      }
      if (Math.random() < 0.003 && wind.shiftCooldown <= 0) {
        scheduleWindShift();
      }
    }

    // ── Firefighter Class ─────────────────────────────────────────────────────

    class FirefighterClass {
      x: number;
      y: number;
      targetX: number;
      targetY: number;
      mode: string;
      waterSupply: number;
      energy: number;
      trail: { x: number; y: number }[];
      stuckTimer: number;
      modeTimer: number;

      constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
        this.targetX = x;
        this.targetY = y;
        this.mode = 'approach';
        this.waterSupply = MAX_WATER;
        this.energy = 100;
        this.trail = [];
        this.stuckTimer = 0;
        this.modeTimer = 0;
      }

      assess(grid: Cell[][], windVec: { dx: number; dy: number }, allBurningCells: BurningCell[]) {
        let nearbyFireCount = 0;
        let nearestFireDist = Infinity;
        let nearestFireX = this.x;
        let nearestFireY = this.y;
        const scanRadius = 10;

        for (const bc of allBurningCells) {
          const dx = bc.c - this.x;
          const dy = bc.r - this.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < scanRadius) {
            nearbyFireCount++;
            if (dist < nearestFireDist) {
              nearestFireDist = dist;
              nearestFireX = bc.c;
              nearestFireY = bc.r;
            }
          }
        }

        const localScanR = 3;
        let localFireCount = 0;
        for (const bc of allBurningCells) {
          const dx = bc.c - this.x;
          const dy = bc.r - this.y;
          if (Math.abs(dx) < localScanR && Math.abs(dy) < localScanR &&
            Math.sqrt(dx * dx + dy * dy) < localScanR) {
            localFireCount++;
          }
        }

        const prevMode = this.mode;
        if (localFireCount > 6 || nearestFireDist < 1.8) {
          this.mode = 'retreat';
        } else if (nearbyFireCount > 2 && this.waterSupply > 25 && nearestFireDist < 8) {
          this.mode = 'attack';
        } else if (nearbyFireCount > 0 && this.waterSupply < 50 && nearestFireDist < 15 &&
          nearestFireDist > 3) {
          this.mode = 'firebreak';
        } else if (nearbyFireCount > 0) {
          this.mode = 'approach';
        } else {
          this.mode = 'patrol';
        }

        if (this.mode !== prevMode) this.modeTimer = 0;
        else this.modeTimer++;

        switch (this.mode) {
          case 'attack':
            this.targetX = nearestFireX;
            this.targetY = nearestFireY;
            break;
          case 'retreat':
            if (nearestFireDist < 20 && nearestFireDist > 0.01) {
              const awayDx = (this.x - nearestFireX) / nearestFireDist;
              const awayDy = (this.y - nearestFireY) / nearestFireDist;
              this.targetX = this.x + awayDx * 20;
              this.targetY = this.y + awayDy * 20;
            } else {
              const cx = allBurningCells.length > 0 ?
                allBurningCells.reduce((a, b) => a + b.c, 0) / allBurningCells.length :
                COLS / 2;
              const cy = allBurningCells.length > 0 ?
                allBurningCells.reduce((a, b) => a + b.r, 0) / allBurningCells.length :
                ROWS / 2;
              const awayDx = this.x - cx;
              const awayDy = this.y - cy;
              const ad = Math.sqrt(awayDx * awayDx + awayDy * awayDy) || 1;
              this.targetX = this.x + (awayDx / ad) * 15;
              this.targetY = this.y + (awayDy / ad) * 15;
            }
            break;
          case 'firebreak':
            if (nearestFireDist < 20) {
              const aheadX = nearestFireX - windVec.dx * 7;
              const aheadY = nearestFireY - windVec.dy * 7;
              const perpX = -windVec.dy;
              const perpY = windVec.dx;
              const offset = ((this.modeTimer * 0.4) % 12) - 6;
              this.targetX = aheadX + perpX * offset;
              this.targetY = aheadY + perpY * offset;
            }
            break;
          case 'approach':
            if (nearestFireDist < 20) {
              const appDx = (nearestFireX - this.x) / nearestFireDist;
              const appDy = (nearestFireY - this.y) / nearestFireDist;
              const safeDist = Math.max(0, nearestFireDist - FIREFIGHTER_SAFE_DISTANCE);
              this.targetX = this.x + appDx * safeDist;
              this.targetY = this.y + appDy * safeDist;
            }
            break;
          case 'patrol':
            if (this.modeTimer > 40 || this.stuckTimer > 20) {
              this.targetX = 5 + Math.random() * (COLS - 10);
              this.targetY = 5 + Math.random() * (ROWS - 10);
              this.stuckTimer = 0;
            }
            break;
        }

        this.targetX = Math.max(1, Math.min(COLS - 2, this.targetX));
        this.targetY = Math.max(1, Math.min(ROWS - 2, this.targetY));
      }

      move(grid: Cell[][], allBurningCells: BurningCell[]) {
        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.3) {
          this.stuckTimer++;
          return;
        }

        const ndx = dx / dist;
        const ndy = dy / dist;
        const speed = FIREFIGHTER_SPEED * (this.energy / 100) * (this.mode === 'retreat' ? 1.3 : 1);

        let moveX = ndx * speed;
        let moveY = ndy * speed;

        const checkR = 2.5;
        let avoidanceX = 0;
        let avoidanceY = 0;
        for (const bc of allBurningCells) {
          const bdx = this.x - bc.c;
          const bdy = this.y - bc.r;
          const bdist = Math.sqrt(bdx * bdx + bdy * bdy);
          if (bdist < checkR && bdist > 0.01) {
            const strength = (checkR - bdist) / checkR;
            avoidanceX += (bdx / bdist) * strength * 3;
            avoidanceY += (bdy / bdist) * strength * 3;
          }
        }
        if (avoidanceX !== 0 || avoidanceY !== 0) {
          moveX += avoidanceX * 0.7;
          moveY += avoidanceY * 0.7;
        }

        const newX = this.x + moveX;
        const newY = this.y + moveY;

        const gridX = Math.floor(newX);
        const gridY = Math.floor(newY);
        if (gridX >= 0 && gridX < COLS && gridY >= 0 && gridY < ROWS &&
          grid[gridY][gridX].state === BURNING) {
          this.stuckTimer++;
          const perpX = -ndy * speed * 0.8;
          const perpY = ndx * speed * 0.8;
          const altX = this.x + perpX;
          const altY = this.y + perpY;
          const agx = Math.floor(altX);
          const agy = Math.floor(altY);
          if (agx >= 0 && agx < COLS && agy >= 0 && agy < ROWS &&
            grid[agy][agx].state !== BURNING) {
            this.x = Math.max(0.5, Math.min(COLS - 1.5, altX));
            this.y = Math.max(0.5, Math.min(ROWS - 1.5, altY));
          }
        } else {
          this.x = Math.max(0.5, Math.min(COLS - 1.5, newX));
          this.y = Math.max(0.5, Math.min(ROWS - 1.5, newY));
          this.stuckTimer = Math.max(0, this.stuckTimer - 1);
        }

        if (this.mode === 'attack' || this.mode === 'firebreak') {
          this.energy = Math.max(20, this.energy - 0.4);
        } else if (this.mode === 'retreat') {
          this.energy = Math.max(15, this.energy - 0.25);
        } else {
          this.energy = Math.min(100, this.energy + 0.5);
        }
      }

      act(grid: Cell[][]) {
        const gx = Math.floor(this.x);
        const gy = Math.floor(this.y);

        if (this.mode === 'attack' && this.waterSupply > EXTINGUISH_COST) {
          let extinguished = 0;
          const r = Math.ceil(EXTINGUISH_RADIUS);
          for (let dr = -r; dr <= r; dr++) {
            for (let dc = -r; dc <= r; dc++) {
              const cr = gy + dr;
              const cc = gx + dc;
              if (cr >= 0 && cr < ROWS && cc >= 0 && cc < COLS) {
                const dist = Math.sqrt(dr * dr + dc * dc);
                if (dist <= EXTINGUISH_RADIUS && grid[cr][cc].state === BURNING) {
                  grid[cr][cc].state = BURNT;
                  grid[cr][cc].burnTimer = 0;
                  grid[cr][cc].regrowTimer = REGROW_THRESHOLD;
                  extinguished++;
                }
              }
            }
          }
          if (extinguished > 0) {
            this.waterSupply -= EXTINGUISH_COST;
          }
        } else if (this.mode === 'firebreak') {
          const r = Math.ceil(FIREBREAK_CLEAR_RADIUS);
          for (let dr = -r; dr <= r; dr++) {
            for (let dc = -r; dc <= r; dc++) {
              const cr = gy + dr;
              const cc = gx + dc;
              if (cr >= 0 && cr < ROWS && cc >= 0 && cc < COLS) {
                const dist = Math.sqrt(dr * dr + dc * dc);
                if (dist <= FIREBREAK_CLEAR_RADIUS) {
                  if (grid[cr][cc].state === TREE || grid[cr][cc].state === EMPTY) {
                    grid[cr][cc].state = FIREBREAK;
                    grid[cr][cc].firebreakTimer = FIREBREAK_DECAY;
                    grid[cr][cc].fuel = 0;
                  }
                }
              }
            }
          }
          this.energy = Math.max(15, this.energy - 0.6);
        }

        if (this.mode !== 'attack') {
          this.waterSupply = Math.min(MAX_WATER, this.waterSupply + WATER_RECHARGE);
        }
        if (this.x < 3 || this.x > COLS - 4 || this.y < 3 || this.y > ROWS - 4) {
          this.waterSupply = Math.min(MAX_WATER, this.waterSupply + WATER_RECHARGE * 2);
        }
      }
    }

    // ── Initialize Forest ───────────────────────────────────────────────────────

    function initializeForest() {
      const coarseRows = 11;
      const coarseCols = 18;
      const coarse: number[][] = [];
      for (let r = 0; r < coarseRows; r++) {
        coarse[r] = [];
        for (let c = 0; c < coarseCols; c++) {
          coarse[r][c] = Math.random();
        }
      }
      for (let pass = 0; pass < 3; pass++) {
        const smoothed = coarse.map(r => [...r]);
        for (let r = 0; r < coarseRows; r++) {
          for (let c = 0; c < coarseCols; c++) {
            let sum = coarse[r][c];
            let count = 1;
            for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
              const nr = r + dr;
              const nc = c + dc;
              if (nr >= 0 && nr < coarseRows && nc >= 0 && nc < coarseCols) {
                sum += coarse[nr][nc];
                count++;
              }
            }
            smoothed[r][c] = sum / count;
          }
        }
        for (let r = 0; r < coarseRows; r++)
          for (let c = 0; c < coarseCols; c++)
            coarse[r][c] = smoothed[r][c];
      }

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cr = Math.floor(r / ROWS * coarseRows);
          const cc = Math.floor(c / COLS * coarseCols);
          const fuelBase = coarse[Math.min(cr, coarseRows - 1)][Math.min(cc, coarseCols - 1)];
          const fuel = 0.25 + fuelBase * 0.7 + Math.random() * 0.1;
          const hasTree = Math.random() < 0.78;
          grid[r][c].state = hasTree ? TREE : EMPTY;
          grid[r][c].fuel = hasTree ? Math.min(1, Math.max(0.2, fuel)) : 0;
          grid[r][c].burnTimer = 0;
          grid[r][c].regrowTimer = 0;
          grid[r][c].firebreakTimer = 0;
        }
      }

      const fireCX = Math.floor(COLS * (0.35 + Math.random() * 0.3));
      const fireCY = Math.floor(ROWS * (0.35 + Math.random() * 0.3));
      const fireRadius = 4 + Math.floor(Math.random() * 5);
      for (let r = fireCY - fireRadius; r <= fireCY + fireRadius; r++) {
        for (let c = fireCX - fireRadius; c <= fireCX + fireRadius; c++) {
          if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
            const dist = Math.sqrt((r - fireCY) ** 2 + (c - fireCX) ** 2);
            if (dist <= fireRadius && grid[r][c].state === TREE && Math.random() < 0.7) {
              grid[r][c].state = BURNING;
              grid[r][c].burnTimer = BURN_DURATION_MIN + Math.floor(Math.random() * (BURN_DURATION_MAX - BURN_DURATION_MIN));
            }
          }
        }
      }
    }

    // ── Initialize Firefighters ───────────────────────────────────────────────────

    const firefighters: FirefighterClass[] = [];
    function initializeFirefighters() {
      firefighters.length = 0;
      const positions: { x: number; y: number }[] = [];
      for (let i = 0; i < 2; i++) {
        positions.push({ x: COLS * (0.2 + i * 0.6), y: 3 + Math.random() * 4 });
      }
      for (let i = 0; i < 1; i++) {
        positions.push({ x: COLS * (0.25 + i * 0.5), y: ROWS - 4 - Math.random() * 4 });
      }
      for (let i = 0; i < 1; i++) {
        positions.push({ x: 3 + Math.random() * 4, y: ROWS * (0.3 + i * 0.4) });
      }
      for (let i = 0; i < 1; i++) {
        positions.push({ x: COLS - 4 - Math.random() * 4, y: ROWS * (0.3 + i * 0.4) });
      }
      while (positions.length < NUM_FIREFIGHTERS) {
        positions.push({ x: 5 + Math.random() * (COLS - 10), y: 5 + Math.random() * (ROWS - 10) });
      }
      const selected = positions.slice(0, NUM_FIREFIGHTERS);
      for (const pos of selected) {
        firefighters.push(new FirefighterClass(pos.x, pos.y));
      }
    }

    // ── Collect Burning Cells ───────────────────────────────────────────────────

    function collectBurningCells(): BurningCell[] {
      const burning: BurningCell[] = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (grid[r][c].state === BURNING) {
            burning.push({ r, c });
          }
        }
      }
      return burning;
    }

    // ── Update Simulation ───────────────────────────────────────────────────────

    function updateSimulation(): BurningCell[] {
      updateWind();
      const windVec = getWindVector();
      const burningCells = collectBurningCells();

      const newIgnitions: BurningCell[] = [];
      for (const { r, c } of burningCells) {
        if (grid[r][c].burnTimer <= 0) continue;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
            if (grid[nr][nc].state !== TREE) continue;

            const isDiagonal = (Math.abs(dr) + Math.abs(dc)) > 1;
            const dist = Math.sqrt(dr * dr + dc * dc);
            const ndx = dc / dist;
            const ndy = dr / dist;

            const alignment = ndx * windVec.dx + ndy * windVec.dy;

            let prob = BASE_SPREAD_PROB;
            prob += alignment * wind.speed * WIND_INFLUENCE;
            prob *= (grid[nr][nc].fuel * FUEL_INFLUENCE + 0.3);
            if (isDiagonal) prob *= DIAGONAL_FACTOR;
            prob = Math.max(0.008, Math.min(0.88, prob));

            if (Math.random() < prob) {
              newIgnitions.push({ r: nr, c: nc });
            }
          }
        }
      }

      for (const { r, c } of newIgnitions) {
        if (grid[r][c].state === TREE) {
          grid[r][c].state = BURNING;
          grid[r][c].burnTimer = BURN_DURATION_MIN + Math.floor(Math.random() * (BURN_DURATION_MAX - BURN_DURATION_MIN));
        }
      }

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (grid[r][c].state === BURNING) {
            grid[r][c].burnTimer--;
            if (grid[r][c].burnTimer <= 0) {
              grid[r][c].state = BURNT;
              grid[r][c].regrowTimer = REGROW_THRESHOLD;
              grid[r][c].fuel = 0;
            }
          }
        }
      }

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (grid[r][c].state === FIREBREAK) {
            grid[r][c].firebreakTimer--;
            if (grid[r][c].firebreakTimer <= 0) {
              grid[r][c].state = EMPTY;
              grid[r][c].fuel = 0;
            }
          }
        }
      }

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (grid[r][c].state === BURNT || grid[r][c].state === EMPTY) {
            if (grid[r][c].regrowTimer > 0) {
              grid[r][c].regrowTimer--;
            } else if (Math.random() < REGROW_CHANCE) {
              let fireNearby = false;
              for (let dr = -2; dr <= 2 && !fireNearby; dr++) {
                for (let dc = -2; dc <= 2 && !fireNearby; dc++) {
                  const cr = r + dr;
                  const cc = c + dc;
                  if (cr >= 0 && cr < ROWS && cc >= 0 && cc < COLS &&
                    grid[cr][cc].state === BURNING) {
                    fireNearby = true;
                  }
                }
              }
              if (!fireNearby) {
                grid[r][c].state = TREE;
                grid[r][c].fuel = 0.15 + Math.random() * 0.35;
                grid[r][c].burnTimer = 0;
                grid[r][c].regrowTimer = 0;
                grid[r][c].firebreakTimer = 0;
              }
            }
          }
          if (grid[r][c].state === TREE && grid[r][c].fuel < 0.95 && Math.random() < 0.003) {
            grid[r][c].fuel = Math.min(0.95, grid[r][c].fuel + 0.02);
          }
        }
      }

      const currentBurning = collectBurningCells();
      if (currentBurning.length === 0 && Math.random() < 0.004) {
        const lr = Math.floor(Math.random() * ROWS);
        const lc = Math.floor(Math.random() * COLS);
        if (grid[lr][lc].state === TREE && grid[lr][lc].fuel > 0.4) {
          grid[lr][lc].state = BURNING;
          grid[lr][lc].burnTimer = BURN_DURATION_MIN + Math.floor(Math.random() * (BURN_DURATION_MAX - BURN_DURATION_MIN));
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = lr + dr;
              const nc = lc + dc;
              if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS &&
                grid[nr][nc].state === TREE && Math.random() < 0.5) {
                grid[nr][nc].state = BURNING;
                grid[nr][nc].burnTimer = BURN_DURATION_MIN + Math.floor(Math.random() * (BURN_DURATION_MAX - BURN_DURATION_MIN));
              }
            }
          }
        }
      }

      const updatedBurning = collectBurningCells();
      for (const ff of firefighters) {
        ff.assess(grid, windVec, updatedBurning);
        ff.move(grid, updatedBurning);
        ff.act(grid);
      }

      return updatedBurning;
    }

    // ── Render ─────────────────────────────────────────────────────────────────

    function render(burningCells: BurningCell[]) {
      ctx.fillStyle = '#0d0d0d';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = grid[r][c];
          const px = c * CELL_SIZE;
          const py = r * CELL_SIZE;

          switch (cell.state) {
            case EMPTY:
              ctx.fillStyle = '#2a2218';
              ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
              break;
            case TREE:
              const g = Math.floor(60 + cell.fuel * 100);
              const rb = Math.floor(20 + cell.fuel * 30);
              ctx.fillStyle = `rgb(${rb},${g},${Math.floor(rb * 0.7)})`;
              ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
              if ((r + c) % 5 === 0) {
                ctx.fillStyle = `rgba(255,255,255,0.04)`;
                ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
              }
              break;
            case BURNING:
              const progress = cell.burnTimer / BURN_DURATION_MAX;
              if (progress > 0.6) {
                const red = 255;
                const green = Math.floor(140 + progress * 80);
                const blue = Math.floor(20 * progress);
                ctx.fillStyle = `rgb(${red},${green},${blue})`;
              } else if (progress > 0.3) {
                const red = 220 + Math.floor(Math.random() * 35);
                const green = Math.floor(70 + progress * 60);
                ctx.fillStyle = `rgb(${red},${green},${Math.floor(10 + Math.random() * 15)})`;
              } else {
                const red = 150 + Math.floor(Math.random() * 50);
                ctx.fillStyle = `rgb(${red},${Math.floor(20 + Math.random() * 25)},${Math.floor(Math.random() * 10)})`;
              }
              ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
              if (progress > 0.4) {
                ctx.fillStyle = `rgba(255,200,50,0.25)`;
                ctx.fillRect(px - 0.5, py - 0.5, CELL_SIZE + 1, CELL_SIZE + 1);
              }
              break;
            case BURNT:
              const shade = 35 + Math.floor(Math.random() * 20);
              ctx.fillStyle = `rgb(${shade},${Math.floor(shade * 0.9)},${Math.floor(shade * 0.8)})`;
              ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
              break;
            case FIREBREAK:
              ctx.fillStyle = '#b8956e';
              ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
              if ((r + c) % 3 === 0) {
                ctx.fillStyle = '#c8a880';
                ctx.fillRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
              }
              break;
          }
        }
      }

      for (const ff of firefighters) {
        const fx = ff.x * CELL_SIZE;
        const fy = ff.y * CELL_SIZE;
        const radius = 5;

        const glowGrad = ctx.createRadialGradient(fx, fy, radius * 0.5, fx, fy, radius * 2.2);
        if (ff.mode === 'attack') {
          glowGrad.addColorStop(0, 'rgba(100,180,255,0.9)');
          glowGrad.addColorStop(0.5, 'rgba(60,140,240,0.5)');
          glowGrad.addColorStop(1, 'rgba(30,80,200,0)');
        } else if (ff.mode === 'retreat') {
          glowGrad.addColorStop(0, 'rgba(255,180,80,0.9)');
          glowGrad.addColorStop(0.5, 'rgba(240,140,40,0.5)');
          glowGrad.addColorStop(1, 'rgba(200,80,20,0)');
        } else if (ff.mode === 'firebreak') {
          glowGrad.addColorStop(0, 'rgba(200,220,100,0.9)');
          glowGrad.addColorStop(0.5, 'rgba(170,190,70,0.5)');
          glowGrad.addColorStop(1, 'rgba(140,160,40,0)');
        } else {
          glowGrad.addColorStop(0, 'rgba(150,200,240,0.8)');
          glowGrad.addColorStop(0.5, 'rgba(100,160,220,0.4)');
          glowGrad.addColorStop(1, 'rgba(50,100,180,0)');
        }
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(fx, fy, radius * 2.2, 0, Math.PI * 2);
        ctx.fill();

        const bodyGrad = ctx.createRadialGradient(fx - 1, fy - 1, radius * 0.2, fx, fy, radius);
        bodyGrad.addColorStop(0, '#c8e0ff');
        bodyGrad.addColorStop(0.6, '#4488cc');
        bodyGrad.addColorStop(1, '#1a3d5c');
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.arc(fx, fy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        const dirX = ff.targetX - ff.x;
        const dirY = ff.targetY - ff.y;
        const dirDist = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
        const ndx = dirX / dirDist;
        const ndy = dirY / dirDist;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + ndx * radius * 1.8, fy + ndy * radius * 1.8);
        ctx.stroke();

        const dotColors: { [key: string]: string } = {
          'attack': '#ff6644',
          'retreat': '#ffaa00',
          'firebreak': '#ccdd44',
          'approach': '#88ccff',
          'patrol': '#88aacc',
        };
        ctx.fillStyle = dotColors[ff.mode] || '#fff';
        ctx.beginPath();
        ctx.arc(fx + ndx * radius * 1.8, fy + ndy * radius * 1.8, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      const arrowX = CANVAS_WIDTH - 50;
      const arrowY = 35;
      const windVec = getWindVector();
      const windSpeedNorm = wind.speed;
      const arrowLen = 18 + windSpeedNorm * 22;

      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = '#c8ddf0';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(arrowX - windVec.dx * arrowLen * 0.4, arrowY - windVec.dy * arrowLen * 0.4);
      ctx.lineTo(arrowX + windVec.dx * arrowLen * 0.6, arrowY + windVec.dy * arrowLen * 0.6);
      ctx.stroke();
      const tipX = arrowX + windVec.dx * arrowLen * 0.6;
      const tipY = arrowY + windVec.dy * arrowLen * 0.6;
      const perpX = -windVec.dy;
      const perpY = windVec.dx;
      ctx.fillStyle = '#d8e8f8';
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - windVec.dx * 10 + perpX * 6, tipY - windVec.dy * 10 + perpY * 6);
      ctx.lineTo(tipX - windVec.dx * 10 - perpX * 6, tipY - windVec.dy * 10 - perpY * 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ── Main Loop ───────────────────────────────────────────────────────────────

    let tickAccumulator = 0;
    let lastTime = performance.now();
    let tickCount = 0;
    let burningCells: BurningCell[] = [];

    function gameLoop(timestamp: number) {
      const dt = timestamp - lastTime;
      lastTime = timestamp;
      tickAccumulator += dt;

      while (tickAccumulator >= TICK_INTERVAL_MS) {
        tickAccumulator -= TICK_INTERVAL_MS;
        tickCount++;
        burningCells = updateSimulation();
      }

      render(burningCells);
      animationRef.current = requestAnimationFrame(gameLoop);
    }

    // ── Start ───────────────────────────────────────────────────────────────────

    initializeForest();
    initializeFirefighters();
    burningCells = collectBurningCells();
    scheduleWindShift();
    lastTime = performance.now();
    animationRef.current = requestAnimationFrame(gameLoop);

    // ── Cleanup ───────────────────────────────────────────────────────────────

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return <canvas ref={canvasRef} className="wildfire-background" />;
};
