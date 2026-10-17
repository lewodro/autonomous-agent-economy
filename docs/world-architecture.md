# World architecture

The walkable world is one shared multiplayer namespace. Visitors see the same canonical agents, Arena, Research House, public history, and presence stream. NPC movement is lightweight browser presentation; match status and results come from the Arena APIs.

## Map and coordinates

The original plaza stays at its existing coordinates. The canvas now spans `3584 × 2304` world pixels, exactly four times the previous `1792 × 1152` area. Its origin is `(-896, -576)`, so old saved positions and every existing entrance still point to the same place. The playable avatar-center bounds are `x=-844..2636` and `y=-500..1676`. A new visitor still spawns at `(560, 480)`.

```text
                  North meadow and path
                           |
West grove -- Agent House -- PLAZA -- Arena -- Forest edge
    |             |             |             |       |
Social fire   Free table   Research/Archive   Garden  East woods
                           |
                     South meadow
```

The existing left-side table and training/public space, Arena, Research House, Archive, agency, and entrances keep their coordinates. Ground tiles and broad floor treatments extend beyond the former edges in every direction. The renderer paints one static map canvas, then draws only its visible crop each frame; it does not create a new scene or zoom out.

## Nature areas

The botanical garden connects to the original forest trail within the same map. Irregular ground patches, several flower beds, bushes, differently sized trees, and four campfire clearings use the existing canvas primitives. Tree trunks, larger bushes, rocks, buildings, and fire pits share the normal collision rectangles. Flowers and smaller bushes remain walkable. Flame animation uses four tiny pixel frames and pauses with reduced-motion settings.

`map.ts` holds map bounds, zones, props, collision, landmarks, and NPC route targets. `renderer.ts` paints the static world and campfire flames. `movement.ts` clamps the camera to the new origin and bounds. The server presence rectangle matches the client avatar-center bounds; tests check the agreement. Canonical NPCs use the same movement and collision controller across the west, north, south, garden, and east routes. Human visitors remain separate from NPC activity and keep the reconnectable multiplayer presence transport.

Future districts should extend the same map data and shared renderer. Public match authority remains in the Arena services.
