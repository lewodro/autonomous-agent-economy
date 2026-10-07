# World sprites and avatar kit

The world loads only registered sprite URLs from `web/src/world/sprites.ts`. Actor logic stores a registered `spriteId`; it never infers actor identity or behavior from a filename. Character selection is additionally gated by `assets/avatars/index.json`: only approved entries with valid transparent PNG previews/sheets and a matching code allowlist appear. A usable image must contain visible pixels and at least 1% fully transparent pixels; partial-alpha edges alone do not qualify. Placeholder, debug, invalid, missing, non-PNG, and opaque previews are excluded.

## Asset folders

| Folder | Purpose |
|---|---|
| `assets/avatars/raw/` | Drop original visitor/avatar art here; preserve the supplied source. |
| `assets/avatars/clean/` | Approved transparent visitor sheets and previews referenced by `index.json`. |
| `assets/sprites-agent/` | Original 16×16 agent portraits. Keep source art unchanged. |
| `assets/agents/` | Generated transparent agent PNGs used by the game and world renderer. |
| `assets/spritesheets/` | Future exported animation sheets and frame metadata. |

The 16×16 agent portraits are supplied as transparent PNGs in `assets/sprites-agent/`. Run `npm run assets:build` to create the renderer-ready derivatives in `assets/agents/`; existing transparent pixels are preserved, and only connected opaque navy edge pixels are removed. Run `npm run assets:check` to validate dimensions, alpha, metadata, picker registration and generated outputs. Run `npm run assets:world:check` to validate all 20 transparent 16×16 agent sprites plus the four visitor sheets and previews. New sprite sheets should be transparent RGBA PNGs with consistent frame dimensions and explicit row/column animation metadata. The visitor manifest currently expects a 3×4 grid of 32×32 frames and a 256×256 preview.

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

The current portraits are single-frame 16×16 images. They are intentionally mapped to idle and walking states until directional art is provided; the four approved visitor avatars have directional 32×32 sheets. The picker uses those four visitor assets only; agent portraits remain world/NPC art, not character-select options.
