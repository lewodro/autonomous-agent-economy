/**
 * One small, shared conversion between world units and in-world metres.
 *
 * The world keeps its original plaza coordinates and a 32-unit tile. A tile
 * reads as roughly a two-metre step, so 16 world units = 1 metre. This is the
 * only place the conversion lives: UI proximity rules import the resulting
 * radii instead of scattering pixel thresholds through the frontend.
 */
export const WORLD_UNITS_PER_METER = 16;

export function metersToWorldUnits(meters: number): number {
  return meters * WORLD_UNITS_PER_METER;
}

/** Contextual farm interaction/help must not appear until the visitor is close. */
export const FARM_GUIDANCE_RADIUS = metersToWorldUnits(20);

/** True when a world-space target is inside the 20m contextual guidance range. */
export function withinFarmGuidance(player: {x: number; y: number}, target: {x: number; y: number}): boolean {
  return Math.hypot(player.x - target.x, player.y - target.y) <= FARM_GUIDANCE_RADIUS;
}
