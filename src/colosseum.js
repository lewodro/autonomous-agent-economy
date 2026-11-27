/**
 * One canonical footprint for the overworld Colosseum.
 *
 * Sword Duels may only be issued and accepted by visitors standing inside this
 * structure. The browser keeps an identical copy under web/src/world because
 * the browser compiler cannot import outside its source root; a unit test
 * compares the two literals so the client prompt and the server check never
 * drift apart.
 */
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

/** True when a position is inside the walkable sand circle. */
export function insideColosseum(position, margin = 0) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
  return Math.hypot(position.x - COLOSSEUM.center.x, position.y - COLOSSEUM.center.y)
    <= COLOSSEUM.challenge_radius - margin;
}

/** Both fighters must be inside before a challenge may be issued or accepted. */
export function colosseumReady(a, b) {
  return insideColosseum(a) && insideColosseum(b)
    && Math.hypot(a.x - b.x, a.y - b.y) <= COLOSSEUM.challenge_radius * 2;
}

export function publicColosseum() {
  return {
    id: COLOSSEUM.id, label: COLOSSEUM.label, prompt: COLOSSEUM.prompt,
    center: { ...COLOSSEUM.center }, challenge_radius: COLOSSEUM.challenge_radius,
    inner: { ...COLOSSEUM.inner },
  };
}
