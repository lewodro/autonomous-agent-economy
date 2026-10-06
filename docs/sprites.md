# World sprites and avatar kit

The world loads sprites from a manifest in `web/src/world/sprites.ts`. Actor logic stores a registered `spriteId`; it never infers actor identity or behavior from a filename. The complete agent portraits in `assets/sprites-agent` remain the NPC art source. The avatar selection also uses the four assembled examples in `assets/aae_avatar_kit/examples`.

## Animated sheet format

The kit's [`avatar-manifest.json`](../assets/aae_avatar_kit/avatar-manifest.json) defines 32×32 frames in a 96×128 PNG: three columns and four direction rows.

| Row | Facing | Frame columns |
|---|---|---|
| 0 | Down | idle/walk A, step, idle/walk B |
| 1 | Left | idle/walk A, step, idle/walk B |
| 2 | Right | idle/walk A, step, idle/walk B |
| 3 | Up | idle/walk A, step, idle/walk B |

The renderer reads zero-based frame indices. The manifest maps its idle direction to the first cell of each row and the walk cycle to all three cells. In a browser each frame is enlarged with nearest-neighbor pixel rendering.

The source avatar layers are 96×128 transparent sheets aligned to the same grid. Compose body, outfit, hair, and accessory in that order. Their registered choices are listed by layer in the avatar kit manifest. Save preset IDs and appearance data, not executable or uploaded code.

## Register another character

1. Export aligned 32×32 frames using the row and column order above; the Aseprite GUI or CLI can produce the PNG. Blender is not part of this 2D pipeline.
2. Add the sheet and frame size, preview path if available, and explicit direction/animation frame lists to `SPRITES` in `web/src/world/sprites.ts`.
3. Add a preset ID to `AVATARS` only if it is appropriate for visitor selection. Keep NPC `agentId` separate from `spriteId`.
4. Check that an absent/invalid local avatar setting falls back to a registered preset. Run `npm test` and `npm run test:browser:world`.

The current portrait sprites are single-frame 16×16 images. They are intentionally mapped to idle and walking states until directional art is provided; the visitor kit includes the first animated directional sheets.
