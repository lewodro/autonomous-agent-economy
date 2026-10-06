export interface Position { x: number; y: number }
export type Facing = 'down' | 'up' | 'left' | 'right';
export interface WorldActor {
  id: string;
  type: 'human' | 'npc' | 'external_agent' | 'mcp_agent';
  name: string;
  agentId?: string;
  position: Position;
  facing: Facing;
  movementState: 'idle' | 'walking';
  spriteId: string;
  activity: string;
  recentWinner: boolean;
}
export interface WorldInput { x: number; y: number; interact: boolean }
export interface InputSource { read(): WorldInput; reset(): void; destroy(): void }
export type WorldEvent =
  | { type: 'world:actor-moved'; actorId: string; position: Position }
  | { type: 'world:actor-interacted'; actorId: string; targetId: string }
  | { type: 'world:entered-arena'; actorId: string };
export interface Rect extends Position { width: number; height: number }
export interface Interactable {
  id: string; position: Position; radius: number;
  type: 'arena' | 'table' | 'agent' | 'research'; label: string;
}
export function normalizeInput(x: number, y: number, interact = false): WorldInput {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0, interact };
  const scale = Math.max(1, Math.hypot(x, y));
  return { x: x / scale, y: y / scale, interact };
}
export function nearestInteraction(position: Position, targets: Interactable[]): Interactable | undefined {
  return targets.filter(t => Math.hypot(t.position.x - position.x, t.position.y - position.y) <= t.radius)
    .sort((a, b) => Math.hypot(a.position.x - position.x, a.position.y - position.y)
      - Math.hypot(b.position.x - position.x, b.position.y - position.y))[0];
}
