import { normalizeInput, type Position, type Rect, type WorldActor, type WorldInput } from './model.js';
import { collides, WALLS, MAP } from './map.js';
/** Small substeps prevent tunnelling; per-axis resolution permits wall sliding. */
export function moveActor(actor: WorldActor, input: WorldInput, seconds: number, speed = 150, walls: Rect[] = WALLS): void {
  const direction = normalizeInput(input.x, input.y);
  const dt = Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, 0.1)) : 0;
  const dx = direction.x * speed * dt, dy = direction.y * speed * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
  const previous = { ...actor.position };
  for (let n = 0; n < steps; n++) {
    const x = { x: actor.position.x + dx / steps, y: actor.position.y };
    if (!collides(x, walls)) actor.position.x = x.x;
    const y = { x: actor.position.x, y: actor.position.y + dy / steps };
    if (!collides(y, walls)) actor.position.y = y.y;
  }
  actor.movementState = previous.x === actor.position.x && previous.y === actor.position.y ? 'idle' : 'walking';
  if (direction.x || direction.y) actor.facing = Math.abs(direction.x) > Math.abs(direction.y)
    ? direction.x > 0 ? 'right' : 'left' : direction.y > 0 ? 'down' : 'up';
}
export function followCamera(camera: Position, player: Position, width: number, height: number, seconds: number): Position {
  const target = { x: Math.max(0, Math.min(MAP.width - width, player.x - width / 2)),
    y: Math.max(0, Math.min(MAP.height - height, player.y - height / 2)) };
  const blend = 1 - Math.exp(-8 * Math.max(0, seconds));
  return { x: camera.x + (target.x - camera.x) * blend, y: camera.y + (target.y - camera.y) * blend };
}
