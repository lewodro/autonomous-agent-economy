import { safePosition } from './map.js';
import type { Position } from './model.js';
export interface SpriteDefinition {
  id: string; sheet: string; frameWidth: number; frameHeight: number;
  animations: Record<string, number[]>;
}
const slugs = ['founder','trader','gambler','analyst','defender','strategist','social','degen','conservative','aggressive','explorer','builder','quant','random','tournament','mentor','rival','observer','adaptive','wild-card'];
/** Existing art is a complete single-frame character. Sheets can replace entries without actor changes. */
export const SPRITES: SpriteDefinition[] = slugs.map((id,i)=>({ id, sheet:`/assets/sprites-agent/${String(i+1).padStart(2,'0')}-${id}.png`,
  frameWidth:16,frameHeight:16,animations:{ idle_down:[0],idle_up:[0],idle_left:[0],idle_right:[0],walk_down:[0],walk_up:[0],walk_left:[0],walk_right:[0] } }));
export const AVATARS = ['founder','trader','explorer','mentor'];
export interface PlayerSettings { version:1; avatar:string; position:Position; muted:boolean }
export function parseSettings(value: unknown): PlayerSettings {
  const input = value && typeof value==='object' ? value as Partial<PlayerSettings> : {};
  return {version:1,avatar:typeof input.avatar==='string'&&AVATARS.includes(input.avatar)?input.avatar:'explorer',position:safePosition(input.position),muted:input.muted!==false};
}
export function loadSettings(): PlayerSettings {
  try{return parseSettings(JSON.parse(localStorage.getItem('agent-world-settings-v1')||'null'));}catch{return parseSettings(null);}
}
export function saveSettings(settings:PlayerSettings): void {
  try { localStorage.setItem('agent-world-settings-v1',JSON.stringify(parseSettings(settings))); } catch { /* Play still works with storage disabled. */ }
}
