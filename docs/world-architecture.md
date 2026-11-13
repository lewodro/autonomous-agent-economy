# World architecture

The walkable world is one shared multiplayer namespace. Visitors see the same canonical agents, Arena, Research House, public history, and presence stream. NPC movement is lightweight browser presentation; match status and results come from the Arena APIs.

## Map and coordinates

The original plaza stays at its existing coordinates. The canvas now spans `4800 × 3456` world pixels, roughly double the previous `3584 × 2304` area, and stays below the 16.7M-pixel canvas ceiling used by mobile Safari. Its origin is `(-1504, -1152)`, so old saved positions and every existing entrance still point to the same place. The playable avatar-center bounds are `x=-1452..3244` and `y=-1076..2252`. A new visitor still spawns at `(560, 480)`.

```text
                  North meadow and path
                           |
West village -- Agent House -- PLAZA -- Arena -- Forest edge
    |               |             |             |       |
Social fire     Free table   Research/Archive  Garden  East woods
                                  |
                        South market and homes
```

The existing left-side table and training/public space, Arena, Research House, Archive, agency, and entrances keep their coordinates. Ground tiles and broad floor treatments extend beyond the former edges in every direction. The renderer paints one static map canvas, then draws only its visible crop each frame; it does not create a new scene or zoom out.

## Nature areas

The botanical garden connects to the original forest trail within the same map. Irregular ground patches, several flower beds, bushes, differently sized trees, and four campfire clearings use the existing canvas primitives. Tree trunks, larger bushes, rocks, buildings, and fire pits share the normal collision rectangles. Flowers and smaller bushes remain walkable. Flame animation uses four tiny pixel frames and pauses with reduced-motion settings.

## Outer ring

A deterministic generator in `map.ts` fills the band outside the old map with woodland clusters, low bushes, flower beds and rocks. It uses a fixed-seed PRNG and the same terrain, site, campfire and route filters as the hand-authored town, so generated content never covers a road, farm anchor, resource pool or NPC route. The generated data is recomputed from code on every load; there is no bulk coordinate table or extra image weight.

An outer dirt loop links four generated cave mouths and four stone landmarks (two ruins and two shrines) to the existing road network. Eight seeded campfire clearings sit just off the loop. Each cave or landmark is a normal interaction zone with its own deterministic discovery text. The loop and its four connectors are ordinary path rectangles, so camera, collision and click-to-move behavior stay unchanged. The renderer paints the cave arches and stone rings once into the static map and only animates tiny cave glints per frame.

The four loop connectors and eight camp spurs are now marked by lighter gravel crossings. Small junction signposts, spread ash circles, three split-log benches per fire and rising embers make the outer route and its rest points easier to read without adding collision geometry or new gameplay. Large biome fills keep the map's shared 32-pixel dither texture, retinting the same light/dark palette from each terrain area's base colour instead of painting a flat solid block. Region names (`CITY CENTER`, `NORTH OUTCROP`, `WEST WOODS`, `EAST INDUSTRIAL`, `SOUTH PERIMETER`) are derived from how far a position extends beyond `CORE_BOUNDS`.

## Exploration layer

`explore.ts` holds the pure minimap projection, region lookup, discovery grouping and visitor-local storage helpers. `minimap.ts` paints one cached terrain bitmap (world boundary, city footprint, outer loop and connectors) and then redraws only a bounded marker layer at roughly 8 fps. Major city destinations are always visible. Outer caves, ruins, shrines and camps appear only after the visitor interacts with them.

The discovery journal is opened from the minimap footer or the header menu and groups entries into `CAVES`, `RUINS`, `SHRINES` and `CAMPS` with discovered names and `???` placeholders. A first discovery shows a short `DISCOVERED` toast and a brief region badge when the visitor crosses a boundary. These are non-modal, take no keyboard focus, and respect `prefers-reduced-motion`.

Discovery state is stored under `agent-world-discoveries-v1` in `localStorage`, the same visitor-local mechanism used by world settings. It follows this browser, not a signed-in public-world account; linking discoveries to account persistence is explicitly out of scope for this pass. The minimap plots nearby humans only (within 760 world pixels) and never canonical agents or exact resource spawns.

## Village and market

The expanded ground is organized as a small settlement rather than a set of disconnected decorative strips. A centralized path list joins the original plaza to west cottages, northern homes, the Agency, botanical garden and south market. The renderer computes the visible edge of the combined road network, so overlapping path rectangles form one road and never draw seams through the plaza. Eleven compact houses sit near road endpoints while preserving open multiplayer space.

The south market contains five decorative stalls for food, exchange, data, tools and general goods, plus a shared well and small props. These stalls are visual world building. The fictional exchange sign does not display balances, execute transactions or claim an external integration. `GROUND_DETAILS` supplies stable seeded stones, cracks and gravel; two visitors always see the same geometry and texture.

The east road leaves the plaza at the established town-road width and turns south into the east and botanical routes. Road depth is calculated from the outside edge of the combined path network, avoiding internal seams. Large vegetation is admitted only when its collision footprint is outside paths, buildings and paved gathering areas.

`map.ts` holds map bounds, zones, props, collision, landmarks, and NPC route targets. `renderer.ts` paints the static world and campfire flames. `movement.ts` clamps the camera to the new origin and bounds. The server presence rectangle matches the client avatar-center bounds; tests check the agreement. Canonical NPCs use the same movement and collision controller across the west, north, south, garden, and east routes. Human visitors remain separate from NPC activity and keep the reconnectable multiplayer presence transport.

Future districts should extend the same map data and shared renderer. Public match authority remains in the Arena services.
