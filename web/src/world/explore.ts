import { CAMP_SITES, CORE_BOUNDS, EXPLORATION_SITES, MAP, OUTER_LOOP } from './map.js';
import type { Position } from './model.js';

/** The journal and minimap share one discovery taxonomy. */
export type DiscoveryKind = 'cave' | 'ruin' | 'shrine' | 'camp';
export interface DiscoverySite {
  id: string; kind: DiscoveryKind; position: Position; label: string;
}
export const DISCOVERY_SITES: DiscoverySite[] = [...EXPLORATION_SITES, ...CAMP_SITES].map(site => ({
  id: site.id, kind: site.kind, position: { ...site.position }, label: site.label,
}));
export const DISCOVERY_GROUPS: ReadonlyArray<{ kind: DiscoveryKind; label: string }> = [
  { kind: 'cave', label: 'CAVES' },
  { kind: 'ruin', label: 'RUINS' },
  { kind: 'shrine', label: 'SHRINES' },
  { kind: 'camp', label: 'CAMPS' },
];
/**
 * Discovery state is deliberately per-browser. The world account API already
 * stores position and appearance, but not exploration history, so this uses the
 * same visitor-local mechanism as settings without inventing a second database.
 */
export const DISCOVERY_STORAGE_KEY = 'agent-world-discoveries-v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
/** Only known exploration ids survive a reload; edited or stale storage is ignored. */
export function parseDiscoveryList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(DISCOVERY_SITES.map(site => site.id));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !known.has(item) || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}
export function loadDiscoveries(storage: StorageLike | null = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(DISCOVERY_STORAGE_KEY);
    return raw ? parseDiscoveryList(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}
export function saveDiscoveries(ids: Iterable<string>, storage: StorageLike | null = browserStorage()): string[] {
  const value = parseDiscoveryList([...ids]);
  try {
    storage?.setItem(DISCOVERY_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private browsing can reject storage writes. The in-memory list still works.
  }
  return value;
}
export interface DiscoveryEntry { id: string; label: string; discovered: boolean }
export interface DiscoveryGroup {
  kind: DiscoveryKind; label: string; total: number; discoveredCount: number;
  entries: DiscoveryEntry[];
}
export function discoveryGroups(discovered: ReadonlySet<string>): DiscoveryGroup[] {
  return DISCOVERY_GROUPS.map(group => {
    const sites = DISCOVERY_SITES.filter(site => site.kind === group.kind);
    return {
      kind: group.kind, label: group.label, total: sites.length,
      discoveredCount: sites.filter(site => discovered.has(site.id)).length,
      entries: sites.map(site => ({ id: site.id, label: site.label, discovered: discovered.has(site.id) })),
    };
  });
}

/** Broad orientation only. Names are anchored to the existing map geography. */
export type RegionId = 'city' | 'north' | 'south' | 'west' | 'east';
export const REGIONS: Record<RegionId, string> = {
  city: 'CITY CENTER', north: 'NORTH OUTCROP', south: 'SOUTH PERIMETER',
  west: 'WEST WOODS', east: 'EAST INDUSTRIAL',
};
export function regionAt(position: Position): RegionId {
  const insideCore = position.x >= CORE_BOUNDS.minX && position.x <= CORE_BOUNDS.maxX
    && position.y >= CORE_BOUNDS.minY && position.y <= CORE_BOUNDS.maxY;
  if (insideCore) return 'city';
  const overshoot: Array<[RegionId, number]> = [
    ['north', CORE_BOUNDS.minY - position.y],
    ['south', position.y - CORE_BOUNDS.maxY],
    ['west', CORE_BOUNDS.minX - position.x],
    ['east', position.x - CORE_BOUNDS.maxX],
  ];
  return overshoot.reduce((best, next) => next[1] > best[1] ? next : best)[0];
}
export function regionLabel(position: Position): string {
  return REGIONS[regionAt(position)];
}

/** Static minimap projection. The widget caches the terrain once and only
 * redraws this small marker layer, never the full 4800×3456 world canvas. */
export const MINIMAP_WIDTH = 208;
export const MINIMAP_HEIGHT = 150;
export const MINIMAP_PADDING = 5;
export function minimapPoint(position: Position): { x: number; y: number } {
  const width = MINIMAP_WIDTH - MINIMAP_PADDING * 2;
  const height = MINIMAP_HEIGHT - MINIMAP_PADDING * 2;
  return {
    x: MINIMAP_PADDING + ((position.x - MAP.minX) / MAP.width) * width,
    y: MINIMAP_PADDING + ((position.y - MAP.minY) / MAP.height) * height,
  };
}
export interface MapMarker {
  id: string; label: string; kind: DiscoveryKind | 'city'; position: Position;
  /** Small label offset keeps dense city markers readable on the tiny map. */
  labelOffset?: readonly [number, number];
}
/** Major city destinations are public knowledge and always visible. */
export const CITY_MAP_MARKERS: ReadonlyArray<MapMarker> = [
  { id: 'plaza', label: '', kind: 'city', position: { ...MAP.spawn } },
  { id: 'arena-door', label: 'ARENA', kind: 'city', position: { x: 928, y: 674 }, labelOffset: [9, -2] },
  { id: 'compound-entrance', label: 'CMPD', kind: 'city', position: { x: -220, y: 994 }, labelOffset: [-10, 1] },
  { id: 'south-market', label: 'MKT', kind: 'city', position: { x: 681, y: 1292 }, labelOffset: [7, 3] },
  { id: 'archive', label: 'LAB', kind: 'city', position: { x: 560, y: 790 }, labelOffset: [-8, -1] },
  { id: 'agent-agency', label: 'AGY', kind: 'city', position: { x: 1568, y: 318 }, labelOffset: [1, -5] },
  { id: 'treasury-house', label: 'VLT', kind: 'city', position: { x: 1105, y: 1292 }, labelOffset: [8, 3] },
];
/** Outer landmarks appear only after the visitor has interacted with them. */
export function minimapMarkers(discovered: ReadonlySet<string>): MapMarker[] {
  return [
    ...CITY_MAP_MARKERS.map(marker => ({ ...marker, position: { ...marker.position } })),
    ...DISCOVERY_SITES.filter(site => discovered.has(site.id))
      .map(site => ({ id: site.id, label: site.label.toUpperCase(), kind: site.kind, position: { ...site.position } })),
  ];
}
/** Only visitors close enough to matter are plotted; canonical agents never are. */
export function nearbyHumans(player: Position, humans: ReadonlyArray<Position>, radius = 760): Position[] {
  return humans.filter(human => Math.hypot(human.x - player.x, human.y - player.y) <= radius)
    .map(human => ({ x: human.x, y: human.y }));
}
/** Cached base geometry: boundary, city footprint, outer loop and connectors. */
export const MINIMAP_PATHS: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }> = [
  { x1: OUTER_LOOP.left, y1: OUTER_LOOP.top, x2: OUTER_LOOP.right, y2: OUTER_LOOP.top },
  { x1: OUTER_LOOP.left, y1: OUTER_LOOP.bottom, x2: OUTER_LOOP.right, y2: OUTER_LOOP.bottom },
  { x1: OUTER_LOOP.left, y1: OUTER_LOOP.top, x2: OUTER_LOOP.left, y2: OUTER_LOOP.bottom },
  { x1: OUTER_LOOP.right, y1: OUTER_LOOP.top, x2: OUTER_LOOP.right, y2: OUTER_LOOP.bottom },
];
export function isKnownDiscovery(id: string): boolean {
  return DISCOVERY_SITES.some(site => site.id === id);
}
