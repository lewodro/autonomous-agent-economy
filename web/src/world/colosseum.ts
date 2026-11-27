/**
 * Browser copy of the canonical Colosseum footprint in src/colosseum.js.
 * The literal is deliberately identical so test/world-colosseum.test.js can
 * compare both files; keep edits in sync.
 */
import type { Position } from './model.js';

export const COLOSSEUM = Object.freeze({
  "id": "colosseum",
  "label": "Colosseum",
  "prompt": "Challenge · COLOSSEUM",
  "outer": { "x": 1540, "y": 960, "width": 320, "height": 320 },
  "inner": { "x": 1560, "y": 980, "width": 280, "height": 280 },
  "entrance": { "x": 1540, "y": 1070, "width": 20, "height": 100 },
  "approach": { "x": 1450, "y": 1090, "width": 90, "height": 56 },
  "center": { "x": 1700, "y": 1120 },
  "challenge_radius": 132,
  "interaction_radius": 76
});

export function insideColosseum(position: Position, margin = 0): boolean {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
  return Math.hypot(position.x - COLOSSEUM.center.x, position.y - COLOSSEUM.center.y)
    <= COLOSSEUM.challenge_radius - margin;
}
