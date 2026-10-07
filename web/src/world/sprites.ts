import { safePosition } from './map.js';
import type { Position } from './model.js';
export interface SpriteDefinition {
  id: string; sheet: string; frameWidth: number; frameHeight: number;
  preview?:string;
  selectable?:boolean;
  animations: Record<string, number[]>;
}
const slugs = ['founder','trader','gambler','analyst','defender','strategist','social','degen','conservative','aggressive','explorer','builder','quant','random','tournament','mentor','rival','observer','adaptive','wild-card'];
/** Existing art is a complete single-frame character. Sheets can replace entries without actor changes. */
export const SPRITES: SpriteDefinition[] = slugs.map((id,i)=>({ id, sheet:`/assets/sprites-agent/${String(i+1).padStart(2,'0')}-${id}.png`,
  frameWidth:16,frameHeight:16,animations:{ idle_down:[0],idle_up:[0],idle_left:[0],idle_right:[0],walk_down:[0],walk_up:[0],walk_left:[0],walk_right:[0] } }));
for(const name of ['ember','atlas','nova','echo'])SPRITES.push({id:'visitor_'+name,sheet:`/assets/aae_avatar_kit/examples/${name}.png`,preview:`/assets/aae_avatar_kit/examples/${name}_preview.png`,frameWidth:32,frameHeight:32,selectable:true,
  animations:{idle_down:[0],idle_left:[3],idle_right:[6],idle_up:[9],walk_down:[0,1,2],walk_left:[3,4,5],walk_right:[6,7,8],walk_up:[9,10,11]}});
/** Only reviewed visitor assets are selectable; agent portraits remain NPC-only. */
export const AVATARS = SPRITES.filter(sprite=>sprite.selectable===true&&sprite.id.startsWith('visitor_')&&!!sprite.preview).map(sprite=>sprite.id);
export interface PlayerSettings { version:1; avatar:string; position:Position; muted:boolean }
export function parseSettings(value: unknown): PlayerSettings {
  const input = value && typeof value==='object' ? value as Partial<PlayerSettings> : {};
  return {version:1,avatar:typeof input.avatar==='string'&&AVATARS.includes(input.avatar)?input.avatar:'visitor_ember',position:safePosition(input.position),muted:input.muted!==false};
}
export function loadSettings(): PlayerSettings {
  try{return parseSettings(JSON.parse(localStorage.getItem('agent-world-settings-v1')||'null'));}catch{return parseSettings(null);}
}
export function saveSettings(settings:PlayerSettings): void {
  try { localStorage.setItem('agent-world-settings-v1',JSON.stringify(parseSettings(settings))); } catch { /* Play still works with storage disabled. */ }
}
